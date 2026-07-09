import { getSettings, getActiveNode } from "./storage.js";
import { findDirectBypassMatch } from "./direct-bypass.js";
import { patternFromTabUrl } from "./site-rules.js";
import { createRule } from "./storage.js";
import { upsertTempDomainRule } from "./temp-rules.js";
import { urlWouldUseProxy } from "./proxy-rules.js";
import { applyProxySettings } from "./proxy.js";
import { getTempRules } from "./temp-rules.js";

const RETRY_COOLDOWN_MS = 3000;
const retryState = new Map();

function retryKey(tabId, url) {
  return `${tabId}|${url}`;
}

function urlHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function clearRetryStateForTab(tabId) {
  for (const key of retryState.keys()) {
    if (key.startsWith(`${tabId}|`)) {
      retryState.delete(key);
    }
  }
}

async function handle404(details) {
  const settings = await getSettings();
  if (!settings.autoRetryOn404 || !settings.enabled) return;
  if (!getActiveNode(settings)) return;

  const tempRules = await getTempRules();
  if (urlWouldUseProxy(settings, details.url, tempRules)) return;

  const host = urlHost(details.url);
  if (!host || findDirectBypassMatch(host, settings)) return;

  const parsed = patternFromTabUrl(details.url);
  if (!parsed.ok) return;

  const key = retryKey(details.tabId, details.url);
  const state = retryState.get(key) ?? { retried: false, lastAttempt: 0 };

  const now = Date.now();
  if (state.retried || now - state.lastAttempt < RETRY_COOLDOWN_MS) {
    retryState.set(key, state);
    return;
  }

  await upsertTempDomainRule(parsed.pattern, createRule);

  state.retried = true;
  state.lastAttempt = now;
  retryState.set(key, state);

  await applyProxySettings();

  try {
    await chrome.tabs.reload(details.tabId);
  } catch {
    /* tab may be closed */
  }
}

export function initRetryOn404() {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.type !== "main_frame") return;

      if (details.statusCode === 404) {
        handle404(details);
        return;
      }

      if (details.statusCode >= 200 && details.statusCode < 400) {
        retryState.delete(retryKey(details.tabId, details.url));
      }
    },
    { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }
  );

  chrome.tabs.onRemoved.addListener((tabId) => {
    clearRetryStateForTab(tabId);
  });
}
