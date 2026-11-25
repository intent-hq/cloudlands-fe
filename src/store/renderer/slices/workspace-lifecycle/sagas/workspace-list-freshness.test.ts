import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { store } from '../../../store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  ensureWorkspacesLoaded,
  loadWorkspacesRequested,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../workspace/workspace-slice';
import { backendReconnected } from '../workspace-lifecycle-slice';
import type { Workspace } from '$shared/types';

const mock = vi.hoisted(() => ({ list: vi.fn(), recent: vi.fn(async () => ({})) }));
vi.mock('../../workspace/utils/workspace.client', () => ({ workspaceClient: { list: mock.list } }));
vi.mock('$lib/client', () => ({ appClient: { workspaces: { recentViews: mock.recent } } }));
vi.mock('../../workspace-share/sagas/workspace-share-saga', () => ({
  refreshIntegrationAuthAfterReconnect: vi.fn(),
}));
import { lifecycleReadSaga } from './lifecycle-read-saga';

const row = { id: 'ws-1', title: 'one', myRole: 'owner' } as Workspace;
let dispose: () => void, task: Task, channel: ReturnType<typeof stdChannel>;
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function dispatch(a: Parameters<typeof store.dispatch>[0]) {
  store.dispatch(a);
  channel.put(a);
}
function deferredList() {
  let resolve!: (x: unknown) => void;
  mock.list.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  return () => resolve({ ok: true, data: [row], complete: true });
}
function markLoadedForCurrentAdmission() {
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.list.mockResolvedValue({ ok: true, data: [row], complete: true });
  dispose = store.init();
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity(row));
  channel = stdChannel();
  task = runSaga({ channel, dispatch, getState: () => store.state }, lifecycleReadSaga);
});
afterEach(async () => {
  task.cancel();
  await task.toPromise();
  dispose();
});

describe('workspace list freshness', () => {
  it('does not reread a list already loaded for the current admission', async () => {
    markLoadedForCurrentAdmission();
    dispatch(ensureWorkspacesLoaded());
    dispatch(ensureWorkspacesLoaded());
    await settle();
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('shares one read between startup triggers that arrive while it is in flight', async () => {
    const resolve = deferredList();
    dispatch(ensureWorkspacesLoaded());
    await settle();
    dispatch(ensureWorkspacesLoaded());
    dispatch(ensureWorkspacesLoaded());
    resolve();
    await settle();
    expect(mock.list).toHaveBeenCalledTimes(1);
  });

  it('reads again once the admission changes', async () => {
    markLoadedForCurrentAdmission();
    const before = selectPrincipalActionContext.select(store.state);
    store.dispatch(daemonEventsSubscribed());
    admitLegacyPrincipal();
    expect(selectPrincipalActionContext.select(store.state)).not.toBe(before);
    dispatch(ensureWorkspacesLoaded());
    await settle();
    expect(mock.list).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit refresh request authoritative', async () => {
    markLoadedForCurrentAdmission();
    dispatch(loadWorkspacesRequested());
    await settle();
    expect(mock.list).toHaveBeenCalledTimes(1);
  });

  it('a reconnect under the same admission does not reread a current list', async () => {
    markLoadedForCurrentAdmission();
    dispatch(backendReconnected());
    await settle();
    expect(mock.list).not.toHaveBeenCalled();
  });
});
