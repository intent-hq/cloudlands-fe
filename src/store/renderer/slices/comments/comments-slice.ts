/**
 * Comments V2 Redux slice — actions & reducer.
 */

import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import {
  createCollection,
  addItem,
  updateItem,
  removeItem,
  getItem,
} from "ag-redux-toolkit/utils/collections/collection-utils";
import type { CommentV2 } from "$features/comments/comment-types-v2";
import type { CommentsV2State, CommentThread } from "./comments-types";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: CommentsV2State = {
  commentsById: createCollection<CommentV2, "id">("id"),
  threadsById: createCollection<CommentThread, "id">("id"),
  commentIdsByThread: {},
  selectedCommentId: null,
  hoveredCommentId: null,
  expandedThreadIds: {},
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Add a single comment (already has id/createdAt/updatedAt set). */
export const addCommentAction = createAction<[comment: CommentV2]>("comments/addComment");

/** Update fields on a comment. */
export const updateCommentAction = createAction(
  "comments/updateComment",
  (id: string, updates: Partial<CommentV2>) => ({ id, updates }),
);

/** Remove a comment by id. */
export const removeCommentAction = createAction<[id: string]>("comments/removeComment");

/** Bulk-load comments (replaces all existing data). */
export const loadCommentsAction = createAction<[comments: CommentV2[]]>("comments/loadComments");

/** Clear all comment data. */
export const clearCommentsAction = createAction("comments/clear");

/** Select a comment (or null to deselect). */
export const selectCommentAction = createAction<[id: string | null]>("comments/selectComment");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rebuildThreads(
  commentsById: CommentsV2State["commentsById"],
  commentIdsByThread: Record<string, string[]>,
): CommentsV2State["threadsById"] {
  const threads: CommentThread[] = [];

  for (const [threadId, ids] of Object.entries(commentIdsByThread)) {
    const threadComments = ids
      .map((id) => getItem(commentsById, id))
      .filter((c): c is CommentV2 => c !== undefined);

    if (threadComments.length === 0) continue;

    const rootComment = threadComments.find((c) => !c.parentId) || threadComments[0];
    const lastActivity =
      threadComments
        .map((c) => c.updatedAt)
        .sort()
        .pop() || rootComment.updatedAt || rootComment.createdAt;

    const allResolved = threadComments.every(
      (c) => c.status === "resolved" || c.status === "accepted" || c.status === "rejected",
    );

    threads.push({
      id: threadId,
      rootCommentId: rootComment.id,
      commentIds: ids,
      status: allResolved ? "resolved" : "open",
      lastActivity,
    });
  }

  return createCollection<CommentThread, "id">("id", threads);
}


// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const commentsReducer = createReducer<CommentsV2State>(initialState)
  // ── addComment ──────────────────────────────────────────────────────────
  .with(addCommentAction, (state, { payload: [comment] }) => {
    const commentsById = addItem(state.commentsById, comment);

    // Update commentIdsByThread
    const threadIds = state.commentIdsByThread[comment.threadId]
      ? [...state.commentIdsByThread[comment.threadId], comment.id]
      : [comment.id];
    const commentIdsByThread = { ...state.commentIdsByThread, [comment.threadId]: threadIds };

    return {
      ...state,
      commentsById,
      commentIdsByThread,
      threadsById: rebuildThreads(commentsById, commentIdsByThread),
    };
  })

  // ── updateComment ───────────────────────────────────────────────────────
  .with(updateCommentAction, (state, action) => {
    const { id, updates } = action.payload;
    const existing = getItem(state.commentsById, id);
    if (!existing) return state;

    const merged = { ...existing, ...updates, id: existing.id } as CommentV2;
    const commentsById = updateItem(state.commentsById, merged);

    // If status changed, rebuild threads to recalculate thread status
    const threadsById =
      updates.status !== undefined
        ? rebuildThreads(commentsById, state.commentIdsByThread)
        : state.threadsById;

    return { ...state, commentsById, threadsById };
  })

  // ── removeComment ───────────────────────────────────────────────────────
  .with(removeCommentAction, (state, { payload: [id] }) => {
    const existing = getItem(state.commentsById, id);
    if (!existing) return state;

    const commentsById = removeItem(state.commentsById, id);
    const threadId = existing.threadId;

    // Update commentIdsByThread
    const threadCommentIds = (state.commentIdsByThread[threadId] || []).filter(
      (cid) => cid !== id,
    );
    let commentIdsByThread: Record<string, string[]>;
    if (threadCommentIds.length === 0) {
      commentIdsByThread = { ...state.commentIdsByThread };
      delete commentIdsByThread[threadId];
    } else {
      commentIdsByThread = { ...state.commentIdsByThread, [threadId]: threadCommentIds };
    }

    return {
      ...state,
      commentsById,
      commentIdsByThread,
      threadsById: rebuildThreads(commentsById, commentIdsByThread),
    };
  })

  // ── loadComments (bulk replace) ─────────────────────────────────────────
  .with(loadCommentsAction, (state, { payload: [comments] }) => {
    const commentsById = createCollection<CommentV2, "id">("id", comments);

    // Build commentIdsByThread
    const commentIdsByThread: Record<string, string[]> = {};
    for (const comment of comments) {
      if (!commentIdsByThread[comment.threadId]) {
        commentIdsByThread[comment.threadId] = [];
      }
      commentIdsByThread[comment.threadId].push(comment.id);
    }

    return {
      ...state,
      commentsById,
      commentIdsByThread,
      threadsById: rebuildThreads(commentsById, commentIdsByThread),
    };
  })

  // ── clear ───────────────────────────────────────────────────────────────
  .with(clearCommentsAction, () => initialState)

  // ── selectComment ───────────────────────────────────────────────────────
  .with(selectCommentAction, (state, { payload: [id] }) => ({
    ...state,
    selectedCommentId: id,
  }));

