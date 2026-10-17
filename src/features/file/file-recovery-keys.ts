export const fileContentRecoveryKey = (workspaceId: string, path: string) =>
  `file-content:${JSON.stringify([workspaceId, path])}`;
export const fileExplorerRecoveryKey = (workspaceId: string) =>
  `file-explorer:${JSON.stringify([workspaceId])}`;
export const fileEditsRecoveryKey = (workspaceId: string) =>
  `file-edits:${JSON.stringify([workspaceId])}`;
export const fileSearchRecoveryKey = (workspaceId: string, consumerId: string) =>
  `file-search:${JSON.stringify([workspaceId, consumerId])}`;
