import {
  getSettings,
  saveSettings,
  createNode,
  createRule,
  getActiveNode,
  getNextLocalPort,
} from "../lib/storage.js";
import { parseAnyTlsUri, buildAnyTlsUri } from "../lib/anytls-uri.js";
import { buildSingBoxConfigJson } from "../lib/singbox-config.js";
import { escapeHtml, nodeDisplayName, getSingboxPreview } from "../lib/node-ui.js";
import {
  downloadJsonFile,
  timestampForFilename,
  pickJsonFile,
  buildRulesExportPayload,
  buildNodesExportPayload,
  buildFullExportPayload,
  parseRulesImport,
  parseNodesImport,
  parseFullImport,
  sanitizeRuleItem,
  sanitizeNodeItem,
} from "../lib/import-export.js";
import { validateRulePattern } from "../lib/rule-validation.js";
import { persistSettings } from "../lib/persist-settings.js";
import { detectRuleImportIssues } from "../lib/rule-import-check.js";
import { BUILTIN_DIRECT_RULES } from "../lib/direct-bypass.js";
import {
  getTempRules,
  removeTempRule,
  updateTempRule,
  promoteTempRuleToPermanent,
} from "../lib/temp-rules.js";
import {
  getChromeProxyDetails,
  describeChromeProxyConflict,
} from "../lib/proxy-diagnostics.js";
import { getSubscriptionMeta, saveSubscriptionMeta, buildSubscriptionExport, applySubscriptionImport } from "../lib/subscription.js";
import { resolveRuleNode, ruleNodeLabel, countRulesUsingNode } from "../lib/routing.js";
import { VERSION } from "../lib/version.js";

let settings = null;
let editingRuleId = null;
let editingDirectRuleId = null;
let ruleDialogMode = "proxy";
let editingNodeId = null;

const globalEnabled = document.getElementById("globalEnabled");
const globalProxy = document.getElementById("globalProxy");
const autoRetryOn404 = document.getElementById("autoRetryOn404");
const projectUrlInput = document.getElementById("projectUrl");
const sidebarStatus = document.getElementById("sidebarStatus");
const singboxSidebarStatus = document.getElementById("singboxSidebarStatus");
const singboxStatusBox = document.getElementById("singboxStatusBox");
const systemProxyStatusBox = document.getElementById("systemProxyStatusBox");
const singboxLogPanel = document.getElementById("singboxLogPanel");
const rulesBody = document.getElementById("rulesBody");
const tempRulesBody = document.getElementById("tempRulesBody");
const rulesSearchInput = document.getElementById("rulesSearchInput");
const directRulesBody = document.getElementById("directRulesBody");
const directBypassEnabled = document.getElementById("directBypassEnabled");
const useBuiltinDirect = document.getElementById("useBuiltinDirect");
const nodesList = document.getElementById("nodesList");

const ruleDialog = document.getElementById("ruleDialog");
const ruleForm = document.getElementById("ruleForm");
const ruleDialogTitle = document.getElementById("ruleDialogTitle");
const rulePattern = document.getElementById("rulePattern");
const ruleType = document.getElementById("ruleType");
const ruleNodeId = document.getElementById("ruleNodeId");
const ruleNodeField = document.getElementById("ruleNodeField");
const ruleEnabled = document.getElementById("ruleEnabled");

const nodeDialog = document.getElementById("nodeDialog");
const nodeForm = document.getElementById("nodeForm");
const nodeDialogTitle = document.getElementById("nodeDialogTitle");
const nodeName = document.getElementById("nodeName");
const nodeHost = document.getElementById("nodeHost");
const nodePort = document.getElementById("nodePort");
const nodePassword = document.getElementById("nodePassword");
const nodeSni = document.getElementById("nodeSni");
const nodeInsecure = document.getElementById("nodeInsecure");
const nodeLocalHost = document.getElementById("nodeLocalHost");
const nodeLocalPort = document.getElementById("nodeLocalPort");
const nodeEnabled = document.getElementById("nodeEnabled");
const nodeConfigPreview = document.getElementById("nodeConfigPreview");

const uriDialog = document.getElementById("uriDialog");
const uriForm = document.getElementById("uriForm");
const uriInput = document.getElementById("uriInput");
const subscriptionUrlInput = document.getElementById("subscriptionUrl");
const subscriptionStatus = document.getElementById("subscriptionStatus");
const subscriptionAutoRefreshInput = document.getElementById("subscriptionAutoRefresh");
const subscriptionRefreshHoursSelect = document.getElementById("subscriptionRefreshHours");

function switchTab(tabId) {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.id === `tab-${tabId}`);
  });
  if (tabId === "singbox") {
    renderSingboxLogs();
    renderSystemProxyPanel();
  }
}

