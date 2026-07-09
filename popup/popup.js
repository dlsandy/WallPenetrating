import {
  getSettings,
  createNode,
  createRule,
  getActiveNode,
  getNextLocalPort,
} from "../lib/storage.js";
import { parseAnyTlsUri } from "../lib/anytls-uri.js";
import {
  renderPopupNodeItem,
  nodeDisplayName,
  readNodeForm,
  fillNodeForm,
  getSingboxPreview,
} from "../lib/node-ui.js";
import { buildSingBoxConfigJson } from "../lib/singbox-config.js";
import { persistSettings } from "../lib/persist-settings.js";
import { patternFromTabUrl, findDomainRule, upsertDomainRule, upsertWildcardRule, removeDomainRule, shouldOfferWildcardRule } from "../lib/site-rules.js";
import { resolveRuleNode } from "../lib/routing.js";
import { findDirectBypassMatch } from "../lib/direct-bypass.js";

let settings = null;
let editingNodeId = null;

const toggleEnabled = document.getElementById("toggleEnabled");
const globalProxyToggle = document.getElementById("globalProxy");
const statusText = document.getElementById("statusText");
const nodeText = document.getElementById("nodeText");
const rulesText = document.getElementById("rulesText");
const nodeSelect = document.getElementById("nodeSelect");
const singboxStatus = document.getElementById("singboxStatus");
const hintText = document.getElementById("hintText");
const diagList = document.getElementById("diagList");
const nodesList = document.getElementById("nodesList");
const currentSiteLabel = document.getElementById("currentSiteLabel");
const addCurrentSiteBtn = document.getElementById("addCurrentSiteBtn");
const removeCurrentSiteBtn = document.getElementById("removeCurrentSiteBtn");

const nodeDialog = document.getElementById("nodeDialog");
const nodeForm = document.getElementById("nodeForm");
const nodeDialogTitle = document.getElementById("nodeDialogTitle");
const uriDialog = document.getElementById("uriDialog");
const uriForm = document.getElementById("uriForm");
const uriInput = document.getElementById("uriInput");

const nodeFields = {
  name: document.getElementById("nodeName"),
  host: document.getElementById("nodeHost"),
  port: document.getElementById("nodePort"),
  password: document.getElementById("nodePassword"),
  sni: document.getElementById("nodeSni"),
  insecure: document.getElementById("nodeInsecure"),
  localHost: document.getElementById("nodeLocalHost"),
  localPort: document.getElementById("nodeLocalPort"),
  enabled: document.getElementById("nodeEnabled"),
};

const nodeConfigPreview = document.getElementById("nodeConfigPreview");
const toast = document.createElement("div");
toast.className = "toast";
document.body.appendChild(toast);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function switchView(viewId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.id === `view-${viewId}`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
}

function updateConfigPreview() {
  nodeConfigPreview.textContent = getSingboxPreview(nodeFields);
}

async function loadSettings() {
  settings = await getSettings();
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
}

async function renderCurrentSite() {
  addCurrentSiteBtn.disabled = true;
  addCurrentSiteBtn.hidden = false;
  removeCurrentSiteBtn.hidden = true;
  addCurrentSiteBtn.textContent = "加入规则";
  currentSiteLabel.classList.remove("ready");

  let tabUrl;
  try {
    tabUrl = await getActiveTabUrl();
  } catch (err) {
    currentSiteLabel.textContent = `当前页：${err.message || "无法获取标签页"}`;
    return;
  }

  const parsed = patternFromTabUrl(tabUrl);
  if (!parsed.ok) {
    currentSiteLabel.textContent = parsed.error ? `当前页：${parsed.error}` : "当前页：无法添加";
    return;
  }

  if (!settings) {
    await loadSettings();
  }

  const directMatch = findDirectBypassMatch(parsed.pattern, settings);
  if (directMatch) {
    currentSiteLabel.classList.add("ready");
    const label = directMatch.builtin ? "内置直连" : "直连名单";
    currentSiteLabel.textContent = `当前页：${parsed.pattern}（${label}，不代理）`;
    addCurrentSiteBtn.hidden = true;
    removeCurrentSiteBtn.hidden = true;
    return;
  }

  const existing = findDomainRule(settings.rules, parsed.pattern);

  currentSiteLabel.classList.add("ready");

  if (existing?.enabled) {
    const node = resolveRuleNode(existing, settings);
    const nodeHint = node ? ` · ${nodeDisplayName(node)}` : "";
    currentSiteLabel.textContent = `当前页：${parsed.pattern}（已在规则中${nodeHint}）`;
    addCurrentSiteBtn.hidden = true;
    removeCurrentSiteBtn.hidden = false;
    return;
  }

  if (existing) {
    currentSiteLabel.textContent = `当前页：${parsed.pattern}（已禁用）`;
    addCurrentSiteBtn.textContent = "启用规则";
  } else {
    currentSiteLabel.textContent = `当前页：${parsed.pattern}`;
    addCurrentSiteBtn.textContent = "加入规则";
  }

  addCurrentSiteBtn.disabled = false;
}

