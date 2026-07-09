export function parseAnyTlsUri(uri) {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new Error("URI 不能为空");
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("无效的 URI 格式");
  }

  if (url.protocol !== "anytls:") {
    throw new Error("协议必须是 anytls://");
  }

  const password = decodeURIComponent(url.username || "");
  if (!password) {
    throw new Error("URI 缺少密码（auth 部分）");
  }

  const host = url.hostname;
  if (!host) {
    throw new Error("URI 缺少服务器地址");
  }

  const port = url.port ? Number(url.port) : 443;
  const sni =
    url.searchParams.get("sni") ||
    url.searchParams.get("peer") ||
    url.searchParams.get("host") ||
    "";
  const insecure =
    url.searchParams.get("insecure") === "1" ||
    url.searchParams.get("allowInsecure") === "1" ||
    url.searchParams.get("skip-cert-verify") === "1";
  const udp =
    url.searchParams.get("udp") === "1" ||
    url.searchParams.get("udp") === "true";

  let name = `${host}:${port}`;
  if (url.hash && url.hash.length > 1) {
    try {
      name = decodeURIComponent(url.hash.slice(1)).trim() || name;
    } catch {
      name = url.hash.slice(1).trim() || name;
    }
  }

  return {
    host,
    port,
    password,
    sni,
    insecure,
    udp,
    name,
    rawUri: trimmed,
  };
}

export function buildAnyTlsUri(node) {
  const auth = encodeURIComponent(node.password);
  const host = node.host.includes(":") ? `[${node.host}]` : node.host;
  const params = new URLSearchParams();
  if (node.sni) params.set("sni", node.sni);
  if (node.insecure) params.set("insecure", "1");
  if (node.udp) params.set("udp", "1");
  const query = params.toString();
  return `anytls://${auth}@${host}:${node.port}${query ? `/?${query}` : ""}`;
}

export function migrateNode(node) {
  if (!node.rawUri) return node;

  try {
    const parsed = parseAnyTlsUri(node.rawUri);
    return {
      ...node,
      sni: node.sni || parsed.sni,
      insecure: node.insecure ?? parsed.insecure,
      udp: node.udp ?? parsed.udp,
      name: node.name || parsed.name,
    };
  } catch {
    return node;
  }
}

export const GOOGLE_RULES = [
  { pattern: "google.com", type: "domain" },
  { pattern: "*.google.com", type: "wildcard" },
  { pattern: "googleapis.com", type: "domain" },
  { pattern: "*.googleapis.com", type: "wildcard" },
  { pattern: "gstatic.com", type: "domain" },
  { pattern: "*.gstatic.com", type: "wildcard" },
  { pattern: "googleusercontent.com", type: "domain" },
  { pattern: "*.googleusercontent.com", type: "wildcard" },
  { pattern: "ggpht.com", type: "domain" },
  { pattern: "*.ggpht.com", type: "wildcard" },
  { pattern: "gvt1.com", type: "domain" },
  { pattern: "*.gvt1.com", type: "wildcard" },
];
