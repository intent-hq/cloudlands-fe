/**
 * Comments V2 selectors.
 */

import { store } from "../../store";
import {
  getItem,
  getItems,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import type { CommentV2 } from "$features/comments/comment-types-v2";

/** All comments as an ordered array. */
export const selectComments = store.createSelector((state) =>
  getItems(state.comments.commentsById),
);

/** All threads as an ordered array. */
export const selectThreads = store.createSelector((state) =>
  getItems(state.comments.threadsById),
);

/** Look up a single comment by id. */
export const selectCommentById = store.createSelector((state, commentId: string) =>
  getItem(state.comments.commentsById, commentId),
);

/** Look up a single thread by id. */
export const selectThreadById = store.createSelector((state, threadId: string) =>
  getItem(state.comments.threadsById, threadId),
);

/** Currently selected comment id. */
export const selectSelectedCommentId = store.createSelector(
  (state) => state.comments.selectedCommentId,
);

/** The selected comment object (or undefined). */
export const selectSelectedComment = store.createSelector((state) => {
  const id = state.comments.selectedCommentId;
  return id ? getItem(state.comments.commentsById, id) : undefined;
});

/** Currently hovered comment id. */
export const selectHoveredCommentId = store.createSelector(
  (state) => state.comments.hoveredCommentId,
);

/** The hovered comment object (or undefined). */
export const selectHoveredComment = store.createSelector((state) => {
  const id = state.comments.hoveredCommentId;
  return id ? getItem(state.comments.commentsById, id) : undefined;
});

/** Check if a thread is expanded. */
export const selectIsThreadExpanded = store.createSelector(
  (state, threadId: string) => !!state.comments.expandedThreadIds[threadId],
);

/** Get all comments for a given thread, sorted by createdAt. */
export const selectCommentsForThread = store.createSelector(
  (state, threadId: string) => {
    const ids = state.comments.commentIdsByThread[threadId];
    if (!ids || ids.length === 0) return [];

    return ids
      .map((id) => getItem(state.comments.commentsById, id))
      .filter((c): c is CommentV2 => c !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
);

