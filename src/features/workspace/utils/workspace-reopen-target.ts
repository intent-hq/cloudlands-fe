/** The source reopen shortcut chooses the newest close across panel and workspace history. */
export function resolveWorkspaceReopenTarget(
  workspaceId: string | null,
  panel: { kind: 'column' | 'tab'; closedAt: number } | null,
  workspace: { closedAt: number } | null,
): 'column' | 'tab' | 'workspace' | null {
  if (workspaceId && panel && (!workspace || panel.closedAt >= workspace.closedAt))
    return panel.kind;
  return workspace ? 'workspace' : null;
}
