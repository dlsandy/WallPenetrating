import { getActiveNode } from "./storage.js";

export function resolveRuleNode(rule, settings) {
  const defaultNode = getActiveNode(settings);
  if (!rule?.nodeId) return defaultNode;

  const node = settings.nodes.find((n) => n.id === rule.nodeId) ?? null;
  if (node?.enabled) return node;
  return defaultNode;
}

export function getRequiredRoutingNodes(settings) {
  const defaultNode = getActiveNode(settings);

  if (settings.globalProxy) {
    return defaultNode ? [defaultNode] : [];
  }

  const required = new Map();
  if (defaultNode) {
    required.set(defaultNode.id, defaultNode);
  }

  for (const rule of settings.rules) {
    if (!rule.enabled || !rule.pattern?.trim()) continue;
    const node = resolveRuleNode(rule, settings);
    if (node) required.set(node.id, node);
  }

  return [...required.values()];
}

export function ruleNodeLabel(rule, settings) {
  if (!rule?.nodeId) {
    const active = getActiveNode(settings);
    return active ? `默认 · ${active.name || active.host}` : "默认";
  }

  const node = settings.nodes.find((n) => n.id === rule.nodeId);
  if (!node) return "（节点已删除）";
  if (!node.enabled) return `${node.name || node.host}（已禁用）`;
  return node.name || node.host;
}

export function countRulesUsingNode(settings, nodeId) {
  return settings.rules.filter((rule) => rule.nodeId === nodeId).length;
}
