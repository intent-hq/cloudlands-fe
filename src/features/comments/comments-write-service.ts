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
import { toast } from "svelte-sonner";
import type { CommentV2 } from "./comment-types-v2";
import { store as appStore } from "$store/renderer/store";
import {
  addCommentAction,
  removeCommentAction,
} from "$store/renderer/slices/comments/comments-slice";
import { selectCommentById } from "$store/renderer/slices/comments/comments-selectors";
import { enqueueRevBumpingNoteMutation } from "../notes/notes-write-service";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("CommentsWriteService");

/**
 * Add a comment optimistically, then persist via `comment.add`. The optimistic
 * comment is inserted into the store immediately; on failure it is removed and
 * a toast surfaces the daemon error. Returns `true` on success so callers can
 * branch on the persist outcome; convergence to the daemon-assigned id is left
 * to the subscribe→refetch loop.
 *
 * `comment.add` rewrites the note's markdown daemon-side (anchor markers),
 * bumping the note's `rev` without a `note:updated` event or a rev echo in the
 * result. When the workspace is known, the call is therefore routed through
 * the note's §11.4-D mutation queue (`enqueueRevBumpingNoteMutation`) so the
 * stored rev advances before the anchor-insertion's debounced content save
 * flushes — otherwise that save sends a stale `expectedVersion` and trips the
 * "This note changed on the server" conflict toast.
 */
export async function addComment(
  noteId: string,
  optimistic: CommentV2,
  params: CommentAddParams,
): Promise<boolean> {
  appStore.dispatch(addCommentAction(optimistic));

  const result = params.workspaceId
    ? await enqueueRevBumpingNoteMutation(params.workspaceId, noteId, () =>
        appClient.comments.add(noteId, params),
      )
    : await appClient.comments.add(noteId, params);
  if (!result.success) {
    logger.error("Failed to add comment", result.error);
    toast.error("Failed to add comment", { description: result.error ?? "Unknown error" });
    appStore.dispatch(removeCommentAction(optimistic.id));
    return false;
  }
  return true;
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
  appStore.dispatch(addCommentAction(optimisticReply));

  const result = await appClient.comments.respond(noteId, params);
  if (!result.success) {
    logger.error("Failed to respond to comment", result.error);
    toast.error("Failed to reply", { description: result.error ?? "Unknown error" });
    appStore.dispatch(removeCommentAction(optimisticReply.id));
    return false;
  }
  return true;
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
  const snapshot = selectCommentById.select(appStore.state, commentId);
  appStore.dispatch(removeCommentAction(commentId));

  const result = await appClient.comments.delete(noteId, commentId, workspaceId);
  if (!result.success) {
    logger.error("Failed to delete comment", result.error);
    toast.error("Failed to delete comment", { description: result.error ?? "Unknown error" });
    if (snapshot) appStore.dispatch(addCommentAction(snapshot));
    return { existed: !!snapshot, success: false };
  }

  return { existed: !!snapshot, success: true };
}
