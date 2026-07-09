import { buildAnyTlsUri } from "./anytls-uri.js";
import { buildSingBoxConfigJson } from "./singbox-config.js";

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function nodeDisplayName(node) {
  return node.name || `${node.host}:${node.port}`;
}

export function readNodeForm(fields) {
  return {
    name: fields.name.value.trim(),
    host: fields.host.value.trim(),
    port: Number(fields.port.value),
    password: fields.password.value,
    sni: fields.sni.value.trim(),
    insecure: fields.insecure.checked,
    localHost: fields.localHost.value.trim() || "127.0.0.1",
    localPort: Number(fields.localPort.value),
    enabled: fields.enabled.checked,
  };
}

export function fillNodeForm(fields, node = {}) {
  fields.name.value = node.name ?? "";
  fields.host.value = node.host ?? "";
  fields.port.value = node.port ?? 443;
  fields.password.value = node.password ?? "";
  fields.sni.value = node.sni ?? "";
  fields.insecure.checked = node.insecure ?? false;
  fields.localHost.value = node.localHost ?? "127.0.0.1";
  fields.localPort.value = node.localPort ?? 1080;
  fields.enabled.checked = node.enabled ?? true;
}

export function getSingboxPreview(fields) {
  const data = readNodeForm(fields);
  if (data.host && data.password) {
    return buildSingBoxConfigJson(data);
  }
  return "填写服务器与密码后显示 sing-box 配置";
}

export { buildAnyTlsUri };

export function renderPopupNodeItem(node, isActive) {
  const disabled = !node.enabled;
  return `
    <article class="node-item ${isActive ? "active" : ""} ${disabled ? "disabled" : ""}" data-id="${node.id}">
      <div class="node-item-head">
        <span class="node-dot" aria-hidden="true"></span>
        <div class="node-item-title">
          <strong>${escapeHtml(nodeDisplayName(node))}</strong>
          <span class="node-item-sub">${escapeHtml(node.host)}:${node.port} → SOCKS ${escapeHtml(node.localHost)}:${node.localPort}</span>
        </div>
        ${isActive ? '<span class="tag tag-active">当前</span>' : ""}
        ${disabled ? '<span class="tag tag-off">已禁用</span>' : ""}
      </div>
      <div class="node-item-actions">
        ${!isActive && node.enabled ? `<button type="button" class="secondary small" data-action="activate-node" data-id="${node.id}">使用</button>` : ""}
        <button type="button" class="secondary small" data-action="edit-node" data-id="${node.id}">编辑</button>
        <button type="button" class="secondary small" data-action="copy-singbox" data-id="${node.id}">配置</button>
        <button type="button" class="danger small" data-action="delete-node" data-id="${node.id}">删除</button>
      </div>
    </article>
  `;
}