function switchRulesSubtab(subtabId) {
  document.querySelectorAll(".rules-subtab-btn").forEach((btn) => {
    const active = btn.dataset.rulesSubtab === subtabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".rules-subtab").forEach((panel) => {
    const active = panel.id === `rules-subtab-${subtabId}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function updateConfigPreview() {
  const fields = {
    name: nodeName,
    host: nodeHost,
    port: nodePort,
    password: nodePassword,
    sni: nodeSni,
    insecure: nodeInsecure,
    localHost: nodeLocalHost,
    localPort: nodeLocalPort,
    enabled: nodeEnabled,
  };
  nodeConfigPreview.textContent = getSingboxPreview(fields);
}

function renderSidebar() {
  globalEnabled.checked = settings.enabled;
  globalProxy.checked = settings.globalProxy;
  if (autoRetryOn404) {
    autoRetryOn404.checked = Boolean(settings.autoRetryOn404);
  }
  if (projectUrlInput) {
    projectUrlInput.value = settings.projectUrl ?? "";
  }
  const node = getActiveNode(settings);
  const ruleCount = settings.rules.filter((r) => r.enabled).length;
  const ready = settings.enabled && node && (settings.globalProxy || ruleCount > 0);

  if (ready && settings.globalProxy) {
    sidebarStatus.textContent = `已启用 · 全局代理 · ${node.name || node.host}`;
  } else if (ready) {
    sidebarStatus.textContent = `已启用 · ${node.name || node.host} · ${ruleCount} 条规则`;
  } else if (settings.enabled) {
    sidebarStatus.textContent = "已开启但未就绪（缺少节点或规则）";
  } else {
    sidebarStatus.textContent = "分流已关闭";
  }

  singboxSidebarStatus.textContent = "代理引擎：sing-box";
}

async function renderSingboxLogs() {
  if (!singboxLogPanel) return;
  singboxLogPanel.textContent = "加载中…";

  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_SINGBOX_LOGS", maxLen: 12000 });
    if (!res?.ok) {
      singboxLogPanel.textContent = res?.error || "无法读取日志（Native Host 不可用）";
      return;
    }
    singboxLogPanel.textContent = res.log?.trim() || "（暂无日志）";
  } catch (err) {
    singboxLogPanel.textContent = err.message || "读取日志失败";
  }
}

async function clearSingboxLogsPanel() {
  if (
    !confirm(
      "确定清除 sing-box 运行日志？\n\n若 sing-box 正在运行，将短暂停止后自动重启。"
    )
  ) {
    return;
  }

  try {
    const res = await chrome.runtime.sendMessage({ type: "CLEAR_SINGBOX_LOGS" });
    if (!res?.ok) {
      alert(res?.error || "清除失败（Native Host 不可用）");
      return;
    }

    await renderSingboxLogs();
    await renderSingboxPanel();

    if (res.restartError) {
      alert(`日志已清除，但 sing-box 重启失败：${res.restartError}\n请关闭再打开分流开关。`);
      return;
    }

    if (res.wasRunning && res.restarted) {
      alert("日志已清除，sing-box 已自动重启");
    }
  } catch (err) {
    alert(err.message || "清除日志失败");
  }
}

async function renderSystemProxyPanel() {
  if (!systemProxyStatusBox) return;

  systemProxyStatusBox.className = "status-card";
  const lines = [];

  try {
    const systemProxy = await chrome.runtime.sendMessage({ type: "GET_SYSTEM_PROXY" });
    if (!systemProxy?.ok) {
      lines.push("Windows 系统代理：无法检测（Native Host 不可用）");
      systemProxyStatusBox.classList.add("warn");
    } else if (systemProxy.enabled) {
      const parts = ["Windows 系统代理：已开启"];
      if (systemProxy.server) parts.push(`服务器 ${systemProxy.server}`);
      if (systemProxy.autoConfig) parts.push("已配置自动脚本");
      lines.push(parts.join(" · "));
      systemProxyStatusBox.classList.add("warn");
    } else {
      lines.push("Windows 系统代理：未开启");
      systemProxyStatusBox.classList.add("ok");
    }
  } catch {
    lines.push("Windows 系统代理：检测失败");
    systemProxyStatusBox.classList.add("warn");
  }

  try {
    const cp = await getChromeProxyDetails();
    const chromeIssues = describeChromeProxyConflict(cp, settings?.enabled);
    if (chromeIssues?.length) {
      lines.push(...chromeIssues);
      systemProxyStatusBox.classList.add("warn");
    } else if (cp.ok && cp.levelOfControl === "controlled_by_this_extension") {
      lines.push("Chrome 代理：由本扩展控制（PAC）");
    }
  } catch {
    lines.push("Chrome 代理：检测失败");
    systemProxyStatusBox.classList.add("warn");
  }

  systemProxyStatusBox.textContent = lines.join("\n");
}

async function renderSingboxPanel() {
  const status = await chrome.runtime.sendMessage({ type: "GET_SINGBOX_STATUS" });
  if (!singboxStatusBox) return;

  singboxStatusBox.className = "status-card";

  if (!status.hostAvailable) {
    singboxStatusBox.innerHTML =
      "Native Host 未安装。<br>请运行 <code>native\\install.ps1 -ExtensionId 你的扩展ID</code>";
    singboxStatusBox.classList.add("warn");
    return;
  }

  if (status.binaryExists === false) {
    singboxStatusBox.innerHTML =
      "sing-box 缺失。<br>请确认 <code>bin\\sing-box.exe</code> 存在，或运行 <code>scripts\\download-singbox.ps1</code> 重新获取。";
    singboxStatusBox.classList.add("warn");
    return;
  }

  if (status.running) {
    singboxStatusBox.textContent = `sing-box 运行中 · PID ${status.pid} · ${status.binaryPath}`;
    singboxStatusBox.classList.add("ok");
  } else {
    singboxStatusBox.textContent = "sing-box 已就绪。开启分流后将自动启动。";
    singboxStatusBox.classList.add("ok");
  }

  await renderSystemProxyPanel();
}

function ruleMatchesSearch(rule, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    rule.pattern.toLowerCase().includes(q) ||
    typeLabel(rule.type).toLowerCase().includes(q) ||
    rule.type.toLowerCase().includes(q) ||
    ruleNodeLabel(rule, settings).toLowerCase().includes(q)
  );
}

function renderRules() {
  rulesBody.innerHTML = "";
  const query = rulesSearchInput?.value ?? "";

  if (!settings.rules.length) {
    rulesBody.innerHTML = `<tr><td colspan="5" class="empty">暂无网址规则，点击「添加网址」开始</td></tr>`;
    return;
  }

  const filtered = settings.rules.filter((rule) => ruleMatchesSearch(rule, query));

  if (!filtered.length) {
    rulesBody.innerHTML = `<tr><td colspan="5" class="empty">没有匹配「${escapeHtml(query.trim())}」的规则</td></tr>`;
    return;
  }

  for (const rule of filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-action="toggle-rule" data-id="${rule.id}" ${rule.enabled ? "checked" : ""} /></td>
      <td><code>${escapeHtml(rule.pattern)}</code></td>
      <td>${typeLabel(rule.type)}</td>
      <td>${escapeHtml(ruleNodeLabel(rule, settings))}</td>
      <td>
        <button type="button" class="secondary small" data-action="edit-rule" data-id="${rule.id}">编辑</button>
        <button type="button" class="danger small" data-action="delete-rule" data-id="${rule.id}">删除</button>
      </td>
    `;
    rulesBody.appendChild(tr);
  }
}

async function applyTempRulesProxy() {
  await chrome.runtime.sendMessage({ type: "APPLY_PROXY" });
}

async function renderTempRules() {
  if (!tempRulesBody) return;

  const tempRules = await getTempRules();
  tempRulesBody.innerHTML = "";

  if (!tempRules.length) {
    tempRulesBody.innerHTML = `<tr><td colspan="5" class="empty">暂无临时代理规则</td></tr>`;
    return;
  }

  for (const rule of tempRules) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-action="toggle-temp-rule" data-id="${rule.id}" ${rule.enabled ? "checked" : ""} /></td>
      <td><code>${escapeHtml(rule.pattern)}</code> <span class="badge">临时</span></td>
      <td>${typeLabel(rule.type)}</td>
      <td>${escapeHtml(ruleNodeLabel(rule, settings))}</td>
      <td>
        <button type="button" class="secondary small" data-action="promote-temp-rule" data-id="${rule.id}">转为代理规则</button>
        <button type="button" class="danger small" data-action="delete-temp-rule" data-id="${rule.id}">删除</button>
      </td>
    `;
    tempRulesBody.appendChild(tr);
  }
}

function renderDirectRules() {
  if (!directRulesBody) return;

  directBypassEnabled.checked = settings.directBypassEnabled !== false;
  useBuiltinDirect.checked = settings.useBuiltinDirect !== false;
  directRulesBody.innerHTML = "";

  const rows = [];

  if (settings.useBuiltinDirect !== false) {
    for (const rule of BUILTIN_DIRECT_RULES) {
      rows.push({ rule, builtin: true });
    }
  }

  for (const rule of settings.directRules || []) {
    rows.push({ rule, builtin: false });
  }

  if (!rows.length) {
    directRulesBody.innerHTML = `<tr><td colspan="4" class="empty">暂无直连规则</td></tr>`;
    return;
  }

  for (const { rule, builtin } of rows) {
    const tr = document.createElement("tr");
    if (builtin) {
      tr.innerHTML = `
      <td><input type="checkbox" checked disabled title="内置规则" /></td>
      <td><code>${escapeHtml(rule.pattern)}</code> <span class="badge">内置</span></td>
      <td>${typeLabel(rule.type)}</td>
      <td>—</td>
    `;
    } else {
      tr.innerHTML = `
      <td><input type="checkbox" data-action="toggle-direct-rule" data-id="${rule.id}" ${rule.enabled ? "checked" : ""} /></td>
      <td><code>${escapeHtml(rule.pattern)}</code></td>
      <td>${typeLabel(rule.type)}</td>
      <td>
        <button type="button" class="secondary small" data-action="edit-direct-rule" data-id="${rule.id}">编辑</button>
        <button type="button" class="danger small" data-action="delete-direct-rule" data-id="${rule.id}">删除</button>
      </td>
    `;
    }
    directRulesBody.appendChild(tr);
  }
}

function renderNodes() {
  nodesList.innerHTML = "";

  if (!settings.nodes.length) {
    nodesList.innerHTML = `<div class="empty">暂无节点，点击「添加节点」或「从 URI 导入」</div>`;
    return;
  }

  for (const node of settings.nodes) {
    const card = document.createElement("article");
    card.className = "card";
    const isActive = settings.activeNodeId === node.id;
    const dedicatedRuleCount = countRulesUsingNode(settings, node.id);
    card.innerHTML = `
      <div class="card-header">
        <h3>${escapeHtml(nodeDisplayName(node))}</h3>
        <div>
          ${isActive ? '<span class="badge active">默认节点</span>' : ""}
          ${dedicatedRuleCount ? `<span class="badge">${dedicatedRuleCount} 条规则</span>` : ""}
          ${node.enabled ? "" : '<span class="badge">已禁用</span>'}
        </div>
      </div>
      <div class="card-meta">
        <div>服务器<br /><strong>${escapeHtml(node.host)}:${node.port}</strong></div>
        <div>本地 SOCKS<br /><strong>${escapeHtml(node.localHost)}:${node.localPort}</strong></div>
        <div>SNI<br /><strong>${escapeHtml(node.sni || "—")}</strong></div>
        <div>TLS<br /><strong>${node.insecure ? "insecure" : "默认"}</strong></div>
      </div>
      <div class="card-actions">
        ${!isActive ? `<button type="button" class="secondary small" data-action="activate-node" data-id="${node.id}">设为默认</button>` : ""}
        <button type="button" class="secondary small" data-action="copy-uri" data-id="${node.id}">复制 URI</button>
        <button type="button" class="secondary small" data-action="copy-singbox" data-id="${node.id}">sing-box 配置</button>
        <button type="button" class="secondary small" data-action="edit-node" data-id="${node.id}">编辑</button>
        <button type="button" class="danger small" data-action="delete-node" data-id="${node.id}">删除</button>
      </div>
    `;
    nodesList.appendChild(card);
  }
}

function typeLabel(type) {
  return { domain: "域名", wildcard: "通配符", regex: "正则" }[type] || type;
}

async function persist() {
  await persistSettings(settings);
  renderSidebar();
  renderRules();
  await renderTempRules();
  renderDirectRules();
  renderNodes();
  await renderSingboxPanel();
}

async function renderSubscriptionPanel() {
  if (!subscriptionUrlInput || !subscriptionStatus) return;

  const meta = await getSubscriptionMeta();
  subscriptionUrlInput.value = meta.url || "";
  if (subscriptionAutoRefreshInput) {
    subscriptionAutoRefreshInput.checked = meta.autoRefresh;
  }
  if (subscriptionRefreshHoursSelect) {
    subscriptionRefreshHoursSelect.value = String(meta.refreshHours || 24);
    subscriptionRefreshHoursSelect.disabled = !meta.autoRefresh;
  }

  if (meta.lastSyncAt) {
    const when = new Date(meta.lastSyncAt).toLocaleString();
    subscriptionStatus.textContent = meta.lastMessage
      ? `上次刷新：${when} · ${meta.lastMessage}`
      : `上次刷新：${when}`;
  } else {
    subscriptionStatus.textContent = meta.url ? "已保存订阅链接，点击「刷新订阅」拉取节点" : "填写订阅链接后可一键拉取节点";
  }
}

function readSubscriptionForm() {
  return {
    url: subscriptionUrlInput?.value.trim() ?? "",
    autoRefresh: Boolean(subscriptionAutoRefreshInput?.checked),
    refreshHours: Number(subscriptionRefreshHoursSelect?.value) || 24,
  };
}

async function saveSubscriptionUrl() {
  const { url, autoRefresh, refreshHours } = readSubscriptionForm();
  await saveSubscriptionMeta({ url, autoRefresh, refreshHours });
  await renderSubscriptionPanel();
  alert(url ? "订阅设置已保存" : "已清除订阅链接");
}

async function refreshSubscription() {
  const { url } = readSubscriptionForm();
  if (!url) {
    alert("请先填写订阅链接");
    return;
  }

  const btn = document.getElementById("refreshSubscriptionBtn");
  btn.disabled = true;
  btn.textContent = "拉取中…";

  try {
    const { autoRefresh, refreshHours } = readSubscriptionForm();
    await saveSubscriptionMeta({ url, autoRefresh, refreshHours });

    const fetchRes = await chrome.runtime.sendMessage({ type: "FETCH_SUBSCRIPTION", url });
    if (!fetchRes?.ok) {
      throw new Error(fetchRes?.error || "拉取失败");
    }

    const { uris, errors } = fetchRes;
    if (!uris?.length) {
      throw new Error("订阅中未找到可用节点");
    }

    let preview = `找到 ${uris.length} 个 AnyTLS 节点`;
    if (errors?.length) {
      preview += `\n\n另有 ${errors.length} 行无法识别，将忽略。`;
    }

    const replace = confirm(
      `${preview}\n\n确定 = 替换现有全部节点\n取消 = 追加到现有节点\n\n是否继续导入？`
    );

    const importRes = await chrome.runtime.sendMessage({
      type: "IMPORT_SUBSCRIPTION_URIS",
      uris,
      replace,
    });

    if (!importRes?.ok) {
      throw new Error(importRes?.error || "导入失败");
    }

    settings = await getSettings();
    const message = `已导入 ${importRes.count} 个节点`;
    await saveSubscriptionMeta({
      url,
      lastSyncAt: new Date().toISOString(),
      lastMessage: message,
    });

    await persist();
    alert(message);
    await renderSubscriptionPanel();
  } catch (err) {
    await saveSubscriptionMeta({
      url,
      lastMessage: `失败：${err.message}`,
    });
    await renderSubscriptionPanel();
    alert(`订阅刷新失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "刷新订阅";
  }
}

async function load() {
  settings = await getSettings();
  document.getElementById("versionText").textContent = `v${VERSION}`;
  document.getElementById("extensionIdText").textContent = chrome.runtime.id;
  renderSidebar();
  renderRules();
  await renderTempRules();
  renderDirectRules();
  renderNodes();
  await renderSubscriptionPanel();
  await renderSingboxPanel();
}

function populateRuleNodeSelect(selectedId = null) {
  if (!ruleNodeId) return;

  const current = selectedId ?? "";
  ruleNodeId.innerHTML = `<option value="">默认（当前节点）</option>`;

  for (const node of settings.nodes) {
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = `${node.name || node.host}${node.enabled ? "" : "（已禁用）"}`;
    option.disabled = !node.enabled;
    ruleNodeId.appendChild(option);
  }

  ruleNodeId.value = current;
  if (current && ruleNodeId.value !== current) {
    ruleNodeId.value = "";
  }
}

function openRuleDialog(rule = null, mode = "proxy") {
  ruleDialogMode = mode;
  if (mode === "direct") {
    editingDirectRuleId = rule?.id ?? null;
    editingRuleId = null;
    ruleDialogTitle.textContent = rule ? "编辑直连规则" : "添加直连规则";
    ruleNodeField.hidden = true;
  } else {
    editingRuleId = rule?.id ?? null;
    editingDirectRuleId = null;
    ruleDialogTitle.textContent = rule ? "编辑网址" : "添加网址";
    ruleNodeField.hidden = false;
    populateRuleNodeSelect(rule?.nodeId ?? "");
  }
  rulePattern.value = rule?.pattern ?? "";
  ruleType.value = rule?.type ?? "domain";
  ruleEnabled.checked = rule?.enabled ?? true;
  ruleDialog.showModal();
}

function openNodeDialog(node = null) {
  editingNodeId = node?.id ?? null;
  nodeDialogTitle.textContent = node ? "编辑节点" : "添加节点";
  nodeName.value = node?.name ?? "";
  nodeHost.value = node?.host ?? "";
  nodePort.value = node?.port ?? 443;
  nodePassword.value = node?.password ?? "";
  nodeSni.value = node?.sni ?? "";
  nodeInsecure.checked = node?.insecure ?? false;
  nodeLocalHost.value = node?.localHost ?? "127.0.0.1";
  nodeLocalPort.value = node?.localPort ?? 1080;
  nodeEnabled.checked = node?.enabled ?? true;
  updateConfigPreview();
  nodePassword.type = "password";
  document.getElementById("togglePasswordBtn").textContent = "显示";
  nodeDialog.showModal();
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelectorAll(".rules-subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchRulesSubtab(btn.dataset.rulesSubtab));
});

globalEnabled.addEventListener("change", async () => {
  settings.enabled = globalEnabled.checked;
  await persist();
});

globalProxy.addEventListener("change", async () => {
  settings.globalProxy = globalProxy.checked;
  await persist();
});

autoRetryOn404?.addEventListener("change", async () => {
  settings.autoRetryOn404 = autoRetryOn404.checked;
  await persist();
});

async function saveProjectUrl() {
  const url = projectUrlInput?.value.trim() ?? "";
  if (url) {
    try {
      new URL(url);
    } catch {
      alert("项目网址格式无效，请输入完整的 http/https 地址");
      return;
    }
  }
  settings.projectUrl = url;
  await persist();
  alert(url ? "项目网址已保存" : "项目网址已清除");
}

document.getElementById("saveProjectUrlBtn")?.addEventListener("click", saveProjectUrl);

directBypassEnabled?.addEventListener("change", async () => {
  settings.directBypassEnabled = directBypassEnabled.checked;
  await persist();
});

useBuiltinDirect?.addEventListener("change", async () => {
  settings.useBuiltinDirect = useBuiltinDirect.checked;
  await persist();
});

document.getElementById("addDirectRuleBtn")?.addEventListener("click", () => {
  switchRulesSubtab("direct");
  openRuleDialog(null, "direct");
});

document.getElementById("refreshSingboxBtn")?.addEventListener("click", async () => {
  await renderSingboxPanel();
});
document.getElementById("syncSingboxBtn")?.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SYNC_SINGBOX" });
  await chrome.runtime.sendMessage({ type: "APPLY_PROXY" });
  await renderSingboxPanel();
  alert("已尝试同步 sing-box");
});
document.getElementById("openSystemProxyBtn")?.addEventListener("click", async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: "OPEN_SYSTEM_PROXY_SETTINGS" });
    if (!res?.ok) {
      alert(res?.error || "无法打开系统代理设置");
    }
  } catch (err) {
    alert(err.message || "无法打开系统代理设置");
  }
});

