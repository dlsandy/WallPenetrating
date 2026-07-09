import { saveSettings } from "./storage.js";

export async function persistSettings(settings) {
  await saveSettings(settings);
  return chrome.runtime.sendMessage({ type: "APPLY_PROXY" });
}
