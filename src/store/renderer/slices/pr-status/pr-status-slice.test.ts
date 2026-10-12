import { backendReconnected } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { describe, it, expect } from 'vitest';
import {
  prStatusReducer,
  initialState,
  prStatusRefreshStarted,
  prStatusRefreshCompleted,
} from './pr-status-slice';

describe('prStatusReducer', () => {
  it('returns initial state', () => {
    expect(prStatusReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('sets isRefreshing on refreshStarted', () => {
    const state = prStatusReducer(initialState, prStatusRefreshStarted('ws-1'));
    const ws = state.byWorkspaceId['ws-1'];
    expect(ws.isRefreshing).toBe(true);
    expect(ws.lastError).toBeNull();
  });

  it('clears isRefreshing and sets lastRefreshTime on successful completion', () => {
    const startedState = prStatusReducer(initialState, prStatusRefreshStarted('ws-1'));
    const state = prStatusReducer(startedState, prStatusRefreshCompleted('ws-1', true));
    const ws = state.byWorkspaceId['ws-1'];
    expect(ws.isRefreshing).toBe(false);
    expect(ws.lastRefreshTime).toBeTypeOf('number');
    expect(ws.lastError).toBeNull();
  });

  it('sets lastError on failed completion', () => {
    const startedState = prStatusReducer(initialState, prStatusRefreshStarted('ws-1'));
    const state = prStatusReducer(
      startedState,
      prStatusRefreshCompleted('ws-1', false, 'Network error'),
    );
    const ws = state.byWorkspaceId['ws-1'];
    expect(ws.isRefreshing).toBe(false);
    expect(ws.lastError).toBe('Network error');
  });

  it('does not update lastRefreshTime on failure', () => {
    const startedState = prStatusReducer(initialState, prStatusRefreshStarted('ws-1'));
    const state = prStatusReducer(startedState, prStatusRefreshCompleted('ws-1', false, 'err'));
    expect(state.byWorkspaceId['ws-1'].lastRefreshTime).toBeNull();
  });

  it('handles multiple workspaces independently', () => {
    let state = prStatusReducer(initialState, prStatusRefreshStarted('ws-1'));
    state = prStatusReducer(state, prStatusRefreshStarted('ws-2'));
    state = prStatusReducer(state, prStatusRefreshCompleted('ws-1', true));

    expect(state.byWorkspaceId['ws-1'].isRefreshing).toBe(false);
    expect(state.byWorkspaceId['ws-2'].isRefreshing).toBe(true);
  });
});

it('retires PR refresh metadata when the connection changes', () => {
  const old = prStatusReducer(initialState, prStatusRefreshCompleted('same-id', true));
  expect(prStatusReducer(old, backendReconnected())).toEqual(initialState);
});

import { prStatusScopedRefreshSucceeded } from './pr-status-slice';

describe('atomic scoped PR freshness', () => {
  const provenance = { principalContext: 'admitted-context', physicalOwnerId: 'attested-token' };
  it('writes the timestamp and provenance atomically without adding a second timestamp', () => {
    const action = prStatusScopedRefreshSucceeded('ws-1', provenance);
    const state = prStatusReducer(initialState, action);
    expect(state.byWorkspaceId['ws-1']).toEqual({
      lastRefreshTime: action.payload.timestamp,
      refreshProvenance: provenance,
      isRefreshing: false,
      lastError: null,
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
  it('retains legacy action payload and default rows without a provenance key', () => {
    const action = prStatusRefreshCompleted('ws-1', true);
    expect(action.payload).toEqual({
      wsId: 'ws-1',
      success: true,
      error: undefined,
      timestamp: expect.any(Number),
    });
    expect(prStatusReducer(initialState, action).byWorkspaceId['ws-1']).toEqual({
      lastRefreshTime: action.payload.timestamp,
      isRefreshing: false,
      lastError: null,
    });
  });
  it('clears scoped provenance on a same-clock legacy success', () => {
    const first = prStatusScopedRefreshSucceeded('ws-1', provenance);
    const scoped = prStatusReducer(initialState, first);
    const legacy = prStatusRefreshCompleted('ws-1', true);
    // Action payload time is an external reducer input; equal milliseconds must not retain provenance.
    const state = prStatusReducer(scoped, {
      ...legacy,
      payload: { ...legacy.payload, timestamp: first.payload.timestamp },
    });
    expect(state.byWorkspaceId['ws-1']).toEqual({
      lastRefreshTime: first.payload.timestamp,
      isRefreshing: false,
      lastError: null,
    });
    expect(scoped.byWorkspaceId['ws-1'].refreshProvenance).toBe(provenance);
  });
  it('does not grant or renew freshness on failed completion', () => {
    const action = prStatusScopedRefreshSucceeded('ws-1', provenance);
    const scoped = prStatusReducer(initialState, action);
    const state = prStatusReducer(scoped, prStatusRefreshCompleted('ws-1', false, 'denied'));
    expect(state.byWorkspaceId['ws-1']).toEqual({
      lastRefreshTime: action.payload.timestamp,
      refreshProvenance: provenance,
      isRefreshing: false,
      lastError: 'denied',
    });
    expect(
      prStatusReducer(initialState, prStatusRefreshCompleted('new', false, 'denied')).byWorkspaceId
        .new,
    ).toEqual({
      lastRefreshTime: null,
      isRefreshing: false,
      lastError: 'denied',
    });
  });
  it('clears both provenance and time on reconnect and preserves unrelated no-op identity', () => {
    const scoped = prStatusReducer(
      initialState,
      prStatusScopedRefreshSucceeded('ws-1', provenance),
    );
    expect(prStatusReducer(scoped, { type: 'unrelated' })).toBe(scoped);
    expect(prStatusReducer(scoped, backendReconnected())).toEqual(initialState);
  });
});