document.getElementById("addRuleBtn").addEventListener("click", () => openRuleDialog());
rulesSearchInput?.addEventListener("input", () => renderRules());
document.getElementById("addNodeBtn").addEventListener("click", () => openNodeDialog());
document.getElementById("importUriBtn").addEventListener("click", () => {
  uriInput.value = "";
  uriDialog.showModal();
});

document.getElementById("ruleCancelBtn").addEventListener("click", () => ruleDialog.close());
document.getElementById("nodeCancelBtn").addEventListener("click", () => nodeDialog.close());
document.getElementById("uriCancelBtn").addEventListener("click", () => uriDialog.close());

[nodeHost, nodePort, nodePassword, nodeSni, nodeInsecure, nodeLocalHost, nodeLocalPort].forEach((el) => {
  el.addEventListener("input", updateConfigPreview);
  el.addEventListener("change", updateConfigPreview);
});

document.getElementById("copyConfigBtn").addEventListener("click", async () => {
  await copyText(nodeConfigPreview.textContent);
});

ruleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const pattern = validateRulePattern(rulePattern.value, ruleType.value);
    const data = {
      pattern,
      type: ruleType.value,
      enabled: ruleEnabled.checked,
    };

    if (ruleDialogMode === "proxy") {
      const selectedNodeId = ruleNodeId?.value || null;
      if (selectedNodeId) {
        const node = settings.nodes.find((n) => n.id === selectedNodeId);
        if (!node) {
          alert("所选节点不存在");
          return;
        }
        if (!node.enabled) {
          alert("所选节点已禁用，请先启用或选择其他节点");
          return;
        }
      }
      data.nodeId = selectedNodeId;
    }

    if (ruleDialogMode === "direct") {
      if (!settings.directRules) settings.directRules = [];
      if (editingDirectRuleId) {
        const idx = settings.directRules.findIndex((r) => r.id === editingDirectRuleId);
        if (idx >= 0) settings.directRules[idx] = { ...settings.directRules[idx], ...data };
      } else {
        settings.directRules.push(createRule(data));
      }
    } else if (editingRuleId) {
      const idx = settings.rules.findIndex((r) => r.id === editingRuleId);
      if (idx >= 0) settings.rules[idx] = { ...settings.rules[idx], ...data };
    } else {
      settings.rules.push(createRule(data));
    }

    ruleDialog.close();
    await persist();
  } catch (err) {
    alert(err.message);
  }
});

nodeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    name: nodeName.value.trim(),
    host: nodeHost.value.trim(),
    port: Number(nodePort.value),
    password: nodePassword.value,
    sni: nodeSni.value.trim(),
    insecure: nodeInsecure.checked,
    localHost: nodeLocalHost.value.trim() || "127.0.0.1",
    localPort: Number(nodeLocalPort.value),
    enabled: nodeEnabled.checked,
  };

  if (editingNodeId) {
    const idx = settings.nodes.findIndex((n) => n.id === editingNodeId);
    if (idx >= 0) settings.nodes[idx] = { ...settings.nodes[idx], ...data };
  } else {
    const node = createNode({
      ...data,
      localPort: data.localPort || getNextLocalPort(settings.nodes),
    });
    settings.nodes.push(node);
    if (!settings.activeNodeId) settings.activeNodeId = node.id;
  }

  nodeDialog.close();
  await persist();
});

uriForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const parsed = parseAnyTlsUri(uriInput.value.trim());
    const node = createNode({
      ...parsed,
      localPort: getNextLocalPort(settings.nodes),
    });
    settings.nodes.push(node);
    if (!settings.activeNodeId) settings.activeNodeId = node.id;
    uriDialog.close();
    await persist();
  } catch (err) {
    alert(err.message);
  }
});

