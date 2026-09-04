/**
 * backgroundHooks slice reducer tests (PROTOCOL §5.40 chip-row state).
 */
import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';
import {
  backgroundHooksMarkedStale,
  backgroundHooksReducer,
  backgroundHooksRefetchRequested,
  backgroundHooksUpdated,
  initialState,
} from './background-hooks-slice';
import { selectBackgroundHooksSnapshotDelivered } from './background-hooks-selectors';

function makeHook(overrides: Partial<BackgroundHook> = {}): BackgroundHook {
  return {
    hookId: 'hook-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    name: 'ci-watch',
    delayMs: 60000,
    state: 'scheduled',
    createdAt: '2026-07-31T10:00:00Z',
    nextRunAt: '2026-07-31T10:06:00Z',
    runCount: 6,
    ...overrides,
  };
}

describe('backgroundHooksReducer', () => {
  it('starts with no workspaces', () => {
    expect(backgroundHooksReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('backgroundHooksUpdated stores the list as a Collection keyed by hookId', () => {
    const hooks = [makeHook(), makeHook({ hookId: 'hook-2', state: 'running' })];
    const state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', hooks));

    const ws = state.byWorkspaceId['ws-1'];
    expect(ws).toBeDefined();
    expect(getItems(ws.hooks)).toEqual(hooks);
    expect(ws.hooks.map['hook-2'].state).toBe('running');
  });

  it('backgroundHooksUpdated stores lastLogs from the hook.list wire shape (§5.40)', () => {
    const lastLogs = 'checking CI\nall green';
    const state = backgroundHooksReducer(
      initialState,
      backgroundHooksUpdated('ws-1', [makeHook({ lastLogs })]),
    );
    expect(state.byWorkspaceId['ws-1'].hooks.map['hook-1'].lastLogs).toBe(lastLogs);
  });

  it('backgroundHooksRefetchRequested is a pure trigger with no reducer case', () => {
    const state = backgroundHooksReducer(
      initialState,
      backgroundHooksUpdated('ws-1', [makeHook()]),
    );
    expect(backgroundHooksReducer(state, backgroundHooksRefetchRequested('ws-1'))).toBe(state);
  });

  it('backgroundHooksUpdated preserves code captured from hook.list across folds', () => {
    const code = 'const status = await ws.ci.status();';
    let state = backgroundHooksReducer(
      initialState,
      backgroundHooksUpdated('ws-1', [makeHook({ code })]),
    );
    state = backgroundHooksReducer(
      state,
      backgroundHooksUpdated('ws-1', [makeHook({ code, state: 'running' })]),
    );

    const hook = state.byWorkspaceId['ws-1'].hooks.map['hook-1'];
    expect(hook.state).toBe('running');
    expect(hook.code).toBe(code);
  });

  it('backgroundHooksUpdated replaces the previous list for the same workspace', () => {
    let state = backgroundHooksReducer(
      initialState,
      backgroundHooksUpdated('ws-1', [makeHook(), makeHook({ hookId: 'hook-2' })]),
    );
    state = backgroundHooksReducer(
      state,
      backgroundHooksUpdated('ws-1', [makeHook({ hookId: 'hook-2', state: 'running' })]),
    );

    expect(getItems(state.byWorkspaceId['ws-1'].hooks)).toEqual([
      makeHook({ hookId: 'hook-2', state: 'running' }),
    ]);
  });

  it('keeps workspaces isolated', () => {
    let state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [makeHook()]));
    state = backgroundHooksReducer(
      state,
      backgroundHooksUpdated('ws-2', [makeHook({ hookId: 'hook-9', workspaceId: 'ws-2' })]),
    );

    expect(getItems(state.byWorkspaceId['ws-1'].hooks)).toHaveLength(1);
    expect(getItems(state.byWorkspaceId['ws-2'].hooks)[0].hookId).toBe('hook-9');
  });

  it('backgroundHooksMarkedStale retains the hooks and flags only the addressed workspace', () => {
    let state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [makeHook()]));
    state = backgroundHooksReducer(
      state,
      backgroundHooksUpdated('ws-2', [makeHook({ hookId: 'hook-9', workspaceId: 'ws-2' })]),
    );
    state = backgroundHooksReducer(state, backgroundHooksMarkedStale('ws-1'));

    expect(state.byWorkspaceId['ws-1'].stale).toBe(true);
    expect(getItems(state.byWorkspaceId['ws-1'].hooks)).toEqual([makeHook()]);
    expect(state.byWorkspaceId['ws-2'].stale).toBe(false);
  });

  it('backgroundHooksMarkedStale on an unknown workspace is a no-op', () => {
    const state = backgroundHooksReducer(initialState, backgroundHooksMarkedStale('ws-x'));
    expect(state).toBe(initialState);
  });

  it('backgroundHooksUpdated clears the stale flag with the next delivered list', () => {
    let state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [makeHook()]));
    state = backgroundHooksReducer(state, backgroundHooksMarkedStale('ws-1'));
    expect(state.byWorkspaceId['ws-1'].stale).toBe(true);

    state = backgroundHooksReducer(
      state,
      backgroundHooksUpdated('ws-1', [makeHook({ state: 'running' })]),
    );
    expect(state.byWorkspaceId['ws-1'].stale).toBe(false);
    expect(state.byWorkspaceId['ws-1'].hooks.map['hook-1'].state).toBe('running');
  });

  it('provisional backgroundHooksUpdated updates the rows but preserves the stale flag', () => {
    let state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [makeHook()]));
    state = backgroundHooksReducer(state, backgroundHooksMarkedStale('ws-1'));

    state = backgroundHooksReducer(
      state,
      backgroundHooksUpdated('ws-1', [makeHook({ state: 'running' })], true),
    );
    expect(state.byWorkspaceId['ws-1'].stale).toBe(true);
    expect(state.byWorkspaceId['ws-1'].hooks.map['hook-1'].state).toBe('running');
  });

  it('provisional backgroundHooksUpdated on a fresh entry keeps it fresh', () => {
    let state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [makeHook()]));
    state = backgroundHooksReducer(
      state,
      backgroundHooksUpdated('ws-1', [makeHook({ state: 'running' })], true),
    );
    expect(state.byWorkspaceId['ws-1'].stale).toBe(false);
  });

  it('provisional backgroundHooksUpdated on an unknown workspace creates a non-stale entry', () => {
    const state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [], true));
    expect(state.byWorkspaceId['ws-1']).toBeDefined();
    expect(state.byWorkspaceId['ws-1'].stale).toBe(false);
  });

  it("removeWorkspaceEntity clears the workspace's hooks", () => {
    let state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [makeHook()]));
    state = backgroundHooksReducer(state, removeWorkspaceEntity('ws-1'));
    expect(state.byWorkspaceId['ws-1']).toBeUndefined();
  });

  it('selectBackgroundHooksSnapshotDelivered flips once any list (even empty) is delivered', () => {
    expect(
      selectBackgroundHooksSnapshotDelivered.select({ backgroundHooks: initialState }, 'ws-1'),
    ).toBe(false);
    const state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', []));
    expect(selectBackgroundHooksSnapshotDelivered.select({ backgroundHooks: state }, 'ws-1')).toBe(
      true,
    );
  });

  it('selectBackgroundHooksSnapshotDelivered stays latched after the entry is marked stale', () => {
    let state = backgroundHooksReducer(initialState, backgroundHooksUpdated('ws-1', [makeHook()]));
    state = backgroundHooksReducer(state, backgroundHooksMarkedStale('ws-1'));
    expect(selectBackgroundHooksSnapshotDelivered.select({ backgroundHooks: state }, 'ws-1')).toBe(
      true,
    );
  });
});
