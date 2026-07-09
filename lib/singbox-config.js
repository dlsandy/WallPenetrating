function buildTlsOptions(node) {
  const tls = { enabled: true };

  if (node.sni) {
    tls.server_name = node.sni;
  } else if (node.host && !/^\d+\.\d+\.\d+\.\d+$/.test(node.host) && !node.host.includes(":")) {
    tls.server_name = node.host;
  }

  if (node.insecure) {
    tls.insecure = true;
  }

  return tls;
}

function nodeTagSuffix(nodeId) {
  return String(nodeId).replace(/-/g, "").slice(0, 12);
}

function buildAnyTlsOutbound(node, tag) {
  return {
    type: "anytls",
    tag,
    server: node.host,
    server_port: node.port,
    password: node.password,
    tls: buildTlsOptions(node),
  };
}

export function buildSingBoxConfig(node) {
  return buildSingBoxConfigForNodes([node]);
}

export function buildSingBoxConfigForNodes(nodes) {
  const list = (nodes ?? []).filter(Boolean);
  if (!list.length) {
    throw new Error("至少需要一个节点");
  }

  if (list.length === 1) {
    const node = list[0];
    return {
      log: { level: "info" },
      inbounds: [
        {
          type: "socks",
          tag: "socks-in",
          listen: node.localHost || "127.0.0.1",
          listen_port: node.localPort || 1080,
        },
      ],
      outbounds: [
        buildAnyTlsOutbound(node, "anytls-out"),
        { type: "direct", tag: "direct" },
      ],
      route: { final: "anytls-out" },
    };
  }

  const inbounds = [];
  const outbounds = [{ type: "direct", tag: "direct" }];
  const routeRules = [];

  for (const node of list) {
    const suffix = nodeTagSuffix(node.id);
    const inboundTag = `socks-in-${suffix}`;
    const outboundTag = `anytls-out-${suffix}`;

    inbounds.push({
      type: "socks",
      tag: inboundTag,
      listen: node.localHost || "127.0.0.1",
      listen_port: node.localPort || 1080,
    });
    outbounds.push(buildAnyTlsOutbound(node, outboundTag));
    routeRules.push({ inbound: inboundTag, outbound: outboundTag });
  }

  return {
    log: { level: "info" },
    inbounds,
    outbounds,
    route: {
      rules: routeRules,
      final: "direct",
    },
  };
}

export function buildSingBoxConfigJson(node, pretty = true) {
  return JSON.stringify(buildSingBoxConfig(node), null, pretty ? 2 : 0);
}