rulesBody.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const id = target.dataset.id;
  const action = target.dataset.action;

  if (action === "toggle-rule") {
    const rule = settings.rules.find((r) => r.id === id);
    if (rule) rule.enabled = target.checked;
    await persist();
  } else if (action === "edit-rule") {
    openRuleDialog(settings.rules.find((r) => r.id === id));
  } else if (action === "delete-rule") {
    if (confirm("确定删除此网址规则？")) {
      settings.rules = settings.rules.filter((r) => r.id !== id);
      await persist();
    }
  }
});

directRulesBody?.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const id = target.dataset.id;
  const action = target.dataset.action;

  if (action === "toggle-direct-rule") {
    const rule = settings.directRules.find((r) => r.id === id);
    if (rule) rule.enabled = target.checked;
    await persist();
  } else if (action === "edit-direct-rule") {
    openRuleDialog(settings.directRules.find((r) => r.id === id), "direct");
  } else if (action === "delete-direct-rule") {
    if (confirm("确定删除此直连规则？")) {
      settings.directRules = settings.directRules.filter((r) => r.id !== id);
      await persist();
    }
  }
});

tempRulesBody?.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const id = target.dataset.id;
  const action = target.dataset.action;

  if (action === "toggle-temp-rule") {
    await updateTempRule(id, { enabled: target.checked });
    await applyTempRulesProxy();
    return;
  }

  if (action === "delete-temp-rule") {
    if (!confirm("确定删除此临时代理规则？")) return;
    await removeTempRule(id);
    await applyTempRulesProxy();
    await renderTempRules();
    return;
  }

  if (action === "promote-temp-rule") {
    const tempRules = await getTempRules();
    const tempRule = tempRules.find((rule) => rule.id === id);
    if (!tempRule) return;

    promoteTempRuleToPermanent(settings, tempRule, createRule);
    await removeTempRule(id);
    await persist();
  }
});

