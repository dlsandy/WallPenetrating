import { getSettings, getActiveNode } from "./storage.js";
import { generatePacScript, generateGlobalPacScript } from "./pac.js";
import { getEffectiveDirectRules } from "./direct-bypass.js";
import { resolveRuleNode, getRequiredRoutingNodes } from "./routing.js";
import { syncSingboxRunner } from "./singbox-runner.js";
import { pingNativeHost, stopSingboxNative } from "./native-bridge.js";

async function stopSingboxIfNeeded(force = false) {
  if (!force && (await getSettings()).enabled) return;

  try {
    const hostPing = await pingNativeHost();
    if (hostPing.ok) {
      await stopSingboxNative();
    }
  } catch {
    /* ignore */
  }
}

export async function applyProxySettings() {
  const settings = await getSettings();

  if (!settings.enabled) {
    await clearProxySettings();
    return { ok: true, mode: "direct" };
  }

  const defaultNode = getActiveNode(settings);
  if (!defaultNode) {
    await clearProxySettings();
    return { ok: false, error: "未选择可用默认节点" };
  }

  const enabledRules = settings.rules.filter((r) => r.enabled && r.pattern.trim());
  if (!settings.globalProxy && enabledRules.length === 0) {
    await clearProxySettings();
    return { ok: false, error: "没有启用的网址规则" };
  }

  if (!settings.globalProxy) {
    for (const rule of enabledRules) {
      if (!resolveRuleNode(rule, settings)) {
        await clearProxySettings();
        return { ok: false, error: `规则「${rule.pattern}」无可用节点，请指定节点或设置默认节点` };
      }
    }
  }

  const singboxResult = await syncSingboxRunner();
  if (!singboxResult.ok) {
    await chrome.proxy.settings.clear({ scope: "regular" });
    const detail = singboxResult.log ? `：${singboxResult.log}` : "";
    return {
      ok: false,
      error: (singboxResult.error || "sing-box 启动失败") + detail,
      singbox: singboxResult,
    };
  }

  const directRules = getEffectiveDirectRules(settings);
  const resolveNode = (rule) => resolveRuleNode(rule, settings);

  const pacScript = settings.globalProxy
    ? generateGlobalPacScript(defaultNode.localHost, defaultNode.localPort, directRules)
    : generatePacScript(enabledRules, resolveNode, directRules);

  await chrome.proxy.settings.set({
    value: {
      mode: "pac_script",
      pacScript: { data: pacScript },
    },
    scope: "regular",
  });

  const routingNodes = getRequiredRoutingNodes(settings);

  return {
    ok: true,
    mode: settings.globalProxy ? "global" : "pac",
    node: defaultNode.name || `${defaultNode.host}:${defaultNode.port}`,
    routingNodeCount: routingNodes.length,
    singbox: singboxResult,
  };
}

export async function clearProxySettings(options = {}) {
  await stopSingboxIfNeeded(Boolean(options.forceStopSingbox));
  await chrome.proxy.settings.clear({ scope: "regular" });
}

export async function updateBadge() {
  const settings = await getSettings();
  const node = getActiveNode(settings);

  if (settings.enabled && node) {
    const badge = settings.globalProxy ? "G" : "ON";
    await chrome.action.setBadgeText({ text: badge });
    await chrome.action.setBadgeBackgroundColor({ color: settings.globalProxy ? "#2563eb" : "#16a34a" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}
