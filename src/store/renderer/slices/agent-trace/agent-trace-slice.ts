/**
 * Agent trace slice (renderer).
 *
 * Holds the slim trace records (`TraceRecord`) of workspaces whose agent
 * overview is open. The agent-trace saga fills it from `event.query` history
 * (PROTOCOL §5.10) and a workspace-scoped `events.subscribe` lease (§6); the
 * entry is dropped when the last panel closes.
 */
import {
  addItems,
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { TraceRecord } from '$features/agent-trace/trace-types';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';

type AgentTraceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AgentTraceWorkspaceState {
  /** Keyed by daemon event id; the builder orders by time. */
  records: Collection<TraceRecord, 'id'>;
  /** Turn history (messages and failures); tool calls and usage fill in after it. */
  status: AgentTraceStatus;
}

export interface AgentTraceState {
  byWorkspaceId: Record<string, AgentTraceWorkspaceState>;
}

export const emptyAgentTraceWorkspaceState: AgentTraceWorkspaceState = {
  records: createCollection<TraceRecord, 'id'>('id'),
  status: 'idle',
};

export const initialState: AgentTraceState = { byWorkspaceId: {} };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A panel showing the workspace trace mounted (reference counted). */
export const agentTraceOpened = createAction<[wsId: string]>('agentTrace/opened');

/** A panel showing the workspace trace unmounted. */
export const agentTraceClosed = createAction<[wsId: string]>('agentTrace/closed');

/** Reload history and resubscribe after a failed load. */
export const agentTraceRetryRequested = createAction<[wsId: string]>('agentTrace/retryRequested');

/** The view needs tool-call and usage history back to `from` (epoch ms). */
export const agentTraceDetailRequested = createAction<[wsId: string, from: number]>(
  'agentTrace/detailRequested',
);

/** Turn history started loading. */
export const agentTraceLoadStarted = createAction<[wsId: string]>('agentTrace/loadStarted');

/** Turn history finished loading, or failed. */
export const agentTraceLoadFinished =
  createAction<[wsId: string, ok: boolean]>('agentTrace/loadFinished');

/** History pages or batched live events arrived. */
export const agentTraceRecordsReceived = createAction<[wsId: string, records: TraceRecord[]]>(
  'agentTrace/recordsReceived',
);

export const agentTraceCleared = createAction<[wsId: string]>('agentTrace/cleared');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyAgentTraceWorkspaceState,
);

export const agentTraceReducer = createReducer<AgentTraceState>(initialState);

agentTraceReducer.with(agentTraceLoadStarted, (state, { payload: [wsId] }) =>
  setWorkspaceState(state, wsId, { ...getWorkspaceState(state, wsId), status: 'loading' }),
);

agentTraceReducer.with(agentTraceLoadFinished, (state, { payload: [wsId, ok] }) =>
  setWorkspaceState(state, wsId, {
    ...getWorkspaceState(state, wsId),
    status: ok ? 'ready' : 'error',
  }),
);

agentTraceReducer.with(agentTraceRecordsReceived, (state, { payload: [wsId, records] }) => {
  const current = getWorkspaceState(state, wsId);
  const seen = new Set<string>();
  const fresh = records.filter((record) => {
    if (seen.has(record.id) || current.records.map[record.id]) return false;
    seen.add(record.id);
    return true;
  });
  if (fresh.length === 0) return state;
  return setWorkspaceState(state, wsId, { ...current, records: addItems(current.records, fresh) });
});

agentTraceReducer.with(agentTraceCleared, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