async function addCurrentSiteToRules() {
  let tabUrl;
  try {
    tabUrl = await getActiveTabUrl();
  } catch (err) {
    showToast(err.message || "无法获取当前页");
    return;
  }

  const parsed = patternFromTabUrl(tabUrl);
  if (!parsed.ok) {
    showToast(parsed.error || "无法添加");
    return;
  }

  if (!settings) {
    await loadSettings();
  }

  const directMatch = findDirectBypassMatch(parsed.pattern, settings);
  if (directMatch) {
    showToast(`「${parsed.pattern}」在直连名单中，无法加入代理规则`);
    return;
  }

  const { status, overlap } = upsertDomainRule(settings.rules, parsed.pattern, createRule);

  let wildcardNote = "";
  const wildcardPattern = shouldOfferWildcardRule(settings.rules, parsed.pattern, status);
  if (wildcardPattern) {
    const addWildcard = confirm(
      `是否同时添加通配符规则「${wildcardPattern}」？\n\n确定 = 同时添加\n取消 = 仅保留域名规则「${parsed.pattern}」`
    );
    if (addWildcard) {
      const wildcardResult = upsertWildcardRule(settings.rules, wildcardPattern, createRule);
      if (wildcardResult.status === "added") {
        wildcardNote = `，已添加 ${wildcardPattern}`;
      } else if (wildcardResult.status === "enabled") {
        wildcardNote = `，已启用 ${wildcardPattern}`;
      }
    }
  }

  await persistSettings(settings);

  await renderOverview();
  await renderCurrentSite();
  await renderDiagnostics();

  const messages = {
    added: `已添加 ${parsed.pattern}`,
    enabled: `已启用 ${parsed.pattern}`,
    duplicate: `${parsed.pattern} 已在规则中`,
  };
  const overlapWarning = overlap ? `与规则「${overlap}」可能重复` : null;
  showToast(
    overlapWarning
      ? `${messages[status] || "已更新"}${wildcardNote}（${overlapWarning}）`
      : `${messages[status] || "已更新规则"}${wildcardNote}`
  );
}

async function removeCurrentSiteFromRules() {
  let tabUrl;
  try {
    tabUrl = await getActiveTabUrl();
  } catch (err) {
    showToast(err.message || "无法获取当前页");
    return;
  }

  const parsed = patternFromTabUrl(tabUrl);
  if (!parsed.ok) {
    showToast(parsed.error || "无法移除");
    return;
  }

  if (!settings) {
    await loadSettings();
  }

  const { removed } = removeDomainRule(settings.rules, parsed.pattern);
  if (!removed) {
    showToast("当前页不在规则列表中");
    return;
  }

  await persistSettings(settings);

  await renderOverview();
  await renderCurrentSite();
  await renderDiagnostics();
  showToast(`已移出 ${parsed.pattern}`);
}

async function testNodeConnection() {
  const btn = document.getElementById("testNodeBtn");
  btn.disabled = true;
  btn.textContent = "测试中…";

  try {
    const res = await chrome.runtime.sendMessage({ type: "TEST_NODE_CONNECTIVITY" });
    if (res?.ok) {
      const parts = [`代理可用 (HTTP ${res.httpCode || 204})`];
      if (res.remoteOk !== undefined) {
        parts.push(res.remoteOk ? "远程服务器可达" : "远程服务器不可达");
      }
      showToast(parts.join("，"));
    } else {
      showToast(res?.message || res?.error || "连接测试失败");
    }
    await renderDiagnostics();
  } finally {
    btn.disabled = false;
    btn.textContent = "测试连接";
  }
}

async function copyExtensionId() {
  try {
    const id = chrome.runtime.id;
    await navigator.clipboard.writeText(id);
    showToast("扩展 ID 已复制");
  } catch {
    showToast("复制失败");
  }
}

async function renderDiagnostics() {
  const diag = await chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" });
  diagList.innerHTML = "";

  if (!diag?.ok) return;

  const items = [];

  if (diag.settings.enabled && diag.node) {
    if (diag.settings.globalProxy) {
      items.push({ text: "全局代理已开启，所有网页走 AnyTLS", level: "ok" });
    } else if (diag.enabledRuleCount > 0) {
      items.push({ text: `PAC 已注入，${diag.enabledRuleCount} 条规则生效`, level: "ok" });
    }
  }

  if (diag.node?.sni) {
    items.push({ text: `SNI: ${diag.node.sni}`, level: "ok" });
  }

  for (const issue of diag.issues || []) {
    const level = issue.includes("未") || issue.includes("缺少") || issue.includes("失败")
      ? "error"
      : issue.includes("运行中") || issue.includes("已就绪")
        ? "ok"
        : "warn";
    items.push({ text: issue, level });
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item.text;
    li.className = item.level;
    diagList.appendChild(li);
  }
}

