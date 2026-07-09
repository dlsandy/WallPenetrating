import { applyProxySettings, clearProxySettings, updateBadge } from "../lib/proxy.js";

import { getSettings, saveSettings, createRule, createNode, getActiveNode, getSelectedNode, getNextLocalPort } from "../lib/storage.js";

import { migrateNode, GOOGLE_RULES } from "../lib/anytls-uri.js";

import { getSingboxRunnerStatus, syncSingboxRunner } from "../lib/singbox-runner.js";

import { generatePacScript, generateGlobalPacScript } from "../lib/pac.js";
import { getEffectiveDirectRules } from "../lib/direct-bypass.js";
import { resolveRuleNode } from "../lib/routing.js";
import { checkNativeHostExtensionId } from "../lib/native-host-check.js";
import {
  getChromeProxyDetails,
  describeChromeProxyConflict,
  describeSystemProxyConflict,
} from "../lib/proxy-diagnostics.js";
import { getSingboxLogs, clearSingboxLogs, getSystemProxyStatus, openSystemProxySettings } from "../lib/native-bridge.js";
import { patternFromTabUrl, findDomainRule, upsertDomainRule, upsertWildcardRule, removeDomainRule, shouldOfferWildcardRule } from "../lib/site-rules.js";
import { testNodeConnectivity } from "../lib/node-test.js";
import { fetchAndParseSubscription } from "../lib/subscription-fetch.js";
import {
  buildNodesFromSubscriptionUris,
  getSubscriptionMeta,
  saveSubscriptionMeta,
  syncSubscriptionAlarm,
  SUBSCRIPTION_ALARM,
} from "../lib/subscription.js";
import { initRetryOn404 } from "../lib/retry-on-404.js";
import { getTempRules } from "../lib/temp-rules.js";
import { getEffectiveProxyRules } from "../lib/proxy-rules.js";

function stripAnsi(text) {
  return text?.replace(/\x1b\[[0-9;]*m/g, "") ?? "";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function confirmInTab(tab, message) {
  if (!tab?.id) return false;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (msg) => window.confirm(msg),
      args: [message],
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

async function addCurrentSiteRule(tab = null, url = null, { addWildcard = null } = {}) {
  const tabUrl = url ?? tab?.url ?? (await getActiveTab())?.url;
  const parsed = patternFromTabUrl(tabUrl);

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const settings = await getSettings();
  const { status, overlap } = upsertDomainRule(settings.rules, parsed.pattern, createRule);

  let wildcardAdded = false;
  const wildcardPattern = shouldOfferWildcardRule(settings.rules, parsed.pattern, status);

  if (wildcardPattern && addWildcard !== false) {
    let confirmed = addWildcard === true;
    if (!confirmed && tab?.id) {
      confirmed = await confirmInTab(
        tab,
        `是否同时添加通配符规则「${wildcardPattern}」？\n\n确定 = 同时添加\n取消 = 仅保留域名规则「${parsed.pattern}」`
      );
    }
    if (confirmed) {
      upsertWildcardRule(settings.rules, wildcardPattern, createRule);
      wildcardAdded = true;
    }
  }

  await saveSettings(settings);
  await syncProxy();

  return {
    ok: true,
    pattern: parsed.pattern,
    status,
    wildcardPattern,
    wildcardAdded,
    overlapWarning: overlap ? `与规则「${overlap}」可能重复` : null,
  };
}

async function removeCurrentSiteRule(tab = null, url = null) {
  const tabUrl = url ?? tab?.url ?? (await getActiveTab())?.url;
  const parsed = patternFromTabUrl(tabUrl);

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const settings = await getSettings();
  const { removed } = removeDomainRule(settings.rules, parsed.pattern);

  if (!removed) {
    return { ok: false, error: "当前页不在规则列表中" };
  }

  await saveSettings(settings);
  await syncProxy();

  return { ok: true, pattern: parsed.pattern, status: "removed" };
}

async function getCurrentSiteInfo(tab = null, url = null) {
  const tabUrl = url ?? tab?.url ?? (await getActiveTab())?.url;
  const parsed = patternFromTabUrl(tabUrl);

  if (!parsed.ok) {
    return { ok: false, error: parsed.error, url: tabUrl ?? null };
  }

  const settings = await getSettings();
  const existing = findDomainRule(settings.rules, parsed.pattern);

  return {
    ok: true,
    url: tabUrl ?? null,
    pattern: parsed.pattern,
    inRules: Boolean(existing?.enabled),
    exists: Boolean(existing),
  };
}

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "add-current-site",
      title: "将当前网站加入 AnyTLS 分流",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "remove-current-site",
      title: "将当前网站移出 AnyTLS 分流",
      contexts: ["page"],
    });
  });
}

