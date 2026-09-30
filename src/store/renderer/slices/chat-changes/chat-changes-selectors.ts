import { store } from '../../store';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { emptyChatChangesWorkspaceState } from './chat-changes-slice';
import type { ChatChangesWorkspaceState } from './chat-changes-types';
import { selectAgentSession } from '../agent-session/agent-session-selectors';
import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';

const selectChatChangesWorkspaceState = store.createSelector<
  [wsId?: string | null],
  ChatChangesWorkspaceState
>((state, wsId) => {
  if (!wsId) return emptyChatChangesWorkspaceState;
  return state.chatChanges.byWorkspaceId[wsId] ?? emptyChatChangesWorkspaceState;
});

export const selectChatChangesConsumer = store.createSelector((state, wsId: string, id: string) =>
  getItem(selectChatChangesWorkspaceState.select(state, wsId).consumers, id),
);
export const selectChatChangesConsumers = store.createSelector((state, wsId: string) =>
  getItems(selectChatChangesWorkspaceState.select(state, wsId).consumers),
);
export const selectAllChatChangesConsumers = store.createSelector((state) =>
  Object.entries(state.chatChanges.byWorkspaceId).flatMap(([wsId, workspace]) =>
    getItems(workspace.consumers).map((consumer) => ({ wsId, consumer })),
  ),
);
export const selectChatChanges = store.createSelector((state, wsId: string, id: string) => {
  const consumer = selectChatChangesConsumer.select(state, wsId, id);
  return consumer ? getItems(consumer.changes).map((entry) => entry.change) : [];
});
export const selectChatChangesRefreshingPaths = store.createSelector(
  (state, wsId: string, id: string) => {
    const consumer = selectChatChangesConsumer.select(state, wsId, id);
    return consumer
      ? getItems(consumer.fileRefreshes)
          .filter((refresh) => refresh.status === 'pending')
          .map((refresh) => refresh.path)
      : [];
  },
);
export const selectChatChangesCanRead = store.createSelector(
  (state, wsId: string, id: string, resourceKey: string) => {
    const consumer = selectChatChangesConsumer.select(state, wsId, id);
    if (!consumer || consumer.resourceKey !== resourceKey || consumer.options.nodeOwnedPaths)
      return false;
    const agentId = consumer.options.agentId;
    if (!agentId) return true;
    const agent = selectAgentSession.select(state, agentId);
    return !!agent && !hasNodeOwnedAgentPath(agent);
  },
);
