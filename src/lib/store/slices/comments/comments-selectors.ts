/**
 * Comments V2 selectors.
 */

import {
  createSelector,
  createCollectionItemSelector,
} from "../../utils/create-selector";
import {
  getItem,
  getItems,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import type { CommentV2 } from "$features/comments/comment-types-v2";
import type { CommentThread } from "./comments-types";

/** All comments as an ordered array. */
export const selectComments = createSelector((state) =>
  getItems(state.comments.commentsById),
);

/** All threads as an ordered array. */
export const selectThreads = createSelector((state) =>
  getItems(state.comments.threadsById),
);

/** Look up a single comment by id. */
export const selectCommentById = createCollectionItemSelector<CommentV2, "id">(
  (state) => state.comments.commentsById,
);

/** Look up a single thread by id. */
export const selectThreadById = createCollectionItemSelector<CommentThread, "id">(
  (state) => state.comments.threadsById,
);

/** Currently selected comment id. */
export const selectSelectedCommentId = createSelector(
  (state) => state.comments.selectedCommentId,
);

/** The selected comment object (or undefined). */
export const selectSelectedComment = createSelector((state) => {
  const id = state.comments.selectedCommentId;
  return id ? getItem(state.comments.commentsById, id) : undefined;
});

/** Currently hovered comment id. */
export const selectHoveredCommentId = createSelector(
  (state) => state.comments.hoveredCommentId,
);

/** The hovered comment object (or undefined). */
export const selectHoveredComment = createSelector((state) => {
  const id = state.comments.hoveredCommentId;
  return id ? getItem(state.comments.commentsById, id) : undefined;
});

/** Check if a thread is expanded. */
export const selectIsThreadExpanded = createSelector(
  (state, threadId: string) => !!state.comments.expandedThreadIds[threadId],
);

/** Get all comments for a given thread, sorted by createdAt. */
export const selectCommentsForThread = createSelector(
  (state, threadId: string) => {
    const ids = state.comments.commentIdsByThread[threadId];
    if (!ids || ids.length === 0) return [];

    return ids
      .map((id) => getItem(state.comments.commentsById, id))
      .filter((c): c is CommentV2 => c !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
);

