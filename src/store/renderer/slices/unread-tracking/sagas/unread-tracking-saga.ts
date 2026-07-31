import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import { selectWorkspaceAgentIds } from '../../workspace-agents/workspace-agents-selectors';
import { selectUnreadAgentIds } from '../unread-tracking-selectors';
import {
  clearAgentsUnread,
  clearAgentUnread,
  clearAllUnread,
  clearWorkspaceUnread,
  hydrateUnreadTracking,
  markAgentAsViewed,
  newAssistantMessage,
} from '../unread-tracking-slice';

const STORAGE_KEY = 'augment:unread-agents';

export function* hydrateUnreadTrackingWorker(): SagaGenerator<void> {
  const stored = yield* getLocalStorageJSON<unknown>(STORAGE_KEY);
  if (!Array.isArray(stored)) return;
  const unreadAgentIds = stored.filter((id): id is string => typeof id === 'string');
  if (unreadAgentIds.length > 0) {
    yield* put(hydrateUnreadTracking({ unreadAgentIds }));
  }
}

export function* persistUnreadTrackingWorker(): SagaGenerator<void> {
  const unreadAgentIds = yield* selectUnreadAgentIds.effect();
  yield* setLocalStorageJSON(STORAGE_KEY, unreadAgentIds);
}

export function* clearWorkspaceUnreadWorker(
  action: ReturnType<typeof clearWorkspaceUnread>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  const workspaceAgentIds = yield* selectWorkspaceAgentIds.effect(workspaceId);
  if (workspaceAgentIds.length === 0) return;
  const unreadAgentIds = yield* selectUnreadAgentIds.effect();
  const unreadSet = new Set(unreadAgentIds);
  const unreadWorkspaceAgentIds = workspaceAgentIds.filter((id) => unreadSet.has(id));
  if (unreadWorkspaceAgentIds.length > 0) {
    yield* put(clearAgentsUnread(unreadWorkspaceAgentIds));
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* unreadTrackingSaga(): SagaGenerator<void> {
  yield* hydrateUnreadTrackingWorker();
  yield* takeEvery(clearWorkspaceUnread, clearWorkspaceUnreadWorker);
  yield* takeEvery(
    [
      markAgentAsViewed,
      newAssistantMessage,
      clearAgentUnread,
      clearAgentsUnread,
      clearAllUnread,
    ],
    persistUnreadTrackingWorker,
  );
}