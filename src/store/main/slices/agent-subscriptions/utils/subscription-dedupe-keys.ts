const KEY_SEPARATOR = "\u001f";

export function buildWorkspaceScopedSubscriptionKey(workspaceId: string, subscriptionId: string): string {
  return [workspaceId, subscriptionId].join(KEY_SEPARATOR);
}

export function buildWorkspaceScopedGroupKey(workspaceId: string, groupId: string): string {
  return [workspaceId, groupId].join(KEY_SEPARATOR);
}

export function buildOneShotProcessingKey(workspaceId: string, subscriptionId: string): string {
  return buildWorkspaceScopedSubscriptionKey(workspaceId, subscriptionId);
}

export function buildSweepCatchUpSeenKey(
  workspaceId: string,
  subscriptionId: string,
  actorId: string,
  eventType: string,
): string {
  return [workspaceId, subscriptionId, actorId, eventType].join(KEY_SEPARATOR);
}

export function isKeyForWorkspaceSubscription(
  key: string,
  workspaceId: string,
  subscriptionId: string,
): boolean {
  const scopedKey = buildWorkspaceScopedSubscriptionKey(workspaceId, subscriptionId);
  return key === scopedKey || key.startsWith(`${scopedKey}${KEY_SEPARATOR}`);
}

export function parseWorkspaceScopedSubscriptionKey(
  key: string,
): { workspaceId: string; subscriptionId: string } | null {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length !== 2) return null;
  const [workspaceId, subscriptionId] = parts;
  if (!workspaceId || !subscriptionId) return null;
  return { workspaceId, subscriptionId };
}

export function parseSweepCatchUpSeenKey(
  key: string,
): { workspaceId: string; subscriptionId: string; actorId: string; eventType: string } | null {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length !== 4) return null;
  const [workspaceId, subscriptionId, actorId, eventType] = parts;
  if (!workspaceId || !subscriptionId || !actorId || !eventType) return null;
  return { workspaceId, subscriptionId, actorId, eventType };
}

export function parseWorkspaceScopedGroupKey(
  key: string,
): { workspaceId: string; groupId: string } | null {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length !== 2) return null;
  const [workspaceId, groupId] = parts;
  if (!workspaceId || !groupId) return null;
  return { workspaceId, groupId };
}