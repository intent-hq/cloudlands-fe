import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { connectionStatusChanged } from '../daemon-health/daemon-health-slice';
import { daemonEventsSubscribing } from '../workspace-events/workspace-events-slice';
import {
  desktopKey,
  emptyDesktopEntry,
  type DesktopControlState,
  type DesktopDecision,
  type DesktopEntry,
  type DesktopEvent,
  type DesktopSnapshot,
} from './desktop-control-types';

export const desktopReadRequested = createAction<[workspaceId: string, agentId: string]>(
  'desktopControl/readRequested',
);
export const desktopDecisionRequested = createAction<
  [workspaceId: string, agentId: string, requestId: string, decision: DesktopDecision]
>('desktopControl/decisionRequested');
export const desktopPermissionRequested = createAction<
  [workspaceId: string, agentId: string, computerId: string, allowed: boolean]
>('desktopControl/permissionRequested');
export const desktopEventReceived = createAction<[event: DesktopEvent]>(
  'desktopControl/eventReceived',
);
export const desktopSnapshotReceived = createAction<
  [
    workspaceId: string,
    agentId: string,
    generation: number,
    revision: number,
    snapshot: DesktopSnapshot,
  ]
>('desktopControl/snapshotReceived');
export const desktopEntryPatched = createAction<
  [workspaceId: string, agentId: string, generation: number, patch: Partial<DesktopEntry>]
>('desktopControl/entryPatched');
export const desktopRequestExpired = createAction<
  [workspaceId: string, agentId: string, requestId: string]
>('desktopControl/requestExpired');

export const desktopControlReducer = createReducer<DesktopControlState>({
  generation: 0,
  byKey: {},
  seenEvents: [],
});
function update(
  state: DesktopControlState,
  ws: string,
  agent: string,
  fn: (entry: DesktopEntry) => DesktopEntry,
): DesktopControlState {
  const key = desktopKey(ws, agent);
  return {
    ...state,
    byKey: { ...state.byKey, [key]: fn(state.byKey[key] ?? emptyDesktopEntry(ws, agent)) },
  };
}
function invalidate(state: DesktopControlState): DesktopControlState {
  return {
    ...state,
    generation: state.generation + 1,
    byKey: Object.fromEntries(
      Object.entries(state.byKey).map(([key, entry]) => [
        key,
        {
          ...emptyDesktopEntry(entry.workspaceId, entry.agentId),
          resolvedRequests: [
            ...entry.resolvedRequests,
            ...(entry.pending ? [entry.pending.requestId] : []),
          ],
          endedSessions: [
            ...entry.endedSessions,
            ...(entry.state.status === 'active' ? [entry.state.sessionId] : []),
          ],
        },
      ]),
    ),
  };
}
desktopControlReducer.with(daemonEventsSubscribing, invalidate);
desktopControlReducer.with(connectionStatusChanged, (state, { payload: [status] }) =>
  status === 'connected' ? state : invalidate(state),
);
desktopControlReducer.with(desktopReadRequested, (state, { payload: [ws, agent] }) =>
  update(state, ws, agent, (entry) => ({ ...entry, loading: true })),
);
desktopControlReducer.with(
  desktopEntryPatched,
  (state, { payload: [ws, agent, generation, patch] }) =>
    generation === state.generation
      ? update(state, ws, agent, (entry) => ({ ...entry, ...patch }))
      : state,
);
desktopControlReducer.with(
  desktopSnapshotReceived,
  (state, { payload: [ws, agent, generation, revision, snapshot] }) => {
    if (generation !== state.generation) return state;
    return update(state, ws, agent, (entry) =>
      entry.revision !== revision || entry.saving
        ? entry
        : { ...entry, ...snapshot, pending: snapshot.pending, loading: false, error: undefined },
    );
  },
);
desktopControlReducer.with(desktopRequestExpired, (state, { payload: [ws, agent, requestId] }) =>
  update(state, ws, agent, (entry) =>
    entry.pending?.requestId !== requestId
      ? entry
      : {
          ...entry,
          pending: undefined,
          submitting: false,
          state: entry.state.status === 'pending_permission' ? { status: 'inactive' } : entry.state,
          revision: entry.revision + 1,
          resolvedRequests: [...entry.resolvedRequests, requestId],
        },
  ),
);
desktopControlReducer.with(desktopEventReceived, (state, { payload: [event] }) => {
  if (state.seenEvents.includes(event.id)) return state;
  const { workspaceId, agentId } = event.data;
  const next = update(state, workspaceId, agentId, (entry) => {
    const base = { ...entry, revision: entry.revision + 1 };
    switch (event.type) {
      case 'desktop:permission-requested':
        if (
          entry.resolvedRequests.includes(event.data.requestId) ||
          entry.pending?.requestId === event.data.requestId
        )
          return entry;
        return {
          ...base,
          pending: event.data,
          submitting: false,
          error: undefined,
          state: {
            status: 'pending_permission',
            requestId: event.data.requestId,
            computerName: event.data.computerName,
          },
        };
      case 'desktop:permission-resolved': {
        const resolvedRequests = [...entry.resolvedRequests, event.data.requestId];
        if (entry.pending?.requestId !== event.data.requestId) return { ...base, resolvedRequests };
        return {
          ...base,
          resolvedRequests,
          pending: undefined,
          submitting: false,
          state:
            event.data.state.status === 'active' &&
            entry.endedSessions.includes(event.data.state.sessionId)
              ? entry.state
              : entry.state.status === 'active' &&
                  (event.data.state.status !== 'active' ||
                    entry.state.sessionId !== event.data.state.sessionId)
                ? entry.state
                : event.data.state,
          error: event.data.error?.detail,
        };
      }
      case 'desktop:permission-changed':
        if (entry.permission && entry.permission.computerId !== event.data.permission.computerId)
          return base;
        return { ...base, permission: event.data.permission };
      case 'desktop:session-changed':
        if (event.data.status === 'active') {
          if (entry.endedSessions.includes(event.data.sessionId)) return base;
          return {
            ...base,
            state: {
              status: 'active',
              sessionId: event.data.sessionId,
              computerName: event.data.computerName,
            },
          };
        }
        return {
          ...base,
          endedSessions: [...entry.endedSessions, event.data.sessionId],
          state:
            entry.state.status === 'active' && entry.state.sessionId === event.data.sessionId
              ? { status: 'inactive' }
              : entry.state,
        };
    }
  });
  return { ...next, seenEvents: [...state.seenEvents, event.id].slice(-512) };
});
