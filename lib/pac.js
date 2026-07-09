const BYPASS_BLOCK = `
  if (isPlainHostName(host) && (host === "localhost" || host === "127.0.0.1")) {
    return "DIRECT";
  }
  if (
    shExpMatch(host, "127.*") ||
    shExpMatch(host, "10.*") ||
    shExpMatch(host, "192.168.*") ||
    shExpMatch(host, "172.16.*") ||
    shExpMatch(host, "172.17.*") ||
    shExpMatch(host, "172.18.*") ||
    shExpMatch(host, "172.19.*") ||
    shExpMatch(host, "172.2*") ||
    shExpMatch(host, "172.30.*") ||
    shExpMatch(host, "172.31.*") ||
    shExpMatch(host, "*.local")
  ) {
    return "DIRECT";
  }`;

function escapePacString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ruleToPacCondition(rule) {
  const pattern = escapePacString(rule.pattern.trim());
  switch (rule.type) {
    case "domain":
      return `(dnsDomainIs(host, ".${pattern}") || host === "${pattern}")`;
    case "wildcard":
      return `shExpMatch(host, "${pattern}")`;
    case "regex":
      return `/${pattern}/.test(host)`;
    default:
      return `(dnsDomainIs(host, ".${pattern}") || host === "${pattern}")`;
  }
}

function buildDirectPacBlock(rules) {
  const enabledRules = rules.filter((r) => r.enabled && r.pattern.trim());
  if (!enabledRules.length) return "";

  return enabledRules
    .map((rule) => `  if (${ruleToPacCondition(rule)}) {\n    return "DIRECT";\n  }`)
    .join("\n");
}

function proxyLineForNode(node) {
  const host = node.localHost || "127.0.0.1";
  const port = node.localPort || 1080;
  return `SOCKS5 ${host}:${port}`;
}

export function generatePacScript(rules, resolveNodeForRule, directRules = []) {
  const enabledRules = rules.filter((r) => r.enabled && r.pattern.trim());
  const directBlock = buildDirectPacBlock(directRules);

  const conditions = enabledRules
    .map((rule) => {
      const node = resolveNodeForRule(rule);
      if (!node) return "";
      const proxyLine = proxyLineForNode(node);
      return `  if (${ruleToPacCondition(rule)}) {\n    return "${proxyLine}";\n  }`;
    })
    .filter(Boolean)
    .join("\n");

  return `
function FindProxyForURL(url, host) {
${BYPASS_BLOCK}
${directBlock}
${conditions}
  return "DIRECT";
}
`.trim();
}

export function generateGlobalPacScript(proxyHost, proxyPort, directRules = []) {
  const proxyLine = `SOCKS5 ${proxyHost}:${proxyPort}`;
  const directBlock = buildDirectPacBlock(directRules);

  return `
function FindProxyForURL(url, host) {
${BYPASS_BLOCK}
${directBlock}
  return "${proxyLine}";
}
`.trim();
}
