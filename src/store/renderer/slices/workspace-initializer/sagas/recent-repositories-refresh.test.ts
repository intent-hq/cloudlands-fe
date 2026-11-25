import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';

const mock = vi.hoisted(() => ({ list: vi.fn(), invoke: vi.fn(), originUrl: vi.fn() }));
vi.mock('../../workspace/utils/workspace.client', () => ({ workspaceClient: { list: mock.list } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mock.invoke }));
vi.mock('$lib/client', () => ({ appClient: {} }));

import { store } from '../../../store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { replaceWorkspaceList, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { workspaceInitializerRecentReposRefreshRequested } from '../workspace-initializer-slice';
import { selectWorkspaceInitializerRecentRepoRefresh } from '../workspace-initializer-selectors';
import { workspaceInitializerRepositorySaga } from './workspace-initializer-repository-saga';

const rows = [
  { id: 'a', title: 'a', repositoryPath: '/repos/a', updatedAt: '2026-11-01T00:00:00Z' },
  { id: 'b', title: 'b', repositoryPath: '/repos/b', updatedAt: '2026-11-02T00:00:00Z' },
] as Workspace[];
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
let dispose: () => void;
let stop: () => void;

function refresh(id = 'picker') {
  store.dispatch(
    workspaceInitializerRecentReposRefreshRequested(
      id,
      crypto.randomUUID(),
      selectPrincipalActionContext.select(store.state)!,
    ),
  );
}
function loadListForCurrentAdmission() {
  store.dispatch(replaceWorkspaceList(rows));
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
}
function readmit() {
  store.dispatch(daemonEventsSubscribed());
  admitLegacyPrincipal();
}

beforeEach(() => {
  vi.clearAllMocks();
  dispose = store.init();
  admitLegacyPrincipal();
  mock.list.mockResolvedValue({ ok: true, data: rows, complete: true });
  mock.invoke.mockResolvedValue({ success: true, data: [] });
  mock.originUrl.mockImplementation(async (path: string) =>
    path === '/repos/b' ? null : 'https://github.com/owner/a.git',
  );
  stop = store.runSaga(function* () {
    yield* workspaceInitializerRepositorySaga({ git: { originUrl: mock.originUrl } });
  });
});
afterEach(() => {
  stop();
  dispose();
});

describe('recent repositories refresh', () => {
  it('uses the loaded workspace list instead of reading it again', async () => {
    loadListForCurrentAdmission();
    refresh();
    await settle();
    expect(mock.list).not.toHaveBeenCalled();
    const entry = selectWorkspaceInitializerRecentRepoRefresh.select(store.state, 'picker');
    expect(entry?.status).toBe('ready');
    expect(entry?.workspaces.map((w) => w.id).sort()).toEqual(['a', 'b']);
  });

  it('reads the list when it is not loaded for the current admission', async () => {
    refresh();
    await settle();
    expect(mock.list.mock.calls).toEqual([[{ lite: true }]]);
  });

  it('reads a known origin once across picker opens, but retries a missing one', async () => {
    loadListForCurrentAdmission();
    refresh();
    await settle();
    refresh();
    await settle();
    refresh('palette');
    await settle();
    expect(mock.originUrl.mock.calls.map(([path]) => path).sort()).toEqual([
      '/repos/a',
      '/repos/b',
      '/repos/b',
      '/repos/b',
    ]);
  });

  it('reads origins again after the admission changes', async () => {
    loadListForCurrentAdmission();
    refresh();
    await settle();
    readmit();
    loadListForCurrentAdmission();
    refresh();
    await settle();
    expect(mock.originUrl).toHaveBeenCalledTimes(4);
  });
});
