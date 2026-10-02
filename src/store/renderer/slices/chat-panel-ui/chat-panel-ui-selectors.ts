import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectUserMessageIndexUi = store.createSelector(
  (state, workspaceId: string, consumerId: string) => {
    const workspace = state.chatPanelUi.byWorkspaceId[workspaceId];
    return workspace ? getItem(workspace.userMessageIndexes, consumerId) : undefined;
  },
);

export const selectRetryAgentUi = store.createSelector(
  (state, workspaceId: string, consumerId: string) => {
    const workspace = state.chatPanelUi.byWorkspaceId[workspaceId];
    return workspace ? getItem(workspace.retryAgents, consumerId) : undefined;
  },
);