async function migrateSettings(settings) {

  let changed = false;



  settings.nodes = settings.nodes.map((node) => {

    const migrated = migrateNode(node);

    if (JSON.stringify(migrated) !== JSON.stringify(node)) changed = true;

    return migrated;

  });



  const hasGoogleRule = settings.rules.some(

    (r) => r.pattern === "google.com" || r.pattern.includes("google")

  );

  if (!settings.rules.length || !hasGoogleRule) {

    for (const item of GOOGLE_RULES) {

      const exists = settings.rules.some((r) => r.pattern === item.pattern);

      if (!exists) {

        settings.rules.push(createRule({ ...item, enabled: true }));

        changed = true;

      }

    }

  }



  if (changed) {

    await saveSettings(settings);

  }



  return settings;

}



async function autoRefreshSubscription() {
  const meta = await getSubscriptionMeta();
  if (!meta.url) return { ok: false, error: "未配置订阅链接" };

  try {
    const { uris } = await fetchAndParseSubscription(meta.url);
    if (!uris?.length) {
      throw new Error("订阅中未找到可用节点");
    }

    const settings = await getSettings();
    const imported = buildNodesFromSubscriptionUris(uris, {
      createNode,
      getNextLocalPort,
      existingNodes: settings.nodes,
      replace: true,
    });

    settings.nodes = imported;
    settings.activeNodeId =
      imported.find((n) => n.enabled)?.id ?? imported[0]?.id ?? null;
    await saveSettings(settings);
    await syncProxy();

    const message = `自动刷新：已导入 ${imported.length} 个节点`;
    await saveSubscriptionMeta({
      lastSyncAt: new Date().toISOString(),
      lastMessage: message,
    });

    return { ok: true, count: imported.length, message };
  } catch (err) {
    await saveSubscriptionMeta({
      lastMessage: `自动刷新失败：${err.message}`,
    });
    return { ok: false, error: err.message || String(err) };
  }
}

async function syncProxy() {

  try {

    await applyProxySettings();

  } catch (err) {

    console.error("Failed to apply proxy:", err);

  }

  await updateBadge();

}



function shouldSyncOnStorageChange(changes, area) {
  if (area === "sync" && changes.settings) return true;
  if (area === "local" && (changes.nodes || changes.activeNodeId)) return true;
  if (area === "session" && changes.tempRules) return true;
  return false;
}