async function persist() {
  await persistSettings(settings);
  await renderOverview();
  renderNodesList();
  await renderDiagnostics();
}

async function renderSingboxStatus() {
  const status = await chrome.runtime.sendMessage({ type: "GET_SINGBOX_STATUS" });
  singboxStatus.className = "singbox-status";

  if (!status.hostAvailable) {
    singboxStatus.textContent = "sing-box: 需安装 Native Host";
    singboxStatus.classList.add("warn");
    return;
  }

  if (status.binaryExists === false) {
    singboxStatus.textContent = "sing-box: 缺失（bin/sing-box.exe 不存在）";
    singboxStatus.classList.add("warn");
    return;
  }

  if (status.running) {
    singboxStatus.textContent = `sing-box: 运行中 (PID ${status.pid})`;
    singboxStatus.classList.add("ok");
  } else if (settings.enabled) {
    singboxStatus.textContent = "sing-box: 未运行";
    singboxStatus.classList.add("error");
  } else {
    singboxStatus.textContent = "sing-box: 已就绪，开启分流后自动启动";
    singboxStatus.classList.add("ok");
  }
}

async function renderOverview() {
  const node = getActiveNode(settings);
  const enabledRules = settings.rules.filter((r) => r.enabled && r.pattern.trim());
  const ready = settings.enabled && node && (settings.globalProxy || enabledRules.length > 0);

  toggleEnabled.checked = settings.enabled;
  globalProxyToggle.checked = settings.globalProxy;

  if (ready) {
    statusText.textContent = settings.globalProxy ? "全局代理" : "已启用";
    statusText.className = "value on";
  } else if (settings.enabled) {
    statusText.textContent = "未就绪";
    statusText.className = "value off";
  } else {
    statusText.textContent = "已关闭";
    statusText.className = "value off";
  }

  nodeText.textContent = node ? nodeDisplayName(node) : "未选择";
  rulesText.textContent = settings.globalProxy ? "全局（规则不生效）" : `${enabledRules.length} 条`;

  nodeSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = settings.nodes.length ? "快速切换节点…" : "暂无节点";
  nodeSelect.appendChild(placeholder);

  for (const n of settings.nodes.filter((item) => item.enabled)) {
    const opt = document.createElement("option");
    opt.value = n.id;
    opt.textContent = nodeDisplayName(n);
    if (n.id === settings.activeNodeId) opt.selected = true;
    nodeSelect.appendChild(opt);
  }

  if (settings.enabled && !node) {
    hintText.textContent = "请先在「节点管理」中添加并选择一个节点。";
    hintText.className = "hint warn";
  } else if (settings.enabled && !settings.globalProxy && enabledRules.length === 0) {
    hintText.textContent = "请至少启用一条网址规则，或开启「全局代理」。";
    hintText.className = "hint warn";
  } else if (settings.enabled && node && settings.globalProxy) {
    hintText.textContent = `全局代理：所有网页经 ${node.localHost}:${node.localPort} 走 AnyTLS（局域网除外）。`;
    hintText.className = "hint";
  } else if (settings.enabled && node) {
    hintText.textContent = `sing-box 将代理至 ${node.localHost}:${node.localPort}，匹配网址走 AnyTLS 节点。`;
    hintText.className = "hint";
  } else {
    hintText.textContent = "开启分流后，sing-box 自动启动；可开启全局代理或按规则分流。";
    hintText.className = "hint";
  }

  await renderSingboxStatus();
}

function renderNodesList() {
  if (!settings.nodes.length) {
    nodesList.innerHTML = `<div class="empty-state">暂无节点<br />点击「添加节点」或「URI 导入」</div>`;
    return;
  }

  nodesList.innerHTML = settings.nodes
    .map((node) => renderPopupNodeItem(node, settings.activeNodeId === node.id))
    .join("");
}

