export const WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME = 'workspace-view-active';

function encodeWorkspaceId(workspaceId: string): string {
  return (
    Array.from(workspaceId, (character) => character.codePointAt(0)!.toString(36)).join('-') ||
    'empty'
  );
}

export function getWorkspaceViewTransitionName(workspaceId: string): string {
  return `workspace-view-secondary-${encodeWorkspaceId(workspaceId)}`;
}

export function getWorkspaceContentViewTransitionName(workspaceId: string): string {
  return `workspace-view-content-${encodeWorkspaceId(workspaceId)}`;
}
