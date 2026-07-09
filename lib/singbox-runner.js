import { getSettings, getActiveNode } from "./storage.js";
import { buildSingBoxConfigForNodes } from "./singbox-config.js";
import { getRequiredRoutingNodes } from "./routing.js";
import {
  startSingboxNative,
  stopSingboxNative,
  getSingboxStatus,
  pingNativeHost,
} from "./native-bridge.js";

export async function syncSingboxRunner() {
  const settings = await getSettings();

  const hostPing = await pingNativeHost();
  if (!hostPing.ok) {
    const detail = hostPing.error ? `（${hostPing.error}）` : "";
    return {
      ok: false,
      reason: "native_host_not_installed",
      error: `Native Host 不可用${detail}。请运行「一键安装.cmd」并确认扩展 ID 正确`,
    };
  }

  if (!settings.enabled) {
    const result = await stopSingboxNative();
    return { ok: true, stopped: true, ...result };
  }

  const nodes = getRequiredRoutingNodes(settings);
  if (!nodes.length) {
    await stopSingboxNative();
    return { ok: false, error: "未选择可用节点" };
  }

  const config = buildSingBoxConfigForNodes(nodes);
  const result = await startSingboxNative(config);

  if (!result.ok && result.binaryExists === false) {
    return {
      ...result,
      error: result.error || "sing-box 缺失（bin/sing-box.exe 不存在）",
    };
  }

  return { ...result, nodeCount: nodes.length };
}

export async function getSingboxRunnerStatus() {
  const hostPing = await pingNativeHost();

  if (!hostPing.ok) {
    return { hostAvailable: false, running: false, hostError: hostPing.error };
  }

  try {
    const status = await getSingboxStatus();
    return { hostAvailable: true, ...status };
  } catch (err) {
    return { hostAvailable: true, running: false, error: err.message };
  }
}
