/** Compatibility façade for comment mutations owned by workspace-notes saga. */
import type { CommentAddParams, CommentRespondParams } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  addCommentRequested,
  deleteCommentRequested,
  respondToCommentRequested,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import type { CommentV2 } from './comment-types-v2';

export function addComment(
  noteId: string,
  optimistic: CommentV2,
  params: CommentAddParams,
): Promise<boolean> {
  return appStore.dispatch(addCommentRequested(noteId, optimistic, params));
}

export function respondToComment(
  noteId: string,
  optimisticReply: CommentV2,
  params: CommentRespondParams,
): Promise<boolean> {
  return appStore.dispatch(respondToCommentRequested(noteId, optimisticReply, params));
}

export function deleteComment(
  noteId: string,
  commentId: string,
  workspaceId?: string,
): Promise<{ existed: boolean; success: boolean }> {
  return appStore.dispatch(deleteCommentRequested(noteId, commentId, workspaceId));
}
