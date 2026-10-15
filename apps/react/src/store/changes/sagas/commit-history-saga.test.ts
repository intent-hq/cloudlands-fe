import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import {
  fileTrackingReducer as changesReducer,
  refreshRequested,
  loadMoreCommitsRequested,
  loadOlderCommitsRequested,
} from '../../../../../../src/store/renderer/slices/changes/changes-slice';
import {
  getCommitHistory,
  getCurrentCommits,
  getOlderCommits,
} from '../../../../../../src/store/renderer/slices/changes/changes-projections';
import { workspaceUnmounted } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { commitHistorySaga } from './commit-history-saga';

const ports = vi.hoisted(() => ({
  request: vi.fn(),
  context: 'owner' as string | null,
  state: {},
}));
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: ports.request }));
vi.mock('../../index', () => ({
  store: {
    get state() {
      return ports.state;
    },
  },
}));
vi.mock('../../workspace-lifecycle/workspace-lifecycle-selectors', () => ({
  selectAdmittedWorkspaceReadContext: {
    effect: function* () {
      yield;
      return ports.context;
    },
    select: () => ports.context,
  },
}));
const tasks: ReturnType<typeof runSaga>[] = [];
const hash = (n: string) => n.repeat(40);
const page = (ids: string[], nextToken: string | null = null) => ({
  commits: ids.map((id) => ({
    hash: hash(id),
    message: id,
    author: 'Fixture',
    date: '2026-10-15T00:00:00Z',
    isPushed: false,
    files: [],
  })),
  boundarySha: hash('f'),
  nextToken,
});
function start() {
  let changes = changesReducer(undefined, { type: 'test/init' });
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof changesReducer>[1]) => {
    changes = changesReducer(changes, action);
    ports.state = { changes };
    channel.put(action);
  };
  ports.state = { changes };
  const task = runSaga({ channel, dispatch, getState: () => ({ changes }) }, commitHistorySaga);
  tasks.push(task);
  return {
    dispatch,
    history: () => getCommitHistory({ changes }, 'ws'),
    current: () => getCurrentCommits({ changes }, 'ws'),
    older: () => getOlderCommits({ changes }, 'ws'),
  };
}
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.resetAllMocks();
  ports.context = 'owner';
});
it('uses actual nextToken wire paging and keeps independent older membership in canonical state', async () => {
  ports.request
    .mockResolvedValueOnce(page(['a'], 'cursor'))
    .mockResolvedValueOnce(page(['b']))
    .mockResolvedValueOnce(page(['f']));
  const owner = start();
  owner.dispatch(refreshRequested('ws'));
  await vi.waitFor(() => expect(owner.current().map((c) => c.hash)).toEqual([hash('a')]));
  owner.dispatch(loadMoreCommitsRequested('ws'));
  await vi.waitFor(() =>
    expect(owner.current().map((c) => c.hash)).toEqual([hash('a'), hash('b')]),
  );
  owner.dispatch(loadOlderCommitsRequested('ws', hash('f'), 20));
  await vi.waitFor(() => expect(owner.older().map((c) => c.hash)).toEqual([hash('f')]));
  expect(ports.request.mock.calls.map((c) => c.slice(0, 2))).toEqual([
    ['file-tracking.loadCommits', { workspaceId: 'ws', includeOlder: false, limit: 20 }],
    [
      'file-tracking.loadCommits',
      { workspaceId: 'ws', includeOlder: false, limit: 20, nextToken: 'cursor' },
    ],
    ['file-tracking.loadCommits', { workspaceId: 'ws', includeOlder: true, limit: 20 }],
  ]);
});
it('keeps failure distinct from empty and refresh can recover without a write', async () => {
  ports.request.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(page([]));
  const owner = start();
  owner.dispatch(refreshRequested('ws'));
  await vi.waitFor(() => expect(owner.history().current.error).toBe('unavailable'));
  expect(owner.history().current.loaded).toBe(false);
  owner.dispatch(refreshRequested('ws'));
  await vi.waitFor(() =>
    expect(owner.history().current).toMatchObject({ loaded: true, error: null, loading: false }),
  );
  expect(owner.current()).toEqual([]);
});
it('fences delayed transport and publication after authority loss or workspace departure', async () => {
  let complete!: (v: unknown) => void;
  let dispatch!: () => void;
  ports.request.mockImplementation((_m, _p, options) => {
    dispatch = options.onDispatch;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const owner = start();
  owner.dispatch(refreshRequested('ws'));
  expect(ports.request).toHaveBeenCalledTimes(1);
  ports.context = 'replacement';
  expect(dispatch).toThrow('Commit history read retired');
  owner.dispatch(workspaceUnmounted('ws'));
  complete(page(['a']));
  await Promise.resolve();
  await Promise.resolve();
  expect(owner.current()).toEqual([]);
  expect(owner.history().context).toBeNull();
});
