import { getSettings, getActiveNode, createRule } from "./storage.js";
import { findDirectBypassMatch } from "./direct-bypass.js";
import { patternFromTabUrl } from "./site-rules.js";
import { upsertTempDomainRule, getTempRules } from "./temp-rules.js";
import { urlWouldUseProxy } from "./proxy-rules.js";
import { applyProxySettings } from "./proxy.js";

const RETRY_COOLDOWN_MS = 3000;
const PROXY_SETTLE_MS = 400;
const RETRY_STATE_KEY = "inaccessibleRetryState";
const NAV_ERROR_PREFIX = "navError:";

const IGNORED_NETWORK_ERRORS = new Set([
  "net::ERR_ABORTED",
  "net::ERR_BLOCKED_BY_CLIENT",
]);

function retryKey(tabId, url) {
  const parsed = patternFromTabUrl(url);
  if (parsed.ok) return `${tabId}|${parsed.pattern}`;
  return `${tabId}|${url}`;
}

function urlHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isInaccessibleHttpStatus(statusCode) {
  return statusCode === 0 || statusCode === 404;
}

function isInaccessibleNetworkError(error) {
  if (!error) return false;
  return !IGNORED_NETWORK_ERRORS.has(error);
}

async function waitUntil(promise) {
  const keepAlive = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, 20_000);
  try {
    await promise;
  } finally {
    clearInterval(keepAlive);
  }
}

async function getRetryState(key) {
  const data = await chrome.storage.session.get(RETRY_STATE_KEY);
  const map = data[RETRY_STATE_KEY] ?? {};
  return map[key] ?? { retried: false, processing: false, lastAttempt: 0 };
}

async function setRetryState(key, state) {
  const data = await chrome.storage.session.get(RETRY_STATE_KEY);
  const map = { ...(data[RETRY_STATE_KEY] ?? {}), [key]: state };
  await chrome.storage.session.set({ [RETRY_STATE_KEY]: map });
}

async function clearRetryStateForTab(tabId) {
  const data = await chrome.storage.session.get(RETRY_STATE_KEY);
  const map = data[RETRY_STATE_KEY] ?? {};
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith(`${tabId}|`)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.session.set({ [RETRY_STATE_KEY]: map });
  }
  await chrome.storage.session.remove(`${NAV_ERROR_PREFIX}${tabId}`);
}

async function stashNavError(tabId, url, error) {
  await chrome.storage.session.set({
    [`${NAV_ERROR_PREFIX}${tabId}`]: { url, error, ts: Date.now() },
  });
}

async function reloadTab(tabId, url) {
  if (tabId >= 0) {
    try {
      await chrome.tabs.reload(tabId);
      return true;
    } catch {
      /* fall through */
    }
  }

  try {
    const parsed = new URL(url);
    const pattern = `${parsed.protocol}//${parsed.host}/*`;
    const tabs = await chrome.tabs.query({ url: pattern });
    if (tabs[0]?.id >= 0) {
      await chrome.tabs.reload(tabs[0].id);
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

async function handleInaccessible(details) {
  const settings = await getSettings();
  if (!settings.autoRetryOn404 || !settings.enabled) return;
  if (!getActiveNode(settings)) return;

  const url = details.url;
  if (!url?.startsWith("http")) return;

  const tempRules = await getTempRules();
  if (urlWouldUseProxy(settings, url, tempRules)) return;

  const host = urlHost(url);
  if (!host || findDirectBypassMatch(host, settings)) return;

  const parsed = patternFromTabUrl(url);
  if (!parsed.ok) return;

  const key = retryKey(details.tabId, url);
  const state = await getRetryState(key);
  const now = Date.now();
  if (state.retried || state.processing || now - state.lastAttempt < RETRY_COOLDOWN_MS) {
    return;
  }

  await setRetryState(key, { retried: false, processing: true, lastAttempt: now });

  try {
    await upsertTempDomainRule(parsed.pattern, createRule);
    const proxyResult = await applyProxySettings();
    if (!proxyResult.ok) {
      console.warn("[WallPenetrating] 临时代理规则已添加，但代理未就绪:", proxyResult.error);
    }

    await new Promise((resolve) => setTimeout(resolve, PROXY_SETTLE_MS));
    await reloadTab(details.tabId, url);

    await setRetryState(key, { retried: true, processing: false, lastAttempt: now });
  } catch (err) {
    console.warn("[WallPenetrating] 无法访问自动走代理失败:", err);
    await setRetryState(key, { retried: false, processing: false, lastAttempt: now });
  }
}

function shouldHandleNavigationError(details) {
  return details.frameId === 0 && isInaccessibleNetworkError(details.error);
}

async function handleChromeErrorTab(tabId) {
  const data = await chrome.storage.session.get(`${NAV_ERROR_PREFIX}${tabId}`);
  const pending = data[`${NAV_ERROR_PREFIX}${tabId}`];
  if (!pending?.url) return;
  if (Date.now() - pending.ts > 120_000) return;

  await handleInaccessible({
    tabId,
    url: pending.url,
    error: pending.error,
  });
}

export function initRetryOn404() {
  const requestFilter = { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] };

  chrome.webNavigation.onErrorOccurred.addListener((details) => {
    if (!shouldHandleNavigationError(details)) return;
    stashNavError(details.tabId, details.url, details.error).catch(() => {});
    return waitUntil(handleInaccessible(details));
  });

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.type !== "main_frame") return;

      if (isInaccessibleHttpStatus(details.statusCode)) {
        return waitUntil(handleInaccessible(details));
      }

      if (details.statusCode >= 200 && details.statusCode < 400) {
        const key = retryKey(details.tabId, details.url);
        getRetryState(key).then(async (state) => {
          if (!state.retried) return;
          const data = await chrome.storage.session.get(RETRY_STATE_KEY);
          const map = { ...(data[RETRY_STATE_KEY] ?? {}) };
          delete map[key];
          await chrome.storage.session.set({ [RETRY_STATE_KEY]: map });
        }).catch(() => {});
      }
    },
    requestFilter
  );

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    if (!tab.url?.startsWith("chrome-error://")) return;
    return waitUntil(handleChromeErrorTab(tabId));
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    clearRetryStateForTab(tabId).catch(() => {});
  });
}
