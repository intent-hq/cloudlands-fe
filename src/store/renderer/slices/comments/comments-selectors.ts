/**
 * Comments V2 selectors.
 */

import { store } from "../../store";
import {
  getItem,
  getItems,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

/** All comments as an ordered array. */
export const selectComments = store.createSelector((state) =>
  getItems(state.comments.commentsById),
);

/** Look up a single comment by id. */
export const selectCommentById = store.createSelector((state, commentId: string) =>
  getItem(state.comments.commentsById, commentId),
);

/** The selected comment object (or undefined). */
export const selectSelectedComment = store.createSelector((state) => {
  const id = state.comments.selectedCommentId;
  return id ? getItem(state.comments.commentsById, id) : undefined;
});

