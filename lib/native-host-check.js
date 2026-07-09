import { getRegisteredExtensionId, pingNativeHost } from "./native-bridge.js";

export async function checkNativeHostExtensionId(currentId = chrome.runtime.id) {
  const ping = await pingNativeHost();
  if (!ping.ok) {
    return {
      ok: false,
      hostAvailable: false,
      hostError: ping.error,
    };
  }

  try {
    const reg = await getRegisteredExtensionId();
    const registeredId = reg?.registeredExtensionId?.trim().toLowerCase() || null;

    if (!registeredId) {
      return {
        ok: true,
        hostAvailable: true,
        registeredId: null,
        currentId,
        mismatch: false,
        unknownRegistered: true,
      };
    }

    const mismatch = registeredId !== currentId.toLowerCase();
    return {
      ok: true,
      hostAvailable: true,
      registeredId,
      currentId,
      mismatch,
      unknownRegistered: false,
    };
  } catch (err) {
    return {
      ok: false,
      hostAvailable: true,
      error: err.message || String(err),
    };
  }
}
