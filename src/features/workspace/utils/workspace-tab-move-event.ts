export const WORKSPACE_TAB_MOVED_EVENT = 'workspace-tab-moved';

export interface WorkspaceTabMovedEventDetail {
  workspaceId: string;
  position: number;
}
