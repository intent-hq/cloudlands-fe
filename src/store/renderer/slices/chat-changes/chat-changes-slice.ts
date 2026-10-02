import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  AgentFileRefreshEntry,
  ChatChangesInput,
  ChatChangesConsumer,
  ChatChangeEntry,
  ChatFileRefresh,
  ChatChangesState,
  ChatChangesWorkspaceState,
} from './chat-changes-types';
import type { LocalFileChange } from '$lib/components/chat/types';
import {
  chatChangesResourceKey,
  generateChangesKey,
  REFRESH_COOLDOWN_MS,
} from '$lib/components/chat/chat-changes-enrichment';

export type { ChatChangesState, ChatChangesWorkspaceState };

export const emptyChatChangesWorkspaceState: ChatChangesWorkspaceState = {
  refreshes: createCollection<AgentFileRefreshEntry, 'path'>('path'),
  consumers: createCollection<ChatChangesConsumer, 'id'>('id'),
};

export const initialState: ChatChangesState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyChatChangesWorkspaceState,
);

export const agentFileChangeReceived = createAction<[wsId: string, path: string]>(
  'chatChanges/agentFileChangeReceived',
);

export const agentFileRefreshTriggered = createAction<[wsId: string, path: string]>(
  'chatChanges/agentFileRefreshTriggered',
);

export const chatChangesInputChanged = createAction<
  [wsId: string, consumerId: string, requestId: string, input: ChatChangesInput]
>('chatChanges/inputChanged');
export const chatChangesConsumerReleased = createAction<[wsId: string, consumerId: string]>(
  'chatChanges/consumerReleased',
);
export const chatChangesEnriched =
  createAction<
    [
      wsId: string,
      consumerId: string,
      requestId: string,
      resourceKey: string,
      changes: LocalFileChange[],
      now: number,
      error?: string,
    ]
  >('chatChanges/enriched');
export const chatChangesFileRefreshStarted = createAction<
  [wsId: string, consumerId: string, resourceKey: string, refresh: ChatFileRefresh]
>('chatChanges/fileRefreshStarted');
export const chatChangesMutationRefreshQueued = createAction<
  [
    wsId: string,
    consumerId: string,
    resourceKey: string,
    path: string,
    requestId: string,
    now: number,
  ]
>('chatChanges/mutationRefreshQueued');
export const chatChangesFileRefreshed = createAction<
  [
    wsId: string,
    consumerId: string,
    resourceKey: string,
    refresh: ChatFileRefresh,
    changes?: LocalFileChange[],
  ]
>('chatChanges/fileRefreshed');
export const chatChangesHunkRequested = createAction<
  [
    wsId: string,
    consumerId: string,
    requestId: string,
    kind: 'stageHunk' | 'unstageHunk',
    filePath: string,
    hunkPatch: string,
  ]
>('chatChanges/hunkRequested');

function entries(changes: LocalFileChange[]) {
  return createCollection<ChatChangeEntry, 'id'>(
    'id',
    changes.map((change, index) => ({ id: String(index), change })),
  );
}

function updateConsumer(state: ChatChangesState, wsId: string, consumer: ChatChangesConsumer) {
  const workspace = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...workspace,
    consumers: upsertItem(workspace.consumers, consumer),
  });
}