nodesList.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const id = target.dataset.id;
  const node = settings.nodes.find((n) => n.id === id);
  if (!node) return;

  switch (target.dataset.action) {
    case "activate-node":
      settings.activeNodeId = id;
      await persist();
      break;
    case "copy-uri":
      await copyText(buildAnyTlsUri(node));
      break;
    case "copy-singbox":
      await copyText(buildSingBoxConfigJson(node));
      break;
    case "edit-node":
      openNodeDialog(node);
      break;
    case "delete-node": {
      const usedCount = countRulesUsingNode(settings, id);
      let message = "确定删除此节点？";
      if (usedCount) {
        message = `有 ${usedCount} 条代理规则指定了此节点，删除后将改用默认节点。\n\n确定删除？`;
      }
      if (!confirm(message)) break;

      settings.nodes = settings.nodes.filter((n) => n.id !== id);
      for (const rule of settings.rules) {
        if (rule.nodeId === id) rule.nodeId = null;
      }
      if (settings.activeNodeId === id) {
        settings.activeNodeId = settings.nodes.find((n) => n.enabled)?.id ?? null;
      }
      await persist();
      break;
    }
  }
});

async function importRulesFromFile() {
  try {
    const data = await pickJsonFile();
    const items = parseRulesImport(data);
    if (!items.length) {
      alert("文件中没有可导入的规则");
      return;
    }

    const replace = confirm(
      "导入模式选择：\n\n确定 = 替换现有全部规则\n取消 = 追加到现有规则"
    );

    const validNodeIds = new Set(settings.nodes.map((n) => n.id));
    const sanitizedItems = items.map((item, index) => {
      try {
        return sanitizeRuleItem(item, { validNodeIds });
      } catch (err) {
        throw new Error(`第 ${index + 1} 条规则无效：${err.message}`);
      }
    });

    const warnings = detectRuleImportIssues(settings.rules, sanitizedItems, { replace });
    if (warnings.length) {
      const preview = warnings.slice(0, 8).join("\n");
      const more = warnings.length > 8 ? `\n… 共 ${warnings.length} 条` : "";
      const proceed = confirm(`发现 ${warnings.length} 条潜在问题：\n\n${preview}${more}\n\n仍要继续导入吗？`);
      if (!proceed) return;
    }

    const imported = sanitizedItems.map((item) => createRule(item));

    if (replace) {
      settings.rules = imported;
    } else {
      settings.rules.push(...imported);
    }

    await persist();
    alert(`成功导入 ${imported.length} 条网址规则`);
  } catch (err) {
    if (err.message !== "未选择文件") {
      alert(`导入失败：${err.message}`);
    }
  }
}

