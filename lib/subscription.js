import { parseAnyTlsUri } from "./anytls-uri.js";

export const SUBSCRIPTION_ALARM = "subscription-refresh";

function extractUrisFromLines(text) {
  const uris = [];
  const errors = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("anytls://")) {
      uris.push(trimmed);
      continue;
    }
    errors.push(`无法识别: ${trimmed.slice(0, 48)}${trimmed.length > 48 ? "…" : ""}`);
  }

  return { uris, errors };
}

function extractUrisFromJson(data) {
  const items = Array.isArray(data) ? data : data?.nodes;
  if (!Array.isArray(items)) {
    throw new Error("JSON 格式错误：需要节点数组或 nodes 字段");
  }

  const uris = [];
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item === "string" && item.startsWith("anytls://")) {
      uris.push(item.trim());
      continue;
    }
    if (item?.rawUri?.startsWith("anytls://")) {
      uris.push(item.rawUri.trim());
      continue;
    }
    errors.push(`第 ${i + 1} 项不是有效的 AnyTLS URI`);
  }

  return { uris, errors };
}

export function parseSubscriptionContent(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("订阅内容为空");
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const result = extractUrisFromJson(JSON.parse(trimmed));
      if (!result.uris.length) throw new Error("JSON 中未找到 anytls:// 节点");
      return result;
    } catch (err) {
      if (err.message.startsWith("JSON") || err.message.includes("未找到")) throw err;
      /* fall through to line/base64 parsing */
    }
  }

  if (!trimmed.includes("://") && /^[A-Za-z0-9+/=\s_-]+$/.test(trimmed.slice(0, Math.min(80, trimmed.length)))) {
    try {
      const decoded = atob(trimmed.replace(/\s/g, ""));
      return parseSubscriptionContent(decoded);
    } catch {
      /* fall through */
    }
  }

  const result = extractUrisFromLines(trimmed);
  if (!result.uris.length) {
    throw new Error("未找到 anytls:// 节点链接");
  }
  return result;
}

export function buildNodesFromSubscriptionUris(uris, { createNode, getNextLocalPort, existingNodes, replace }) {
  const imported = [];

  for (let index = 0; index < uris.length; index++) {
    try {
      const parsed = parseAnyTlsUri(uris[index]);
      const existing = replace ? imported : [...existingNodes, ...imported];
      imported.push(
        createNode({
          ...parsed,
          localHost: "127.0.0.1",
          localPort: getNextLocalPort(existing),
          enabled: true,
        })
      );
    } catch (err) {
      throw new Error(`第 ${index + 1} 个节点无效：${err.message}`);
    }
  }

  return imported;
}

export async function getSubscriptionMeta() {
  const data = await chrome.storage.local.get([
    "subscriptionUrl",
    "subscriptionLastSyncAt",
    "subscriptionLastMessage",
    "subscriptionAutoRefresh",
    "subscriptionRefreshHours",
  ]);
  return {
    url: data.subscriptionUrl ?? "",
    lastSyncAt: data.subscriptionLastSyncAt ?? null,
    lastMessage: data.subscriptionLastMessage ?? "",
    autoRefresh: Boolean(data.subscriptionAutoRefresh),
    refreshHours: Number(data.subscriptionRefreshHours) || 24,
  };
}

export async function saveSubscriptionMeta({ url, lastSyncAt, lastMessage, autoRefresh, refreshHours }) {
  const patch = {};
  if (url !== undefined) patch.subscriptionUrl = url;
  if (lastSyncAt !== undefined) patch.subscriptionLastSyncAt = lastSyncAt;
  if (lastMessage !== undefined) patch.subscriptionLastMessage = lastMessage;
  if (autoRefresh !== undefined) patch.subscriptionAutoRefresh = autoRefresh;
  if (refreshHours !== undefined) patch.subscriptionRefreshHours = refreshHours;
  await chrome.storage.local.set(patch);
  if (url !== undefined || autoRefresh !== undefined || refreshHours !== undefined) {
    await syncSubscriptionAlarm();
  }
}

export async function syncSubscriptionAlarm() {
  await chrome.alarms.clear(SUBSCRIPTION_ALARM);

  const meta = await getSubscriptionMeta();
  if (!meta.autoRefresh || !meta.url) return;

  const periodMinutes = Math.max(60, Math.round(meta.refreshHours * 60));
  await chrome.alarms.create(SUBSCRIPTION_ALARM, {
    delayInMinutes: periodMinutes,
    periodInMinutes: periodMinutes,
  });
}

export function buildSubscriptionExport(meta) {
  return {
    url: meta.url || "",
    autoRefresh: meta.autoRefresh,
    refreshHours: meta.refreshHours,
    lastSyncAt: meta.lastSyncAt,
    lastMessage: meta.lastMessage || "",
  };
}

export async function applySubscriptionImport(subscription) {
  if (!subscription || typeof subscription !== "object") return;

  await saveSubscriptionMeta({
    url: subscription.url ?? "",
    lastSyncAt: subscription.lastSyncAt ?? null,
    lastMessage: subscription.lastMessage ?? "",
    autoRefresh: Boolean(subscription.autoRefresh),
    refreshHours: Number(subscription.refreshHours) || 24,
  });
}
