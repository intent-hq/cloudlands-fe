import { store } from '$store/renderer/store';

export const selectNodePaste = store.createSelector((state) => state.nodes.paste);
export const selectHighlightedConnectionId = store.createSelector(
  (state) => state.nodes.highlightId,
);
