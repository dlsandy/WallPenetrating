import { findDomainRule, upsertDomainRule } from "./site-rules.js";

const SESSION_KEY = "tempRules";

export async function getTempRules() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return Array.isArray(data[SESSION_KEY]) ? data[SESSION_KEY] : [];
}

export async function saveTempRules(rules) {
  await chrome.storage.session.set({ [SESSION_KEY]: rules });
}

export async function upsertTempDomainRule(pattern, createRule) {
  const rules = await getTempRules();
  const result = upsertDomainRule(rules, pattern, createRule);
  await saveTempRules(rules);
  return result;
}

export async function removeTempRule(id) {
  const rules = await getTempRules();
  const next = rules.filter((rule) => rule.id !== id);
  if (next.length === rules.length) return false;
  await saveTempRules(next);
  return true;
}

export async function updateTempRule(id, partial) {
  const rules = await getTempRules();
  const rule = rules.find((item) => item.id === id);
  if (!rule) return null;
  Object.assign(rule, partial);
  await saveTempRules(rules);
  return rule;
}

export function promoteTempRuleToPermanent(settings, tempRule, createRule) {
  const existing = findDomainRule(settings.rules, tempRule.pattern);

  if (existing) {
    existing.enabled = true;
    if (tempRule.nodeId) existing.nodeId = tempRule.nodeId;
    if (tempRule.type) existing.type = tempRule.type;
    return { status: "enabled", rule: existing };
  }

  const rule = createRule({
    pattern: tempRule.pattern,
    type: tempRule.type || "domain",
    enabled: true,
    nodeId: tempRule.nodeId ?? null,
  });
  settings.rules.push(rule);
  return { status: "added", rule };
}

export function findTempDomainRule(tempRules, pattern) {
  return findDomainRule(tempRules, pattern);
}
