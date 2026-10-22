import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectAgentMutationUi = store.createSelector(
  (state, workspaceId: string, consumerId: string) => {
    const workspace = state.agentMutationUi.byWorkspaceId[workspaceId];
    const entry = workspace ? getItem(workspace.consumers, consumerId) : undefined;
    return entry && !entry.consumed ? { ...entry, workspaceId } : undefined;
  },
);
