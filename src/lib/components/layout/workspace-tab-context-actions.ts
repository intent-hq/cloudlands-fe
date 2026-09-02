export type WorkspaceTabBulkCloseMode = 'others' | 'right';

export function getWorkspaceTabBulkCloseIds(
  order: string[],
  workspaceId: string,
  mode: WorkspaceTabBulkCloseMode,
): string[] {
  const index = order.indexOf(workspaceId);
  if (index < 0) return [];
  return mode === 'right'
    ? order.slice(index + 1)
    : order.filter((candidate) => candidate !== workspaceId);
}
