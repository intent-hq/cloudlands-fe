import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import {
  gitReducer,
  gitReadRequested,
  releaseGitRead,
  gitReadsInvalidated,
} from '../../../../../../src/store/renderer/slices/git/git-slice';
import { getGitRead } from '../../../../../../src/store/renderer/slices/git/git-read-projections';
import { gitConsumerReadSaga } from './git-consumer-read-saga';

const ports = vi.hoisted(() => ({ request: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: ports.request }));
vi.mock('../../index', () => ({ store: { dispatch: ports.dispatch } }));
const tasks: ReturnType<typeof runSaga>[] = [];
function start() {
  const channel = stdChannel();
  let git = gitReducer(undefined, { type: 'test/init' });
  const dispatch = (action: Parameters<typeof gitReducer>[1]) => {
    git = gitReducer(git, action);
    channel.put(action);
  };
  ports.dispatch.mockImplementation(dispatch);
  const task = runSaga({ channel, dispatch }, gitConsumerReadSaga);
  tasks.push(task);
  return { dispatch, view: () => getGitRead({ git }, 'ws', 'view') };
}
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.resetAllMocks();
});
describe('React canonical Git read binding', () => {
  it('keeps errors distinct from empty and refresh retries the exact root, path and stage', async () => {
    ports.request.mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValueOnce([]);
    const owner = start();
    owner.dispatch(
      gitReadRequested(
        'ws',
        'view',
        'one',
        { kind: 'diffs', path: 'deleted.txt', staged: true, gitRootId: 'root' },
        () => true,
      ),
    );
    await vi.waitFor(() => expect(owner.view()?.error).toBe('read unavailable'));
    owner.dispatch(gitReadsInvalidated('ws', 'root'));
    await vi.waitFor(() =>
      expect(owner.view()).toMatchObject({
        loading: false,
        error: null,
        result: { kind: 'diffs', chunks: [] },
      }),
    );
    expect(ports.request.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      Array(2).fill([
        'git.diffs',
        { workspaceId: 'ws', path: 'deleted.txt', staged: true, gitRootId: 'root' },
      ]),
    );
    owner.dispatch(releaseGitRead('ws', 'view', 'one'));
    expect(owner.view()).toBeUndefined();
  });
  it('checks authority again at final dispatch and never publishes a retired late response', async () => {
    let admitted = true;
    let finalDispatch: () => void = () => {};
    let resolve!: (value: unknown) => void;
    ports.request.mockImplementation((_method, _params, options) => {
      finalDispatch = options.onDispatch;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const owner = start();
    owner.dispatch(
      gitReadRequested(
        'ws',
        'view',
        'one',
        { kind: 'diffs', path: 'a.txt', staged: false },
        () => admitted,
      ),
    );
    expect(ports.request).toHaveBeenCalledTimes(1);
    admitted = false;
    expect(finalDispatch).toThrow('Git read retired');
    owner.dispatch(releaseGitRead('ws', 'view', 'one'));
    resolve([{ path: 'a.txt', hunks: [] }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(owner.view()).toBeUndefined();
  });
});
