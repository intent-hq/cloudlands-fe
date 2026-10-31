import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { TraceRecord } from '$features/agent-trace/trace-types';
import {
  agentTraceCleared,
  agentTraceLoadFinished,
  agentTraceLoadStarted,
  agentTraceRecordsReceived,
  agentTraceReducer,
  initialState,
} from './agent-trace-slice';

const WS = 'ws-1';

const failure = (id: string, ts: number): TraceRecord => ({
  id,
  ts,
  kind: 'failure',
  agentId: 'agent-a',
  error: 'boom',
});

describe('agentTraceReducer', () => {
  it('tracks the turn history load, keeping its records on failure', () => {
    let state = agentTraceReducer(initialState, agentTraceLoadStarted(WS));
    expect(state.byWorkspaceId[WS].status).toBe('loading');
    state = agentTraceReducer(state, agentTraceRecordsReceived(WS, [failure('e1', 1)]));
    state = agentTraceReducer(state, agentTraceLoadFinished(WS, false));
    expect(state.byWorkspaceId[WS].status).toBe('error');
    expect(getItems(state.byWorkspaceId[WS].records)).toHaveLength(1);
    state = agentTraceReducer(state, agentTraceLoadStarted(WS));
    state = agentTraceReducer(state, agentTraceLoadFinished(WS, true));
    expect(state.byWorkspaceId[WS].status).toBe('ready');
  });

  it('stores each daemon event once, across and within batches', () => {
    let state = agentTraceReducer(
      initialState,
      agentTraceRecordsReceived(WS, [failure('e1', 1), failure('e1', 1), failure('e2', 2)]),
    );
    const before = state;
    state = agentTraceReducer(state, agentTraceRecordsReceived(WS, [failure('e2', 2)]));
    expect(state).toBe(before);
    expect(getItems(state.byWorkspaceId[WS].records).map((record) => record.id)).toEqual([
      'e1',
      'e2',
    ]);
  });

  it('drops the workspace on clear', () => {
    let state = agentTraceReducer(initialState, agentTraceRecordsReceived(WS, [failure('e1', 1)]));
    state = agentTraceReducer(state, agentTraceCleared(WS));
    expect(state.byWorkspaceId[WS]).toBeUndefined();
  });
});