function exportRulesToFile() {
  if (!settings.rules.length) {
    alert("暂无网址规则可导出");
    return;
  }
  const payload = buildRulesExportPayload(settings.rules);
  downloadJsonFile(`anytls-rules-${timestampForFilename()}.json`, payload);
}

async function importNodesFromFile() {
  try {
    const data = await pickJsonFile();
    const { nodes: items, activeNodeId: importedActiveId } = parseNodesImport(data);
    if (!items.length) {
      alert("文件中没有可导入的节点");
      return;
    }

    const replace = confirm(
      "导入模式选择：\n\n确定 = 替换现有全部节点\n取消 = 追加到现有节点"
    );

    const imported = [];
    for (let index = 0; index < items.length; index++) {
      try {
        const sanitized = sanitizeNodeItem(items[index]);
        const existing = replace ? imported : [...settings.nodes, ...imported];
        const usedPorts = new Set(existing.map((n) => n.localPort));
        let localPort = sanitized.localPort;
        if (!localPort || usedPorts.has(localPort)) {
          localPort = getNextLocalPort(existing);
        }
        imported.push(createNode({ ...sanitized, localPort }));
      } catch (err) {
        throw new Error(`第 ${index + 1} 个节点无效：${err.message}`);
      }
    }

    if (replace) {
      settings.nodes = imported;
      settings.activeNodeId = importedActiveId || imported.find((n) => n.enabled)?.id || imported[0]?.id || null;
    } else {
      settings.nodes.push(...imported);
      if (!settings.activeNodeId) {
        settings.activeNodeId = imported.find((n) => n.enabled)?.id || null;
      }
    }

    await persist();
    alert(`成功导入 ${imported.length} 个节点`);
  } catch (err) {
    if (err.message !== "未选择文件") {
      alert(`导入失败：${err.message}`);
    }
  }
}

function exportNodesToFile(stripPasswords = false) {
  if (!settings.nodes.length) {
    alert("暂无节点可导出");
    return;
  }
  const payload = buildNodesExportPayload(settings.nodes, settings.activeNodeId, { stripPasswords });
  const suffix = stripPasswords ? "-safe" : "";
  downloadJsonFile(`anytls-nodes${suffix}-${timestampForFilename()}.json`, payload);
}

function exportFullConfig() {
  const stripPasswords = confirm(
    "密码选项：\n\n确定 = 导出无密码版本（便于分享）\n取消 = 完整备份（含密码）"
  );
  (async () => {
    const meta = await getSubscriptionMeta();
    const payload = buildFullExportPayload(settings, {
      stripPasswords,
      subscription: buildSubscriptionExport(meta),
    });
    const suffix = stripPasswords ? "-safe" : "";
    downloadJsonFile(`anytls-full${suffix}-${timestampForFilename()}.json`, payload);
  })();
}

