export function getWorkspaceViewTransitionName(workspaceId: string): string {
  const safeId = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `workspace-column-${safeId}`;
}
