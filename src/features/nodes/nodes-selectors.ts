import { store } from '$store/renderer/store';
import type { NodeRefusal } from '$shared/types/pair-link';

export const selectNodePaste = store.createSelector((state) => state.nodes.paste);
export const selectHighlightedConnectionId = store.createSelector(
  (state) => state.nodes.highlightId,
);

/**
 * Why the current backend can't use a node: Labs Remote agents off, or no
 * `remoteMachines: 1` (loaded on every connect). Null when it can.
 */
export const selectNodeRefusal = store.createSelector((state): NodeRefusal | null => {
  if (state.userPreferences?.labsRemoteAgentsEnabled !== true) return 'labs-off';
  return state.remoteMachines?.supported === true ? null : 'backend-unsupported';
});
