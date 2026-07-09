import { findDirectBypassMatch, hostMatchesRule } from "./direct-bypass.js";

function ruleKey(rule) {
  return `${rule.type || "domain"}:${rule.pattern.trim().toLowerCase()}`;
}

export function getEffectiveProxyRules(settings, tempRules = []) {
  const permanent = settings.rules.filter((rule) => rule.enabled && rule.pattern?.trim());
  const seen = new Set(permanent.map((rule) => ruleKey(rule)));
  const merged = [...permanent];

  for (const rule of tempRules) {
    if (!rule.enabled || !rule.pattern?.trim()) continue;
    const key = ruleKey(rule);
    if (!seen.has(key)) {
      merged.push(rule);
      seen.add(key);
    }
  }

  return merged;
}

export function urlWouldUseProxy(settings, url, tempRules = []) {
  if (!settings.enabled) return false;

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (!host || findDirectBypassMatch(host, settings)) return false;
  if (settings.globalProxy) return true;

  const rules = getEffectiveProxyRules(settings, tempRules);
  return rules.some((rule) => hostMatchesRule(host, rule));
}
