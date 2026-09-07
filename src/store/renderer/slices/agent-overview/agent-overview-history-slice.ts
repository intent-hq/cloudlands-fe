import type { WorkspaceEvent } from '$features/events/types';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import { sanitizeWorkspaceEventsList } from '../workspace-events/workspace-events-sanitizer';

export const GRAPH_HISTORY_MAX_EVENTS = 5_000;

type GraphHistoryStatus = 'idle' | 'loading' | 'complete' | 'error';

export type GraphHistoryWorkspaceState = {
  events: WorkspaceEvent[];
  status: GraphHistoryStatus;
  nextToken: string | null;
  loadedAt: string | null;
};

export type AgentOverviewHistoryState = {
  byWorkspaceId: Record<string, GraphHistoryWorkspaceState>;
};

export const emptyGraphHistoryState: GraphHistoryWorkspaceState = {
  events: [],
  status: 'idle',
  nextToken: null,
  loadedAt: null,
};

export const initialState: AgentOverviewHistoryState = { byWorkspaceId: {} };

const RFC3339_TIMESTAMP =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

export function isValidGraphHistoryTimestamp(timestamp: string): boolean {
  return RFC3339_TIMESTAMP.test(timestamp) && Number.isFinite(Date.parse(timestamp));
}

export function sanitizeGraphHistoryEvents(value: unknown, workspaceId: string): WorkspaceEvent[] {
  return sanitizeWorkspaceEventsList(value, workspaceId).filter((event) =>
    isValidGraphHistoryTimestamp(event.timestamp),
  );
}

const { getWorkspaceState, setWorkspaceState } =
  createWorkspaceScopedHelpers(emptyGraphHistoryState);

export const loadGraphHistoryRequested = createAction<[workspaceId: string]>(
  'agentOverviewHistory/loadRequested',
);
export const graphHistoryLoadStarted = createAction<[workspaceId: string]>(
  'agentOverviewHistory/loadStarted',
);
export const graphHistoryPageReceived = createAction<
  [workspaceId: string, events: WorkspaceEvent[], nextToken: string | null]
>('agentOverviewHistory/pageReceived');
export const graphHistoryLoadCompleted = createAction<[workspaceId: string, loadedAt: string]>(
  'agentOverviewHistory/loadCompleted',
);
export const graphHistoryLoadFailed = createAction<[workspaceId: string]>(
  'agentOverviewHistory/loadFailed',
);

function mergeEvents(
  current: WorkspaceEvent[],
  incoming: WorkspaceEvent[],
  workspaceId: string,
): WorkspaceEvent[] {
  const byId = new Map(
    current
      .filter((event) => isValidGraphHistoryTimestamp(event.timestamp))
      .map((event) => [event.id, event]),
  );
  for (const event of sanitizeGraphHistoryEvents(incoming, workspaceId)) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
    .slice(-GRAPH_HISTORY_MAX_EVENTS);
}

export const agentOverviewHistoryReducer = createReducer<AgentOverviewHistoryState>(initialState);
agentOverviewHistoryReducer.with(graphHistoryLoadStarted, (state, { payload: [workspaceId] }) => {
  const current = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...current, status: 'loading' });
});
agentOverviewHistoryReducer.with(
  graphHistoryPageReceived,
  (state, { payload: [workspaceId, events, nextToken] }) => {
    const current = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...current,
      events: mergeEvents(current.events, events, workspaceId),
      status: 'loading',
      nextToken,
    });
  },
);
agentOverviewHistoryReducer.with(
  graphHistoryLoadCompleted,
  (state, { payload: [workspaceId, loadedAt] }) => {
    const current = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...current,
      status: 'complete',
      nextToken: null,
      loadedAt,
    });
  },
);
agentOverviewHistoryReducer.with(graphHistoryLoadFailed, (state, { payload: [workspaceId] }) => {
  const current = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...current, status: 'error' });
});
agentOverviewHistoryReducer.with(eventReceived, (state, { payload: [workspaceId, event] }) => {
  const current = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...current,
    events: mergeEvents(current.events, [event], workspaceId),
  });
});
