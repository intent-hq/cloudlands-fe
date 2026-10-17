export const agentLocksRecoveryKey = (workspaceId: string) =>
  `agent-locks:${JSON.stringify([workspaceId])}`;
export const gitStatusRecoveryKey = (workspaceId: string) =>
  `git-status:${JSON.stringify([workspaceId])}`;
export const acceptStatusRecoveryKey = (workspaceId: string) =>
  `accept-status:${JSON.stringify([workspaceId])}`;
