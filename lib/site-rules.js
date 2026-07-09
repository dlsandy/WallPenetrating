export function patternFromTabUrl(url) {
  if (!url) {
    return { ok: false, error: "无法获取当前标签页地址" };
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "仅支持 http/https 网页" };
    }

    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }

    if (!host || host === "localhost" || host.endsWith(".local")) {
      return { ok: false, error: "无法为此地址创建规则" };
    }

    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
      return { ok: false, error: "不支持 IP 地址，请手动添加规则" };
    }

    return { ok: true, pattern: host };
  } catch {
    return { ok: false, error: "网址格式无效" };
  }
}

export function findDomainRule(rules, pattern) {
  return rules.find((r) => r.type === "domain" && r.pattern === pattern) ?? null;
}

export function removeDomainRule(rules, pattern) {
  const index = rules.findIndex((r) => r.type === "domain" && r.pattern === pattern);
  if (index < 0) {
    return { removed: false };
  }
  rules.splice(index, 1);
  return { removed: true };
}

export function findRuleOverlap(rules, pattern, type = "domain") {
  if (type !== "domain") return null;

  for (const rule of rules) {
    if (!rule.enabled || rule.type !== "domain" || rule.pattern === pattern) continue;
    if (pattern.endsWith(`.${rule.pattern}`) || rule.pattern.endsWith(`.${pattern}`)) {
      return rule.pattern;
    }
  }

  return null;
}

export function wildcardPatternFromDomain(domain) {
  if (!domain || !domain.includes(".")) return null;
  const parts = domain.split(".");
  if (parts.length === 2) return `*.${domain}`;
  return `*.${parts.slice(1).join(".")}`;
}

export function findWildcardRule(rules, pattern) {
  return rules.find((r) => r.type === "wildcard" && r.pattern === pattern) ?? null;
}

export function upsertWildcardRule(rules, pattern, createRule) {
  const existing = findWildcardRule(rules, pattern);

  if (existing) {
    if (!existing.enabled) {
      existing.enabled = true;
      return { status: "enabled", rule: existing };
    }
    return { status: "duplicate", rule: existing };
  }

  const rule = createRule({ pattern, type: "wildcard", enabled: true });
  rules.push(rule);
  return { status: "added", rule };
}

export function shouldOfferWildcardRule(rules, domainPattern, domainStatus) {
  if (domainStatus === "duplicate") return null;
  const wildcardPattern = wildcardPatternFromDomain(domainPattern);
  if (!wildcardPattern) return null;
  if (findWildcardRule(rules, wildcardPattern)?.enabled) return null;
  return wildcardPattern;
}

export function upsertDomainRule(rules, pattern, createRule) {
  const existing = findDomainRule(rules, pattern);

  if (existing) {
    if (!existing.enabled) {
      existing.enabled = true;
      return { status: "enabled", rule: existing };
    }
    return { status: "duplicate", rule: existing };
  }

  const overlap = findRuleOverlap(rules, pattern);
  const rule = createRule({ pattern, type: "domain", enabled: true });
  rules.push(rule);
  return { status: "added", rule, overlap };
}
