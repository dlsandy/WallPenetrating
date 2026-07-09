const DEFAULT_SYNC = {
  enabled: false,
  globalProxy: false,
  autoRetryOn404: false,
  projectUrl: "https://github.com/dlsandy/WallPenetrating",
  rules: [],
  directBypassEnabled: true,
  useBuiltinDirect: true,
  directRules: [],
};

const MIGRATION_FLAG = "storageSplitV2";

function pickDefaultActiveNodeId(nodes, preferredId = null) {
  if (preferredId && nodes.some((n) => n.id === preferredId && n.enabled)) {
    return preferredId;
  }
  if (preferredId && nodes.some((n) => n.id === preferredId)) {
    return preferredId;
  }
  return nodes.find((n) => n.enabled)?.id ?? nodes[0]?.id ?? null;
}

function stripLegacySyncFields(raw = {}) {
  const { nodes: _nodes, activeNodeId: _activeNodeId, ...syncPart } = raw;
  return syncPart;
}

async function persistSplitSettings(syncPart, localPart) {
  await Promise.all([
    chrome.storage.sync.set({ settings: syncPart }),
    chrome.storage.local.set({
      nodes: localPart.nodes ?? [],
      activeNodeId: localPart.activeNodeId ?? null,
      [MIGRATION_FLAG]: true,
    }),
  ]);
}

export async function getSettings() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get("settings"),
    chrome.storage.local.get(["nodes", "activeNodeId", MIGRATION_FLAG]),
  ]);

  const legacy = syncData.settings ?? {};
  let nodes = Array.isArray(localData.nodes) ? localData.nodes : [];
  let activeNodeId = localData.activeNodeId ?? legacy.activeNodeId ?? null;
  let needsSave = false;

  if (!nodes.length && Array.isArray(legacy.nodes) && legacy.nodes.length) {
    nodes = legacy.nodes;
    needsSave = true;
  }

  const reconciledActiveId = pickDefaultActiveNodeId(nodes, activeNodeId);
  if (reconciledActiveId !== activeNodeId) {
    activeNodeId = reconciledActiveId;
    needsSave = true;
  }

  const syncPart = stripLegacySyncFields(legacy);
  const settings = {
    ...DEFAULT_SYNC,
    ...syncPart,
    nodes,
    activeNodeId,
  };

  const shouldMigrate =
    needsSave ||
    !localData[MIGRATION_FLAG] ||
    legacy.nodes !== undefined ||
    legacy.activeNodeId !== undefined;

  if (shouldMigrate) {
    await persistSplitSettings(syncPart, { nodes, activeNodeId });
  }

  return settings;
}

export async function saveSettings(settings) {
  const { nodes, activeNodeId, ...syncPart } = settings;
  await persistSplitSettings(stripLegacySyncFields(syncPart), {
    nodes: nodes ?? [],
    activeNodeId: activeNodeId ?? null,
  });
}

export async function updateSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await saveSettings(next);
  return next;
}

export function createId() {
  return crypto.randomUUID();
}

export function createNode(partial = {}) {
  return {
    id: createId(),
    name: "",
    host: "",
    port: 443,
    password: "",
    sni: "",
    insecure: false,
    rawUri: "",
    localHost: "127.0.0.1",
    localPort: 1080,
    enabled: true,
    ...partial,
  };
}

export function createRule(partial = {}) {
  return {
    id: createId(),
    pattern: "",
    type: "domain",
    enabled: true,
    nodeId: null,
    ...partial,
  };
}

export function getActiveNode(settings) {
  if (!settings.activeNodeId) return null;
  const node = settings.nodes.find((n) => n.id === settings.activeNodeId) ?? null;
  if (!node || !node.enabled) return null;
  return node;
}

export function getSelectedNode(settings) {
  if (!settings.activeNodeId) return null;
  return settings.nodes.find((n) => n.id === settings.activeNodeId) ?? null;
}

export function getNextLocalPort(nodes) {
  const used = new Set(nodes.map((n) => n.localPort));
  let port = 1080;
  while (used.has(port)) port += 1;
  return port;
}
