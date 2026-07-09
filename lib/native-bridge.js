export const NATIVE_HOST_NAME = "com.anytls.singbox";

export function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response ?? { ok: false, error: "无响应" });
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function pingNativeHost() {
  try {
    const res = await sendNativeMessage({ action: "ping" });
    return { ok: res?.ok === true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getSingboxStatus() {
  return sendNativeMessage({ action: "status" });
}

export async function startSingboxNative(config) {
  const configJson = JSON.stringify(config, null, 2);
  return sendNativeMessage({ action: "start", config, configJson });
}

export async function stopSingboxNative() {
  return sendNativeMessage({ action: "stop" });
}

export async function testProxyNative({ port, remoteHost, remotePort }) {
  return sendNativeMessage({ action: "test", port, remoteHost, remotePort });
}

export async function getSingboxLogs(maxLen = 8000) {
  return sendNativeMessage({ action: "logs", maxLen });
}

export async function clearSingboxLogs() {
  return sendNativeMessage({ action: "clear-logs" });
}

export async function getSystemProxyStatus() {
  return sendNativeMessage({ action: "system-proxy" });
}

export async function openSystemProxySettings() {
  return sendNativeMessage({ action: "open-system-proxy" });
}

export async function fetchRemoteUrlNative(url) {
  return sendNativeMessage({ action: "fetch-url", url });
}

export async function getRegisteredExtensionId() {
  return sendNativeMessage({ action: "registered" });
}
