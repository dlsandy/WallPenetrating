import { getSingboxStatus, testProxyNative } from "./native-bridge.js";
import { syncSingboxRunner } from "./singbox-runner.js";
import { getSettings } from "./storage.js";

export async function testNodeConnectivity(node, { ensureRunning = true } = {}) {
  if (!node) {
    return { ok: false, error: "未选择节点" };
  }

  if (ensureRunning) {
    const settings = await getSettings();
    if (settings.enabled) {
      const sync = await syncSingboxRunner();
      if (!sync.ok) {
        return {
          ok: false,
          error: sync.error || "sing-box 启动失败",
          stage: "singbox",
          log: sync.log,
        };
      }
    }
  }

  let status;
  try {
    status = await getSingboxStatus();
  } catch (err) {
    return { ok: false, error: err.message, stage: "native" };
  }

  if (!status.hostAvailable) {
    return { ok: false, error: "Native Host 不可用", stage: "native" };
  }

  if (!status.running) {
    return { ok: false, error: "sing-box 未运行", stage: "local", logTail: status.logTail };
  }

  const port = node.localPort || status.port || 1080;

  try {
    const result = await testProxyNative({
      port,
      remoteHost: node.host,
      remotePort: node.port,
    });

    return {
      ...result,
      port,
      nodeName: node.name || `${node.host}:${node.port}`,
    };
  } catch (err) {
    return { ok: false, error: err.message, stage: "native" };
  }
}
