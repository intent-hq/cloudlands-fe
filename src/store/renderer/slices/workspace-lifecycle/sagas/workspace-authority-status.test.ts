import { afterEach, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createWorkspaceAuthoritySaga } from './workspace-authority-saga-factory';
import { workspaceReducer, loadWorkspacesRequested } from '../../workspace/workspace-slice';
const changeContext = createAction<[string | null]>('listStatusTest/context');
const contextReducer = createReducer({ value: 'a' as string | null });
contextReducer.with(changeContext, (_state, { payload: [value] }) => ({ value }));
const stops: (() => void)[] = [];
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.restoreAllMocks();
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function fixture() {
  const store = new ReactStore({ workspace: workspaceReducer, context: contextReducer });
  stops.push(store.init());
  const pending: {
    resolve: (v: { ok: true; data: []; complete: true }) => void;
    reject: (e: Error) => void;
  }[] = [];
  const context = store.createSelector((state) => state.context.value),
    backend = store.createSelector(() => 'local'),
    tokens = store.createSelector((state) => state.workspace.deletionTokens),
    loaded = store.createSelector((_state, _backend: string) => false);
  const read = vi.fn(
    () =>
      new Promise<{ ok: true; data: []; complete: true }>((resolve, reject) =>
        pending.push({ resolve, reject }),
      ),
  );
  stops.push(
    store.runSaga(
      createWorkspaceAuthoritySaga({
        dispatchIdentity: () => store.dispatch,
        backendIdEffect: backend.effect,
        principalContextEffect: context.effect,
        deletionTokensEffect: tokens.effect,
        listLoadedEffect: loaded.effect,
        listWorkspaces: read,
      }),
    ),
  );
  return { store, pending, read };
}
it('publishes failure and deliberate retry through the existing single-flight owner', async () => {
  const { store, pending, read } = fixture();
  store.dispatch(loadWorkspacesRequested());
  await settle();
  expect(store.state.workspace.listReadStatus).toEqual({ context: 'a', status: 'loading' });
  pending[0].reject(new Error('Forbidden'));
  await settle();
  expect(store.state.workspace.listReadStatus).toEqual({ context: 'a', status: 'error' });
  store.dispatch(loadWorkspacesRequested());
  await settle();
  expect(read).toHaveBeenCalledTimes(2);
  pending[1].resolve({ ok: true, data: [], complete: true });
  await settle();
  expect(store.state.workspace.listReadStatus).toEqual({ context: 'a', status: 'ready' });
  expect(store.state.workspace.hasLoaded).toBe(true);
});
it.each(['resolve', 'reject'] as const)(
  'does not publish a retired principal completion: %s',
  async (outcome) => {
    const { store, pending } = fixture();
    store.dispatch(loadWorkspacesRequested());
    await settle();
    store.dispatch(changeContext('b'));
    if (outcome === 'resolve') pending[0].resolve({ ok: true, data: [], complete: true });
    else pending[0].reject(new Error('Forbidden'));
    await settle();
    expect(store.state.workspace.listReadStatus).toEqual({ context: 'a', status: 'loading' });
    expect(store.state.workspace.hasLoaded).toBe(false);
    store.dispatch(loadWorkspacesRequested());
    await settle();
    pending[1].resolve({ ok: true, data: [], complete: true });
    await settle();
    expect(store.state.workspace.listReadStatus).toEqual({ context: 'b', status: 'ready' });
  },
);
