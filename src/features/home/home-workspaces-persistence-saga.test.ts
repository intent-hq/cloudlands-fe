import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), failWrite: false }));
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getItem: (key: string) => mocks.values.get(key) ?? null,
    getJSON: (key: string) => {
      const value = mocks.values.get(key);
      return value ? JSON.parse(value) : undefined;
    },
    setItem: (key: string, value: string) => {
      if (!mocks.failWrite) mocks.values.set(key, value);
    },
  },
}));
vi.mock('./home-workspaces-selectors', () => ({
  selectHomeWorkspaceView: { select: (state: any) => state.homeWorkspaces },
  selectHomePersistenceScope: { select: (state: any) => state.scope },
}));
import { homeWorkspacePersistenceSaga } from './home-workspaces-saga';
import { homeWorkspacesReducer, updateHomeWorkspaceView } from './home-workspaces-slice';
import { homePersistenceKey } from './home-workspaces-persistence';

// Failure cases: update before identity known; first hydration overwriting storage;
// changing accounts saving prior data under new key; legacy fields leaking into configuration;
// blocked storage terminating watchers; ephemeral image actions writing payloads.
function harness(scope: string | null) {
  const channel = stdChannel();
  let state = { scope, homeWorkspaces: homeWorkspacesReducer(undefined, { type: 'init' } as any) };
  const dispatch = (action: any) => {
    state = { ...state, homeWorkspaces: homeWorkspacesReducer(state.homeWorkspaces, action) };
    channel.put(action);
  };
  const task = runSaga({ channel, getState: () => state, dispatch }, homeWorkspacePersistenceSaga);
  return {
    task,
    dispatch,
    state: () => state,
    scope: (scope: string | null) => {
      state = { ...state, scope };
      dispatch({ type: 'principal/received' });
    },
  };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => {
  mocks.values.clear();
  mocks.failWrite = false;
});
describe('Home persistence behavior', () => {
  it('restores on reload and isolates backend/account changes', async () => {
    const alice = homePersistenceKey('one', 'alice'),
      bob = homePersistenceKey('one', 'bob');
    const first = harness(alice);
    first.dispatch(
      updateHomeWorkspaceView({
        view: 'board',
        query: 'alice',
        integrationViews: {
          prs: { query: 'Alice PRs', filter: 'created', closed: true },
          linear: { query: 'Alice bugs', filter: 'assigned', closed: false },
        },
        selectedId: 'ephemeral',
      }),
    );
    await settle();
    first.task.cancel();
    expect(mocks.values.get(alice)).not.toContain('blob:private');
    const second = harness(alice);
    await settle();
    expect(second.state().homeWorkspaces).toMatchObject({
      view: 'board',
      query: 'alice',
      selectedId: null,
    });
    second.scope(bob);
    await settle();
    expect(second.state().homeWorkspaces.query).toBe('');
    expect(second.state().homeWorkspaces.integrationViews.prs.query).toBe('');
    second.dispatch(updateHomeWorkspaceView({ query: 'bob' }));
    await settle();
    second.scope(alice);
    await settle();
    expect(second.state().homeWorkspaces.query).toBe('alice');
    expect(second.state().homeWorkspaces.integrationViews.prs).toEqual({
      query: 'Alice PRs',
      filter: 'created',
      closed: true,
    });
    expect(JSON.parse(mocks.values.get(bob)!).configuration.query).toBe('bob');
    second.task.cancel();
  });
  it('waits for confirmed scope and recovers from failed writes', async () => {
    const run = harness(null);
    run.dispatch(updateHomeWorkspaceView({ query: 'unscoped' }));
    await settle();
    expect(mocks.values.size).toBe(0);
    const key = homePersistenceKey('one', 'alice');
    run.scope(key);
    await settle();
    mocks.failWrite = true;
    run.dispatch(updateHomeWorkspaceView({ query: 'retry' }));
    await settle();
    expect(run.state().homeWorkspaces.persistenceError).toBe(true);
    mocks.failWrite = false;
    run.dispatch(updateHomeWorkspaceView({ query: 'recovered' }));
    await settle();
    expect(run.state().homeWorkspaces.persistenceError).toBe(false);
    expect(JSON.parse(mocks.values.get(key)!).configuration.query).toBe('recovered');
    run.task.cancel();
  });
});
