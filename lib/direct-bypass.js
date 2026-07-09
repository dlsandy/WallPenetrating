export const BUILTIN_DIRECT_RULES = [
  { pattern: "gov.cn", type: "domain", enabled: true, builtin: true },
  { pattern: "icbc.com.cn", type: "domain", enabled: true, builtin: true },
  { pattern: "ccb.com", type: "domain", enabled: true, builtin: true },
  { pattern: "abchina.com", type: "domain", enabled: true, builtin: true },
  { pattern: "boc.cn", type: "domain", enabled: true, builtin: true },
  { pattern: "bankcomm.com", type: "domain", enabled: true, builtin: true },
  { pattern: "cmbchina.com", type: "domain", enabled: true, builtin: true },
  { pattern: "psbc.com", type: "domain", enabled: true, builtin: true },
  { pattern: "cib.com.cn", type: "domain", enabled: true, builtin: true },
  { pattern: "alipay.com", type: "domain", enabled: true, builtin: true },
  { pattern: "tenpay.com", type: "domain", enabled: true, builtin: true },
];

export function hostMatchesRule(host, rule) {
  if (!rule?.enabled || !rule.pattern?.trim()) return false;

  const pattern = rule.pattern.trim().toLowerCase();
  const normalizedHost = String(host || "").toLowerCase();

  switch (rule.type) {
    case "wildcard": {
      const re = new RegExp(`^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
      return re.test(normalizedHost);
    }
    case "regex":
      try {
        return new RegExp(pattern).test(normalizedHost);
      } catch {
        return false;
      }
    case "domain":
    default:
      return normalizedHost === pattern || normalizedHost.endsWith(`.${pattern}`);
  }
}

export function getEffectiveDirectRules(settings) {
  if (settings.directBypassEnabled === false) return [];

  const rules = [];
  if (settings.useBuiltinDirect !== false) {
    rules.push(...BUILTIN_DIRECT_RULES);
  }
  rules.push(...(settings.directRules || []).filter((r) => r.enabled && r.pattern?.trim()));
  return rules;
}

export function findDirectBypassMatch(host, settings) {
  const rules = getEffectiveDirectRules(settings);
  return rules.find((rule) => hostMatchesRule(host, rule)) ?? null;
}