async function handleMessage(message) {

  switch (message.type) {

    case "TOGGLE_ENABLED": {

      const settings = await getSettings();

      settings.enabled = !settings.enabled;

      await saveSettings(settings);

      await syncProxy();

      return { ok: true, enabled: settings.enabled };

    }

    case "SET_ENABLED": {

      const settings = await getSettings();

      settings.enabled = Boolean(message.enabled);

      await saveSettings(settings);

      await syncProxy();

      return { ok: true, enabled: settings.enabled };

    }

    case "GET_STATUS": {

      const settings = await getSettings();

      return { ok: true, settings };

    }

    case "APPLY_PROXY": {

      const result = await applyProxySettings();

      await updateBadge();

      return result;

    }

    case "MIGRATE_SETTINGS": {

      const settings = await migrateSettings(await getSettings());

      await syncProxy();

      return { ok: true, settings };

    }

    case "GET_DIAGNOSTICS": {

      const settings = await migrateSettings(await getSettings());

      const node = getActiveNode(settings);

      const selectedNode = getSelectedNode(settings);

      const tempRules = await getTempRules();
      const enabledRules = getEffectiveProxyRules(settings, tempRules);

      const issues = [];



      if (!settings.enabled) issues.push("分流开关未开启");

      if (!node) {
        if (selectedNode && !selectedNode.enabled) {
          issues.push("当前节点已禁用，请在节点管理中启用或切换节点");
        } else if (settings.activeNodeId && settings.nodes.length) {
          issues.push("选中的节点已失效，请重新在节点列表中点击「使用」");
        } else if (settings.nodes.length) {
          issues.push("未选择可用节点，请在节点管理中点击「使用」");
        } else {
          issues.push("未添加节点，请先在节点管理中添加 AnyTLS 节点");
        }
      }

      if (settings.enabled && !settings.globalProxy && enabledRules.length === 0) {

        issues.push("没有启用的网址规则");

      }

      if (tempRules.length > 0) {
        issues.push(`临时代理规则 ${tempRules.filter((r) => r.enabled).length} 条（关闭浏览器后清空）`);
      }

      if (settings.enabled && settings.globalProxy) {

        issues.push("全局代理已开启，所有网页走 AnyTLS（局域网地址除外）");

      }

      if (node && !node.sni) {

        issues.push("节点缺少 SNI（订阅链接中的 peer 参数），TLS 可能无法连接");

      }

      if (node && !node.password) {

        issues.push("当前节点缺少密码，请编辑节点补全");

      }



      let singbox = await getSingboxRunnerStatus();

      if (
        singbox.hostAvailable &&
        singbox.binaryExists !== false &&
        settings.enabled &&
        node &&
        !singbox.running
      ) {
        const sync = await syncSingboxRunner();
        if (sync.ok) {
          await applyProxySettings();
          singbox = await getSingboxRunnerStatus();
        } else {
          if (sync.error) issues.push(`sing-box 启动失败：${sync.error}`);
          if (sync.log) issues.push(`sing-box 日志：${stripAnsi(sync.log)}`);
        }
      }

      if (!singbox.hostAvailable) {

        const hostErr = singbox.hostError ? `：${singbox.hostError}` : "";

        issues.push(`Native Host 不可用${hostErr}`);

        issues.push(`当前扩展 ID：${chrome.runtime.id}，请用此 ID 重新运行「一键安装.cmd」`);

      } else if (singbox.binaryExists === false) {

        issues.push("sing-box 缺失（bin/sing-box.exe 不存在）");

      } else if (settings.enabled && !singbox.running) {

        issues.push("sing-box 未在运行");

        if (singbox.logTail) {

          issues.push(`sing-box 日志：${stripAnsi(singbox.logTail)}`);

        }

      } else if (singbox.running) {

        issues.push(`sing-box 运行中 (PID ${singbox.pid}, 端口 ${singbox.port ?? 1080})`);

      }

      const hostIdCheck = await checkNativeHostExtensionId(chrome.runtime.id);
      if (hostIdCheck.hostAvailable && hostIdCheck.mismatch) {
        issues.push(
          `Native Host 扩展 ID 不匹配：已注册 ${hostIdCheck.registeredId}，当前 ${hostIdCheck.currentId}，请重新运行「一键安装.cmd」`
        );
      } else if (hostIdCheck.hostAvailable && hostIdCheck.unknownRegistered) {
        issues.push("无法读取 Native Host 注册的扩展 ID，建议重新运行「一键安装.cmd」");
      }

      const directRules = getEffectiveDirectRules(settings);
      if (settings.directBypassEnabled !== false && directRules.length > 0) {
        issues.push(`直连名单已启用（${directRules.length} 条，含银行/政务等敏感站）`);
      }

      const chromeProxy = await getChromeProxyDetails();
      for (const msg of describeChromeProxyConflict(chromeProxy, settings.enabled) || []) {
        issues.push(msg);
      }

      if (singbox.hostAvailable) {
        try {
          const systemProxy = await getSystemProxyStatus();
          const sysMsg = describeSystemProxyConflict(systemProxy);
          if (sysMsg) issues.push(sysMsg);
        } catch {
          /* ignore */
        }
      }

      if (settings.enabled && node) {

        issues.push("若 Google 仍无法打开，可在 chrome://flags 中禁用 QUIC（#enable-quic）");

      }



      let pacPreview = "";

      if (settings.enabled && node) {

        if (settings.globalProxy) {

          pacPreview = generateGlobalPacScript(node.localHost, node.localPort, directRules);

        } else if (enabledRules.length > 0) {

          pacPreview = generatePacScript(enabledRules, (rule) => resolveRuleNode(rule, settings), directRules);

        }

      }



      return {

        ok: true,

        settings,

        node,

        extensionId: chrome.runtime.id,

        nativeHostId: hostIdCheck,

        directRuleCount: directRules.length,

        enabledRuleCount: enabledRules.length,

        tempRuleCount: tempRules.filter((r) => r.enabled).length,

        issues,

        pacPreview,

        singbox,

      };

    }

    case "GET_SINGBOX_STATUS": {

      return { ok: true, ...(await getSingboxRunnerStatus()) };

    }

    case "SYNC_SINGBOX": {

      return await syncSingboxRunner();

    }

    case "GET_CURRENT_SITE": {

      return getCurrentSiteInfo(null, message.url);

    }

    case "ADD_CURRENT_SITE_RULE": {

      return addCurrentSiteRule(null, message.url, {
        addWildcard: message.addWildcard ?? null,
      });

    }

    case "REMOVE_CURRENT_SITE_RULE": {

      return removeCurrentSiteRule(null, message.url);

    }

    case "TEST_NODE_CONNECTIVITY": {

      const node = getActiveNode(await getSettings());
      return testNodeConnectivity(node);

    }

    case "GET_SINGBOX_LOGS": {

      try {
        return await getSingboxLogs(message.maxLen ?? 8000);
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }

    }

    case "CLEAR_SINGBOX_LOGS": {

      try {
        return await clearSingboxLogs();
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }

    }

    case "GET_SYSTEM_PROXY": {

      try {
        return await getSystemProxyStatus();
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }

    }

    case "OPEN_SYSTEM_PROXY_SETTINGS": {

      try {
        return await openSystemProxySettings();
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }

    }

    case "FETCH_SUBSCRIPTION": {

      try {
        const { uris, errors, httpCode, byteLength } = await fetchAndParseSubscription(message.url);
        return { ok: true, uris, errors, httpCode, byteLength };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }

    }

    case "IMPORT_SUBSCRIPTION_URIS": {

      try {
        const settings = await getSettings();
        const replace = Boolean(message.replace);
        const imported = buildNodesFromSubscriptionUris(message.uris || [], {
          createNode,
          getNextLocalPort,
          existingNodes: settings.nodes,
          replace,
        });

        if (replace) {
          settings.nodes = imported;
          settings.activeNodeId =
            imported.find((n) => n.enabled)?.id ?? imported[0]?.id ?? null;
        } else {
          settings.nodes.push(...imported);
          if (!settings.activeNodeId) {
            settings.activeNodeId = imported.find((n) => n.enabled)?.id ?? null;
          }
        }

        await saveSettings(settings);
        await syncProxy();
        return { ok: true, count: imported.length };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }

    }

    default:

      return { ok: false, error: "Unknown message type" };

  }

}