async function importFullConfig() {
  try {
    const data = await pickJsonFile();
    const full = parseFullImport(data);

    if (
      !confirm(
        "将用备份文件替换当前全部配置（节点、规则、开关状态）。\n\n确定继续？"
      )
    ) {
      return;
    }

    const importedNodes = [];
    for (let index = 0; index < (full.nodes || []).length; index++) {
      try {
        const sanitized = sanitizeNodeItem(full.nodes[index]);
        const usedPorts = new Set(importedNodes.map((n) => n.localPort));
        let localPort = sanitized.localPort;
        if (!localPort || usedPorts.has(localPort)) {
          localPort = getNextLocalPort(importedNodes);
        }
        importedNodes.push(createNode({ ...sanitized, localPort }));
      } catch (err) {
        throw new Error(`第 ${index + 1} 个节点无效：${err.message}`);
      }
    }

    const validNodeIds = new Set(importedNodes.map((n) => n.id));
    const sanitizedRules = (full.rules || []).map((item, index) => {
      try {
        return sanitizeRuleItem(item, { validNodeIds });
      } catch (err) {
        throw new Error(`第 ${index + 1} 条规则无效：${err.message}`);
      }
    });

    const ruleWarnings = detectRuleImportIssues([], sanitizedRules, { replace: true });
    if (ruleWarnings.length) {
      const preview = ruleWarnings.slice(0, 8).join("\n");
      const more = ruleWarnings.length > 8 ? `\n… 共 ${ruleWarnings.length} 条` : "";
      const proceed = confirm(`备份中的规则存在 ${ruleWarnings.length} 条潜在问题：\n\n${preview}${more}\n\n仍要继续导入吗？`);
      if (!proceed) return;
    }

    const importedRules = sanitizedRules.map((item) => createRule(item));

    settings.enabled = Boolean(full.enabled);
    settings.globalProxy = Boolean(full.globalProxy);
    settings.autoRetryOn404 = Boolean(full.autoRetryOn404);
    settings.projectUrl = typeof full.projectUrl === "string" ? full.projectUrl : settings.projectUrl;
    settings.directBypassEnabled = full.directBypassEnabled !== false;
    settings.useBuiltinDirect = full.useBuiltinDirect !== false;
    settings.rules = importedRules;
    settings.directRules = (full.directRules || []).map((item, index) => {
      try {
        return createRule(sanitizeRuleItem(item));
      } catch (err) {
        throw new Error(`第 ${index + 1} 条直连规则无效：${err.message}`);
      }
    });
    settings.nodes = importedNodes;
    settings.activeNodeId =
      full.activeNodeId && importedNodes.some((n) => n.id === full.activeNodeId)
        ? full.activeNodeId
        : importedNodes.find((n) => n.enabled)?.id ?? importedNodes[0]?.id ?? null;

    await applySubscriptionImport(full.subscription);
    await persist();
    await renderSubscriptionPanel();
    alert(
      `已恢复配置：${importedNodes.length} 个节点、${importedRules.length} 条规则`
    );
  } catch (err) {
    if (err.message !== "未选择文件") {
      alert(`导入失败：${err.message}`);
    }
  }
}

document.getElementById("saveSubscriptionBtn")?.addEventListener("click", saveSubscriptionUrl);
document.getElementById("refreshSubscriptionBtn")?.addEventListener("click", refreshSubscription);
subscriptionAutoRefreshInput?.addEventListener("change", () => {
  if (subscriptionRefreshHoursSelect) {
    subscriptionRefreshHoursSelect.disabled = !subscriptionAutoRefreshInput.checked;
  }
});

document.getElementById("exportRulesBtn").addEventListener("click", exportRulesToFile);
document.getElementById("importRulesBtn").addEventListener("click", importRulesFromFile);
document.getElementById("exportNodesBtn").addEventListener("click", () => exportNodesToFile(false));
document.getElementById("exportNodesSafeBtn").addEventListener("click", () => exportNodesToFile(true));
document.getElementById("importNodesBtn").addEventListener("click", importNodesFromFile);
document.getElementById("exportFullBtn").addEventListener("click", exportFullConfig);
document.getElementById("importFullBtn").addEventListener("click", importFullConfig);
document.getElementById("copyExtensionIdBtn").addEventListener("click", async () => {
  try {
    await copyText(chrome.runtime.id);
    alert("扩展 ID 已复制");
  } catch {
    alert("复制失败");
  }
});

document.getElementById("refreshLogsBtn")?.addEventListener("click", renderSingboxLogs);
document.getElementById("clearLogsBtn")?.addEventListener("click", clearSingboxLogsPanel);
document.getElementById("copyLogsBtn")?.addEventListener("click", async () => {
  const text = singboxLogPanel?.textContent || "";
  if (!text || text === "加载中…") {
    alert("暂无日志可复制");
    return;
  }
  try {
    await copyText(text);
    alert("日志已复制");
  } catch {
    alert("复制失败");
  }
});

document.getElementById("togglePasswordBtn")?.addEventListener("click", () => {
  const show = nodePassword.type === "password";
  nodePassword.type = show ? "text" : "password";
  document.getElementById("togglePasswordBtn").textContent = show ? "隐藏" : "显示";
});

load();
