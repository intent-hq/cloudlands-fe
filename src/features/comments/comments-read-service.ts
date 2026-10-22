/** Compatibility façade for comment-event reconciliation owned by workspace-notes saga. */
import { store as appStore } from '$store/renderer/store';
import { commentEventReceived } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

export function applyCommentFromEvent(
  workspaceId: string,
  noteId: string,
  kind: 'added' | 'resolved',
): void {
  appStore.dispatch(commentEventReceived(workspaceId, noteId, kind));
}
