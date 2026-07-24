/**
 * Comments read service — live-applies daemon `comment:*` events into the
 * global comments slice per PROTOCOL §6.5 (`comment:added`, `comment:resolved`).
 *
 * Comments hydrate one-shot at boot (`notes-seeder.ts` calls
 * `client.comments.list(noteId)` for every note and dispatches
 * `loadCommentsAction`). After boot, comments added/resolved by agents or
 * other clients used to stay stale until reload because `LiveCommentsClient`'s
 * per-note `subscribe` is never invoked. This service fills that gap in the
 * style of `notes-read-service.applyNoteFromEvent`: the daemon-events bridge
 * routes `comment:added` / `comment:resolved` here with the (workspaceId, noteId),
 * we refetch that single note's comments via `appClient.comments.list(noteId)`,
 * and dispatch per-comment `addCommentAction` / `updateCommentAction` /
 * `removeCommentAction` so only the affected note's comments change — other
 * notes' comments in the global slice stay intact.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * configured store, slice actions, and the logger. State reads use the raw
 * `appStore.state.comments` shape (no selectors, which would evaluate
 * `store.createSelector` mid-middleware-init).
 */
import type { CommentV2 } from "$features/comments/comment-types-v2";
import { getItem, getItems } from "$lib/store-shim/utils/collections/collection-utils";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  addCommentAction,
  removeCommentAction,
  updateCommentAction,
} from "$store/renderer/slices/comments/comments-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("CommentsReadService");

/** In-flight refetches keyed by `note:{noteId}`; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

function coalesce(key: string, fn: () => Promise<void>): void {
  const pending = inFlight.get(key);
  if (pending) return;
  const run = (async () => {
    try {
      await fn();
    } catch (error) {
      logger.error(`Comments refresh failed for ${key}`, error);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
}

/**
 * Live-apply a `comment:added` or `comment:resolved` daemon event by refetching
 * the affected note's comments and reconciling the global comments slice at the
 * per-comment level. Adds/updates/removes only touch comments belonging to
 * `noteId` (`existing.noteId === noteId`), leaving other notes' comments alone.
 *
 * Called from the daemon-events bridge with (workspaceId, noteId, kind). The
 * event's `workspaceId` scopes the refetch: `comment.list` is workspace-scoped
 * on the wire and note ids are not globally unique (every workspace has a
 * `spec` note), so passing it avoids the resolver cache targeting a same-id
 * note in another workspace.
 */
export function applyCommentFromEvent(
  workspaceId: string,
  noteId: string,
  _kind: "added" | "resolved",
): void {
  if (!workspaceId || !noteId) return;
  coalesce(`comment:${workspaceId}:${noteId}`, async () => {
    const fresh = await appClient.comments.list(noteId, workspaceId);
    const state = appStore.state.comments;
    const currentForNote = getItems(state.commentsById).filter(
      (c) => c.noteId === noteId,
    );
    const currentById = new Map(currentForNote.map((c) => [c.id, c]));
    const freshById = new Map(fresh.map((c) => [c.id, c]));

    // Removed: in current state for this note but not in fresh.
    for (const [id] of currentById) {
      if (!freshById.has(id)) {
        appStore.dispatch(removeCommentAction(id));
      }
    }

    // Added / updated: iterate fresh, add new ones and diff-update the rest.
    for (const comment of fresh) {
      const existing = getItem(state.commentsById, comment.id);
      if (!existing) {
        appStore.dispatch(addCommentAction(comment));
        continue;
      }
      const updates = diffComment(existing, comment);
      if (updates) {
        appStore.dispatch(updateCommentAction(comment.id, updates));
      }
    }
  });
}

/**
 * Shallow-diff two `CommentV2` snapshots and return only the changed fields.
 * Returns `null` when nothing changed (so the caller can skip the dispatch and
 * keep the reducer's identity guarantee for unchanged comments).
 */
function diffComment(prev: CommentV2, next: CommentV2): Partial<CommentV2> | null {
  const updates: Partial<CommentV2> = {};
  if (prev.status !== next.status) updates.status = next.status;
  if (prev.content !== next.content) updates.content = next.content;
  if (prev.updatedAt !== next.updatedAt) updates.updatedAt = next.updatedAt;
  return Object.keys(updates).length > 0 ? updates : null;
}

/** Test-only — drop any coalesced fetches between test cases. */
export function __resetCommentsReadServiceForTests(): void {
  inFlight.clear();
}
