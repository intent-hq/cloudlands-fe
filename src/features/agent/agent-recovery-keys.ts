export const agentMetadataRecoveryKey = (workspaceId?: string) =>
  `agents:${JSON.stringify([workspaceId ?? null])}`;
export const agentQueueRecoveryKey = (workspaceId: string | undefined, agentId: string) =>
  `agent-queue:${JSON.stringify([workspaceId ?? null, agentId])}`;
export const agentSubscriptionsRecoveryKey = (workspaceId: string, agentId: string) =>
  `agent-subscriptions:${JSON.stringify([workspaceId, agentId])}`;
export const AGENT_PERMISSIONS_RECOVERY_KEY = 'agent-permissions';
export const AGENT_ACTIVE_STREAMS_RECOVERY_KEY = 'agent-active-streams';
export const AGENT_FAILURES_RECOVERY_KEY = 'agent-failures';