chrome.runtime.onInstalled.addListener(async () => {

  setupContextMenu();

  let settings = await getSettings();

  settings = await migrateSettings(settings);

  if (!settings.rules.length) {

    await saveSettings({

      ...settings,

      rules: GOOGLE_RULES.map((item) => createRule({ ...item, enabled: true })),

    });

  }

  await syncSubscriptionAlarm();
  await syncProxy();

});



chrome.runtime.onStartup.addListener(async () => {

  setupContextMenu();

  await migrateSettings(await getSettings());

  await syncSubscriptionAlarm();
  await syncProxy();

});



chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SUBSCRIPTION_ALARM) {
    await autoRefreshSubscription();
  }
});



chrome.storage.onChanged.addListener((changes, area) => {

  if (shouldSyncOnStorageChange(changes, area)) {

    syncProxy();

  }

});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "add-current-site") {
    const result = await addCurrentSiteRule(tab);
    if (!result.ok) return;
    try {
      await chrome.action.setBadgeText({ text: "✓" });
      await chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
      setTimeout(() => updateBadge(), 2000);
    } catch {
      /* ignore */
    }
    return;
  }

  if (info.menuItemId === "remove-current-site") {
    await removeCurrentSiteRule(tab);
    setTimeout(() => updateBadge(), 500);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  (async () => {

    try {

      sendResponse(await handleMessage(message));

    } catch (err) {

      sendResponse({ ok: false, error: err.message || String(err) });

    }

  })();

  return true;

});



chrome.runtime.onSuspend.addListener(() => clearProxySettings({ forceStopSingbox: true }));



(async () => {

  setupContextMenu();
  initRetryOn404();

  await migrateSettings(await getSettings());

  await syncSubscriptionAlarm();
  await syncProxy();

})();

