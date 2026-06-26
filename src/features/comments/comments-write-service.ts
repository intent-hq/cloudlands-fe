/**
 * Comments write service — the sanctioned post-saga comment-mutation mechanism.
 *
 * Mirrors `notes-write-service`: components/managers call these functions
 * instead of dispatching the (now dead) saga-trigger actions. Each operation:
 * (1) applies an optimistic store update for instant UI feedback, (2) awaits the
 * matching `appClient.comments.*` mutation (which forwards to intentd and never
 * throws — it returns a `MutationResult`), and (3) reconciles: on success the
 * live `comment:*` subscribe→refetch loop converges the store to canonical ids;
 * on failure the optimistic change is rolled back.
 *
 * This module is dependency-light: it imports only the AppClient seam, the
 * configured store, slice actions, and selectors (per src/store AGENTS.md).
 */
import { appClient } from "$lib/client";
import type { CommentAddParams, CommentRespondParams } from "$lib/client";
import type { CommentV2 } from "./comment-types-v2";
import { store as appStore } from "$store/renderer/store";
import {
  addCommentAction,
  removeCommentAction,
} from "$store/renderer/slices/comments/comments-slice";
import { selectCommentById } from "$store/renderer/slices/comments/comments-selectors";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("CommentsWriteService");

/**
 * Add a comment optimistically, then persist via `comment.add`. The optimistic
 * comment is inserted into the store immediately; on failure it is removed.
 * Convergence to the daemon-assigned id is left to the subscribe→refetch loop.
 */
export async function addComment(
  noteId: string,
  optimistic: CommentV2,
  params: CommentAddParams,
): Promise<void> {
  appStore.dispatch(addCommentAction(optimistic));

  const result = await appClient.comments.add(noteId, params);
  if (!result.success) {
    appStore.dispatch(removeCommentAction(optimistic.id));
    logger.error("Failed to add comment", result.error);
  }
}

/**
 * Reply to a thread/comment optimistically, then persist via `comment.respond`.
 * The optimistic reply is inserted immediately; on failure it is removed.
 */
export async function respondToComment(
  noteId: string,
  optimisticReply: CommentV2,
  params: CommentRespondParams,
): Promise<void> {
  appStore.dispatch(addCommentAction(optimisticReply));

  const result = await appClient.comments.respond(noteId, params);
  if (!result.success) {
    appStore.dispatch(removeCommentAction(optimisticReply.id));
    logger.error("Failed to respond to comment", result.error);
  }
}

/**
 * Delete a comment optimistically, then persist via `comment.delete`. The
 * comment is removed from the store immediately and restored from a snapshot on
 * failure. Returns whether the comment existed before the optimistic removal.
 */
export async function deleteComment(noteId: string, commentId: string): Promise<boolean> {
  const snapshot = selectCommentById.select(appStore.state, commentId);
  appStore.dispatch(removeCommentAction(commentId));

  const result = await appClient.comments.delete(noteId, commentId);
  if (!result.success) {
    if (snapshot) appStore.dispatch(addCommentAction(snapshot));
    logger.error("Failed to delete comment", result.error);
  }

  return !!snapshot;
}