export const chatChangesReducer = createReducer<ChatChangesState>(initialState);
chatChangesReducer.with(
  chatChangesInputChanged,
  (state, { payload: [wsId, id, requestId, input] }) => {
    const current = getItem(getWorkspaceState(state, wsId).consumers, id);
    const { changes, ...options } = input;
    const resourceKey = chatChangesResourceKey(options);
    const changesKey = generateChangesKey(changes);
    const sameResource = current?.resourceKey === resourceKey;
    const raw = input.nodeOwnedPaths || (!input.showStagingControls && !input.isAggregate);
    if (!raw && sameResource && current.changesKey === changesKey && current.status !== 'failed')
      return state;
    return updateConsumer(state, wsId, {
      id,
      resourceKey,
      changesKey,
      requestId,
      options,
      status: raw || !changes.length ? 'ready' : 'pending',
      changes: !sameResource || raw || !changes.length ? entries(changes) : current.changes,
      fileRefreshes: sameResource
        ? current.fileRefreshes
        : createCollection<ChatFileRefresh, 'path'>('path'),
    });
  },
);
chatChangesReducer.with(chatChangesConsumerReleased, (state, { payload: [wsId, id] }) => {
  const workspace = getWorkspaceState(state, wsId);
  if (!getItem(workspace.consumers, id)) return state;
  return setWorkspaceState(state, wsId, {
    ...workspace,
    consumers: removeItem(workspace.consumers, id),
  });
});
chatChangesReducer.with(
  chatChangesEnriched,
  (state, { payload: [wsId, id, requestId, resourceKey, changes, now, error] }) => {
    const current = getItem(getWorkspaceState(state, wsId).consumers, id);
    if (!current || current.requestId !== requestId || current.resourceKey !== resourceKey)
      return state;
    const protectedPaths = new Set(
      getItems(current.fileRefreshes)
        .filter(
          (refresh) =>
            refresh.status === 'pending' ||
            (refresh.status === 'ready' && now - refresh.refreshedAt < REFRESH_COOLDOWN_MS),
        )
        .map((refresh) => refresh.path),
    );
    const retained = getItems(current.changes)
      .map((entry) => entry.change)
      .filter((change) => protectedPaths.has(change.filePath));
    return updateConsumer(state, wsId, {
      ...current,
      status: error ? 'failed' : 'ready',
      error,
      changes: entries([
        ...changes.filter((change) => !protectedPaths.has(change.filePath)),
        ...retained,
      ]),
    });
  },
);
chatChangesReducer.with(
  chatChangesMutationRefreshQueued,
  (state, { payload: [wsId, id, resourceKey, path, requestId, now] }) => {
    const current = getItem(getWorkspaceState(state, wsId).consumers, id);
    if (!current || current.resourceKey !== resourceKey) return state;
    const refresh = getItem(current.fileRefreshes, path) ?? {
      path,
      requestId: '',
      status: 'pending' as const,
      refreshedAt: now,
    };
    return updateConsumer(state, wsId, {
      ...current,
      fileRefreshes: upsertItem(current.fileRefreshes, {
        ...refresh,
        queuedMutationRequestId: requestId,
      }),
    });
  },
);
chatChangesReducer.with(
  chatChangesFileRefreshStarted,
  (state, { payload: [wsId, id, resourceKey, refresh] }) => {
    const current = getItem(getWorkspaceState(state, wsId).consumers, id);
    if (!current || current.resourceKey !== resourceKey) return state;
    return updateConsumer(state, wsId, {
      ...current,
      fileRefreshes: upsertItem(current.fileRefreshes, {
        ...refresh,
        queuedMutationRequestId: getItem(current.fileRefreshes, refresh.path)
          ?.queuedMutationRequestId,
      }),
    });
  },
);
chatChangesReducer.with(
  chatChangesFileRefreshed,
  (state, { payload: [wsId, id, resourceKey, refresh, changes] }) => {
    const current = getItem(getWorkspaceState(state, wsId).consumers, id);
    if (
      !current ||
      current.resourceKey !== resourceKey ||
      getItem(current.fileRefreshes, refresh.path)?.requestId !== refresh.requestId
    )
      return state;
    const queuedMutationRequestId = getItem(
      current.fileRefreshes,
      refresh.path,
    )?.queuedMutationRequestId;
    return updateConsumer(state, wsId, {
      ...current,
      fileRefreshes: upsertItem(current.fileRefreshes, {
        ...refresh,
        queuedMutationRequestId:
          refresh.status === 'ready' && refresh.mutationRequestId === queuedMutationRequestId
            ? undefined
            : queuedMutationRequestId,
      }),
      changes: changes
        ? entries([
            ...getItems(current.changes)
              .map((entry) => entry.change)
              .filter((change) => change.filePath !== refresh.path),
            ...changes,
          ])
        : current.changes,
      completedMutationRequestId:
        refresh.status === 'ready' && refresh.mutationRequestId
          ? refresh.mutationRequestId
          : current.completedMutationRequestId,
    });
  },
);
chatChangesReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
chatChangesReducer.with(agentFileRefreshTriggered, (state, { payload: [wsId, path] }) => {
  const workspaceState = getWorkspaceState(state, wsId);
  const current = getItem(workspaceState.refreshes, path);
  const next: AgentFileRefreshEntry = {
    path,
    version: (current?.version ?? 0) + 1,
  };

  return setWorkspaceState(state, wsId, {
    ...workspaceState,
    refreshes: upsertItem(workspaceState.refreshes, next),
  });
});
