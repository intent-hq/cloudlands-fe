/**
 * Comments write service — compatibility adapters for saga-owned mutations.
 *
 * Existing managers call these functions while the Redux saga owns optimistic
 * updates, persistence, rollback, and promise settlement. Keeping this small
 * adapter avoids changing every legacy caller at once.
 *
 * This module is dependency-light: it imports only request types, the
 * configured store, and comment mutation actions.
 */
import type { CommentAddParams, CommentRespondParams } from '$lib/client';
import type { CommentV2 } from './comment-types-v2';
import { store as appStore } from '$store/renderer/store';
import {
  addCommentRequested,
  deleteCommentRequested,
  respondToCommentRequested,
  resolveCommentRequested,
} from '$store/renderer/slices/comments/comments-slice';

/**
 * Add a comment optimistically, then persist via `comment.add`. The optimistic
 * comment is inserted into the store immediately; on failure it is removed and
 * a toast surfaces the daemon error. Returns `true` on success so callers can
 * branch on the persist outcome; convergence to the daemon-assigned id is left
 * to the subscribe→refetch loop.
 *
 * `comment.add` rewrites the note's markdown daemon-side (anchor markers),
 * bumping the note's `rev` without a `note:updated` event. When the workspace
 * is known, the call is therefore routed through the note's §11.4-D mutation
 * queue (`enqueueRevBumpingNoteMutation`) so the stored rev advances — from
 * the daemon's echoed `noteRev` when present (#638), else the rev+1 inference
 * — before the anchor-insertion's debounced content save flushes; otherwise
 * that save sends a stale `expectedVersion` and trips the "This note changed
 * on the server" conflict toast.
 */
export async function addComment(
  noteId: string,
  optimistic: CommentV2,
  params: CommentAddParams,
): Promise<boolean> {
  return await appStore.dispatch(addCommentRequested(noteId, optimistic, params)).promise;
}

/**
 * Reply to a thread/comment optimistically, then persist via `comment.respond`.
 * The optimistic reply is inserted immediately; on failure it is removed and a
 * toast surfaces the daemon error. Returns `true` on success so callers can
 * branch on the persist outcome.
 */
export async function respondToComment(
  noteId: string,
  optimisticReply: CommentV2,
  params: CommentRespondParams,
): Promise<boolean> {
  return await appStore.dispatch(respondToCommentRequested(noteId, optimisticReply, params))
    .promise;
}

/**
 * Delete a comment optimistically, then persist via `comment.delete`. The
 * comment is removed from the store immediately and restored from a snapshot on
 * failure (with a toast surfacing the daemon error). Returns `existed` (whether
 * the comment existed before the optimistic removal — preserved for callers
 * that key follow-up cleanup on prior presence) and `success` (whether the
 * daemon persisted the delete) so callers can react to either.
 */
export async function deleteComment(
  noteId: string,
  commentId: string,
  workspaceId?: string,
): Promise<{ existed: boolean; success: boolean }> {
  return await appStore.dispatch(deleteCommentRequested(noteId, commentId, workspaceId)).promise;
}

/** Resolve a comment through the comment mutation saga. */
export async function resolveComment(
  workspaceId: string,
  commentId: string,
  noteId: string,
): Promise<boolean> {
  return await appStore.dispatch(resolveCommentRequested(workspaceId, commentId, noteId)).promise;
}
