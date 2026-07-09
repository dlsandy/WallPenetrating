import { validateRulePattern } from "./rule-validation.js";

export function downloadJsonFile(filename, data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("未选择文件"));
        return;
      }
      try {
        const text = await file.text();
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new Error(err.message === "Unexpected token" ? "JSON 格式无效" : err.message));
      }
    });
    input.click();
  });
}

export function buildFullExportPayload(settings, { stripPasswords = false, subscription = null } = {}) {
  const nodes = stripPasswords
    ? settings.nodes.map((node) => ({ ...node, password: "" }))
    : settings.nodes;

  const payload = {
    version: 1,
    type: "anytls-full",
    exportedAt: new Date().toISOString(),
    stripPasswords,
    enabled: settings.enabled,
    globalProxy: settings.globalProxy,
    autoRetryOn404: Boolean(settings.autoRetryOn404),
    projectUrl: settings.projectUrl ?? "",
    directBypassEnabled: settings.directBypassEnabled !== false,
    useBuiltinDirect: settings.useBuiltinDirect !== false,
    directRules: settings.directRules ?? [],
    activeNodeId: settings.activeNodeId,
    rules: settings.rules,
    nodes,
  };

  if (subscription) {
    payload.subscription = subscription;
  }

  return payload;
}

export function parseFullImport(data) {
  if (data?.type === "anytls-full") {
    return data;
  }
  throw new Error("格式错误：需要 anytls-full 完整配置备份");
}

export function buildRulesExportPayload(rules) {
  return {
    version: 1,
    type: "anytls-rules",
    exportedAt: new Date().toISOString(),
    rules,
  };
}

export function buildNodesExportPayload(nodes, activeNodeId = null, { stripPasswords = false } = {}) {
  const exportNodes = stripPasswords
    ? nodes.map((node) => ({ ...node, password: "" }))
    : nodes;
  return {
    version: 1,
    type: "anytls-nodes",
    exportedAt: new Date().toISOString(),
    activeNodeId,
    stripPasswords,
    nodes: exportNodes,
  };
}

export function parseRulesImport(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rules)) return data.rules;
  throw new Error("格式错误：需要 rules 数组或纯数组");
}

export function parseNodesImport(data) {
  if (Array.isArray(data)) return { nodes: data, activeNodeId: null };
  if (data && Array.isArray(data.nodes)) {
    return { nodes: data.nodes, activeNodeId: data.activeNodeId ?? null };
  }
  throw new Error("格式错误：需要 nodes 数组或纯数组");
}

export function sanitizeRuleItem(item, { validNodeIds = null } = {}) {
  if (!item?.pattern?.trim()) {
    throw new Error("规则缺少 pattern 字段");
  }
  const type = item.type || "domain";
  if (!["domain", "wildcard", "regex"].includes(type)) {
    throw new Error(`无效的规则类型: ${type}`);
  }
  const pattern = validateRulePattern(item.pattern, type);
  const result = {
    pattern,
    type,
    enabled: item.enabled !== false,
  };

  if (item.nodeId) {
    const nodeId = String(item.nodeId);
    if (!validNodeIds || validNodeIds.has(nodeId)) {
      result.nodeId = nodeId;
    }
  }

  return result;
}

export function sanitizeNodeItem(item) {
  if (!item?.host?.trim()) {
    throw new Error("节点缺少 host 字段");
  }
  return {
    name: item.name?.trim() || "",
    host: item.host.trim(),
    port: Number(item.port) || 443,
    password: item.password ? String(item.password) : "",
    sni: item.sni?.trim() || "",
    insecure: Boolean(item.insecure),
    rawUri: item.rawUri || "",
    localHost: item.localHost?.trim() || "127.0.0.1",
    localPort: Number(item.localPort) || 1080,
    enabled: item.enabled !== false,
  };
}
