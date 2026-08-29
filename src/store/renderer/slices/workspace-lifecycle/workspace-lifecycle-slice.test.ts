import { describe, expect, it } from 'vitest';

import { removeWorkspaceEntity, resetWorkspaceState } from '../workspace/workspace-slice';
import {
  backendReconnected,
  initialState,
  workspaceDeleted,
  workspaceLifecycleReducer,
  workspaceLoadSucceeded,
  workspaceMounted,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from './workspace-lifecycle-slice';

const WS = 'ws-lifecycle';

describe('workspaceLifecycleReducer', () => {
  it('becomes live only after hydration and backend open both complete', () => {
    const hydrated = workspaceLifecycleReducer(initialState, workspaceMounted(WS));
    expect(hydrated.sessionPhaseByWorkspaceId).toEqual({ [WS]: 'hydrated' });

    const live = workspaceLifecycleReducer(hydrated, workspaceOpenSucceeded(WS));
    expect(live.sessionPhaseByWorkspaceId).toEqual({ [WS]: 'live' });
    expect(workspaceLifecycleReducer(live, workspaceMounted(WS))).toBe(live);
    expect(workspaceLifecycleReducer(live, workspaceOpenSucceeded(WS))).toBe(live);
  });

  it('also becomes live when backend open completes before hydration', () => {
    const opened = workspaceLifecycleReducer(initialState, workspaceOpenSucceeded(WS));
    expect(opened.sessionPhaseByWorkspaceId).toEqual({ [WS]: 'opened' });

    expect(
      workspaceLifecycleReducer(opened, workspaceMounted(WS)).sessionPhaseByWorkspaceId,
    ).toEqual({ [WS]: 'live' });
  });

  it.each([
    ['open failure', workspaceOpenFailed(WS)],
    ['session unmount', workspaceUnmounted(WS)],
    ['workspace deletion', workspaceDeleted(WS, [])],
    ['entity eviction', removeWorkspaceEntity(WS)],
  ])('clears a live session on %s', (_name, action) => {
    const live = workspaceLifecycleReducer(
      workspaceLifecycleReducer(initialState, workspaceMounted(WS)),
      workspaceOpenSucceeded(WS),
    );

    expect(workspaceLifecycleReducer(live, action).sessionPhaseByWorkspaceId).toEqual({});
  });

  it('clears every session phase on backend reconnect but keeps load state (#3788)', () => {
    let state = workspaceLifecycleReducer(initialState, workspaceMounted('ws-a'));
    state = workspaceLifecycleReducer(state, workspaceOpenSucceeded('ws-a'));
    state = workspaceLifecycleReducer(state, workspaceMounted('ws-b'));
    state = workspaceLifecycleReducer(state, workspaceLoadSucceeded('ws-a'));

    const reconnected = workspaceLifecycleReducer(state, backendReconnected());
    expect(reconnected.sessionPhaseByWorkspaceId).toEqual({});
    expect(reconnected.loadByWorkspaceId).toBe(state.loadByWorkspaceId);
    expect(workspaceLifecycleReducer(reconnected, backendReconnected())).toBe(reconnected);
  });

  it('clears all sessions on workspace state reset and preserves no-op identity', () => {
    const live = workspaceLifecycleReducer(
      workspaceLifecycleReducer(initialState, workspaceMounted(WS)),
      workspaceOpenSucceeded(WS),
    );

    expect(workspaceLifecycleReducer(live, resetWorkspaceState())).toBe(initialState);
    expect(workspaceLifecycleReducer(initialState, workspaceOpenFailed(WS))).toBe(initialState);
  });
});
