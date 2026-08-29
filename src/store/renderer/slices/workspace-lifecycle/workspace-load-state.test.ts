import { describe, expect, it } from 'vitest';

import type { Workspace } from '$shared/types';
import {
  removeWorkspaceEntity,
  setPendingCreation,
  setWorkspaceEntity,
  workspaceReducer,
} from '../workspace/workspace-slice';
import {
  initialState,
  workspaceLoadCachedReady,
  workspaceLoadFailed,
  workspaceLoadStarted,
  workspaceLifecycleReducer,
} from './workspace-lifecycle-slice';
import {
  selectWorkspaceLoadError,
  selectWorkspaceLoadResult,
  selectWorkspaceLoadState,
} from './workspace-lifecycle-selectors';

const workspace = (id: string) => ({ id, title: id }) as Workspace;

describe('workspace load state', () => {
  it('stores serializable request, cached-ready, and failure state by workspace', () => {
    let state = workspaceLifecycleReducer(initialState, workspaceLoadStarted('ws-1'));
    state = workspaceLifecycleReducer(state, workspaceLoadCachedReady('ws-1'));
    state = workspaceLifecycleReducer(
      state,
      workspaceLoadFailed('ws-2', { kind: 'error', message: 'offline' }),
    );

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state.loadByWorkspaceId).toEqual({
      'ws-1': { status: 'cached-ready', error: null },
      'ws-2': { status: 'error', error: { kind: 'error', message: 'offline' } },
    });
  });

  it('exposes default state, errors, and canonical entity results through selectors', () => {
    const real = workspace('ws-real');
    const optimistic = workspace('optimistic-1');
    let workspaceState = workspaceReducer(undefined, setWorkspaceEntity(real));
    workspaceState = workspaceReducer(workspaceState, setPendingCreation(optimistic));
    const lifecycleState = workspaceLifecycleReducer(
      initialState,
      workspaceLoadFailed('ws-error', { kind: 'not_found', message: 'missing' }),
    );
    const state = { workspace: workspaceState, workspaceLifecycle: lifecycleState } as never;

    expect(selectWorkspaceLoadState.select(state, 'unseen')).toEqual({
      status: 'idle',
      error: null,
    });
    expect(selectWorkspaceLoadError.select(state, 'ws-error')).toEqual({
      kind: 'not_found',
      message: 'missing',
    });
    expect(selectWorkspaceLoadResult.select(state, real.id)).toMatchObject(real);
    expect(selectWorkspaceLoadResult.select(state, optimistic.id)).toMatchObject(optimistic);
  });

  it('clears an in-flight load when its workspace entity is explicitly evicted', () => {
    const loading = workspaceLifecycleReducer(initialState, workspaceLoadStarted('evicted'));

    const evicted = workspaceLifecycleReducer(loading, removeWorkspaceEntity('evicted'));

    expect(evicted.loadByWorkspaceId['evicted']).toBeUndefined();
  });
});
