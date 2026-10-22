/**
 * Comments V2 selectors.
 */

import { store } from '../../store';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';

/** All comments as an ordered array. */
export const selectComments = store.createSelector((state) =>
  getItems(state.comments.commentsById),
);

/** Comments owned by this exact workspace/note. Unknown ownership is not displayable. */
export const selectCommentsForNote = store.createSelector(
  (state, workspaceId: string, noteId: string) =>
    getItems(state.comments.commentsById).filter(
      (comment) =>
        !!workspaceId &&
        !!noteId &&
        comment.workspaceId === workspaceId &&
        comment.noteId === noteId,
    ),
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