function openNodeDialog(node = null) {
  editingNodeId = node?.id ?? null;
  nodeDialogTitle.textContent = node ? "编辑节点" : "添加节点";

  if (node) {
    fillNodeForm(nodeFields, node);
  } else {
    fillNodeForm(nodeFields, {
      localHost: "127.0.0.1",
      localPort: getNextLocalPort(settings.nodes),
      enabled: true,
    });
    nodeFields.password.value = "";
  }

  updateConfigPreview();
  nodeFields.password.type = "password";
  document.getElementById("togglePasswordBtn").textContent = "显示";
  nodeDialog.showModal();
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  showToast("已复制到剪贴板");
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

toggleEnabled.addEventListener("change", async () => {
  settings.enabled = toggleEnabled.checked;
  await persist();
});

globalProxyToggle.addEventListener("change", async () => {
  settings.globalProxy = globalProxyToggle.checked;
  await persist();
});

nodeSelect.addEventListener("change", async () => {
  settings.activeNodeId = nodeSelect.value || null;
  await persist();
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

addCurrentSiteBtn.addEventListener("click", addCurrentSiteToRules);
removeCurrentSiteBtn.addEventListener("click", removeCurrentSiteFromRules);
document.getElementById("testNodeBtn").addEventListener("click", testNodeConnection);
document.getElementById("copyExtensionIdBtn").addEventListener("click", copyExtensionId);

document.getElementById("addNodeBtn").addEventListener("click", () => openNodeDialog());
document.getElementById("importUriBtn").addEventListener("click", () => {
  uriInput.value = "";
  uriDialog.showModal();
});

document.getElementById("nodeCancelBtn").addEventListener("click", () => nodeDialog.close());
document.getElementById("uriCancelBtn").addEventListener("click", () => uriDialog.close());

Object.values(nodeFields).forEach((el) => {
  if (el.type === "hidden") return;
  el.addEventListener("input", updateConfigPreview);
  el.addEventListener("change", updateConfigPreview);
});

document.getElementById("copyConfigBtn").addEventListener("click", async () => {
  await copyText(nodeConfigPreview.textContent);
});

nodeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = readNodeForm(nodeFields);

  if (!data.host || !data.password) {
    showToast("请填写服务器和密码");
    return;
  }

  if (editingNodeId) {
    const idx = settings.nodes.findIndex((n) => n.id === editingNodeId);
    if (idx >= 0) settings.nodes[idx] = { ...settings.nodes[idx], ...data };
  } else {
    const node = createNode(data);
    settings.nodes.push(node);
    if (!settings.activeNodeId) settings.activeNodeId = node.id;
  }

  nodeDialog.close();
  await persist();
  showToast("节点已保存");
});

uriForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const parsed = parseAnyTlsUri(uriInput.value.trim());
    const node = createNode({
      ...parsed,
      localHost: "127.0.0.1",
      localPort: getNextLocalPort(settings.nodes),
    });
    settings.nodes.push(node);
    if (!settings.activeNodeId) settings.activeNodeId = node.id;
    uriDialog.close();
    await persist();
    showToast("节点导入成功");
  } catch (err) {
    showToast(err.message);
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
      showToast("已切换节点");
      break;
    case "edit-node":
      openNodeDialog(node);
      break;
    case "copy-singbox":
      await copyText(buildSingBoxConfigJson(node));
      showToast("sing-box 配置已复制");
      break;
    case "delete-node":
      if (confirm(`确定删除节点「${nodeDisplayName(node)}」？`)) {
        settings.nodes = settings.nodes.filter((n) => n.id !== id);
        if (settings.activeNodeId === id) {
          settings.activeNodeId = settings.nodes.find((n) => n.enabled)?.id ?? null;
        }
        await persist();
        showToast("节点已删除");
      }
      break;
  }
});

document.getElementById("togglePasswordBtn").addEventListener("click", () => {
  const input = nodeFields.password;
  const btn = document.getElementById("togglePasswordBtn");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.textContent = show ? "隐藏" : "显示";
});

document.getElementById("repairBtn").addEventListener("click", async () => {
  const uri = prompt(
    "粘贴完整的 AnyTLS URI 以修复 SNI 等参数：",
    settings.nodes.find((n) => n.id === settings.activeNodeId)?.rawUri || ""
  );
  if (!uri) return;

  try {
    const parsed = parseAnyTlsUri(uri.trim());
    const idx = settings.nodes.findIndex((n) => n.id === settings.activeNodeId);
    if (idx >= 0) {
      settings.nodes[idx] = {
        ...settings.nodes[idx],
        ...parsed,
        id: settings.nodes[idx].id,
        localHost: settings.nodes[idx].localHost,
        localPort: settings.nodes[idx].localPort,
      };
    } else {
      const node = createNode({
        ...parsed,
        localPort: getNextLocalPort(settings.nodes),
      });
      settings.nodes.push(node);
      settings.activeNodeId = node.id;
    }
    await persist();
    showToast("节点配置已修复");
  } catch (err) {
    showToast(err.message);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  const shouldReload =
    (area === "sync" && changes.settings) || (area === "local" && (changes.nodes || changes.activeNodeId));
  if (shouldReload) {
    loadSettings().then(async () => {
      renderOverview();
      renderNodesList();
      await renderCurrentSite();
      await renderDiagnostics();
    });
  }
});

async function init() {
  await chrome.runtime.sendMessage({ type: "MIGRATE_SETTINGS" });
  await loadSettings();
  renderOverview();
  renderNodesList();
  await renderCurrentSite();
  await renderDiagnostics();
}

init();
