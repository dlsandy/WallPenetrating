export function getChromeProxyDetails() {
  return new Promise((resolve) => {
    chrome.proxy.settings.get({ incognito: false }, (details) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ ok: true, ...details });
    });
  });
}

export function describeChromeProxyConflict(details, extensionEnabled) {
  if (!details?.ok) return null;

  const { levelOfControl, value } = details;
  const issues = [];

  if (extensionEnabled && levelOfControl === "controlled_by_other_extensions") {
    issues.push("Chrome 代理已被其他扩展接管，本扩展可能无法生效");
  } else if (
    extensionEnabled &&
    levelOfControl === "controllable_by_this_extension" &&
    value?.mode &&
    value.mode !== "pac_script"
  ) {
    issues.push(`Chrome 当前代理模式为 ${value.mode}，与 PAC 分流不一致`);
  } else if (extensionEnabled && levelOfControl === "not_controllable") {
    issues.push("Chrome 代理受策略锁定，本扩展可能无法修改代理设置");
  }

  return issues.length ? issues : null;
}

export function describeSystemProxyConflict(systemProxy) {
  if (!systemProxy?.ok || !systemProxy.enabled) return null;

  const parts = ["Windows 系统代理已开启"];
  if (systemProxy.server) {
    parts.push(`服务器 ${systemProxy.server}`);
  }
  if (systemProxy.autoConfig) {
    parts.push("已配置 PAC/脚本");
  }
  parts.push("Chrome 内流量仍由本扩展控制，但其他程序可能走系统代理");

  return parts.join("，");
}
