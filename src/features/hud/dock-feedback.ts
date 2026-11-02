import { store as appStore } from '$store/renderer/store';
import { dockFeedbackRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';

export interface DockFeedbackRequest {
  workspaceId: string;
  agentId?: string;
}

/** Open the workspace's dock conversation and start annotating with the current tool. */
export function startDockFeedback({ workspaceId, agentId }: DockFeedbackRequest): void {
  appStore.dispatch(dockFeedbackRequested(workspaceId, agentId));
}
