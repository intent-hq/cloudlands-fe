import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  discoverLocalReposRequested,
  initialState,
  knownReposReducer,
  onboardingPickerClosed,
  onboardingPickerOpened,
} from '../known-repos-slice';
import { localRepoDiscoverySaga } from './local-repo-discovery-saga';

const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  const channel = stdChannel();
  let knownRepos = initialState;
  let backendId = 'local';
  const send = (action: Parameters<typeof knownReposReducer>[1]) => {
    knownRepos = knownReposReducer(knownRepos, action);
    channel.put(action);
  };
  tasks.push(
    runSaga(
      {
        channel,
        dispatch: send,
        getState: () => ({ knownRepos, connections: { windowBackendId: backendId } }),
      },
      localRepoDiscoverySaga,
    ),
  );
  return {
    send,
    state: () => knownRepos.discovery,
    switchBackend: (id: string) => {
      backendId = id;
      send(connectionsListReceived({ connections: [], activeId: id, windowBackendId: id }));
    },
  };
}
const home = {
  path: '/home/dev',
  parent: '/home',
  home: '/home/dev',
  entries: [],
  favorites: [{ id: 'home', path: '/home/dev' }],
};
function mockBackend(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    'repo.list': { repos: [] },
    'workspace.list': { workspaces: [] },
    'host.listDirectory': home,
    'workspace.findRepositories': { repositories: ['/home/dev/code/app'] },
    ...overrides,
  };
  mocks.request.mockImplementation((method: string) => {
    const response = responses[method];
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  });
}
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.resetAllMocks();
});

describe('onboarding local repository discovery', () => {
  it('loads recents first, then sends the exact home lookup and bounded scanner request', async () => {
    const registry = deferred<{ repos: [] }>();
    mockBackend({ 'repo.list': registry.promise });
    const run = harness();
    run.send(onboardingPickerOpened(true));
    await settle();
    expect(mocks.request.mock.calls).toEqual([
      ['repo.list', {}],
      ['workspace.list', { includeArchived: true }],
    ]);
    expect(run.state().status).toBe('loading');
    registry.resolve({ repos: [] });
    await settle();
    expect(mocks.request.mock.calls).toEqual([
      ['repo.list', {}],
      ['workspace.list', { includeArchived: true }],
      ['host.listDirectory', {}],
      ['workspace.findRepositories', { directory: '/home/dev' }],
    ]);
    expect(run.state().status).toBe('complete');
    expect(getItems(run.state().repos)).toEqual([{ path: '/home/dev/code/app', name: 'app' }]);
  });

  it.each([
    { 'repo.list': { repos: [{ path: '/home/dev/existing', name: 'existing' }] } },
    {
      'workspace.list': {
        workspaces: [
          {
            repositoryPath: '/home/dev/existing',
            worktreePath: '/ws/one',
            repositoryName: 'existing',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    },
  ])('does not scan when hydrated data contains a usable local repo: %o', async (response) => {
    mockBackend(response);
    const run = harness();
    run.send(onboardingPickerOpened(true));
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(run.state().status).toBe('complete');
    expect(getItems(run.state().repos)[0].path).toBe('/home/dev/existing');
  });

  it('ignores GitHub-only and owned repos, deduplicates scan results, and retains exclusions', async () => {
    mockBackend({
      'repo.list': {
        repos: [
          { path: 'org/repo', githubUrl: 'https://github.com/org/repo' },
          { path: '/ws/.clones/old' },
        ],
      },
      'workspace.list': {
        workspaces: [
          {
            repositoryPath: '/ws/owned',
            worktreePath: '/ws/owned',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
      'workspace.findRepositories': {
        repositories: ['/home/dev/app', '/home/dev/app', '/ws/owned', '/ws/.repo-cache/internal'],
      },
    });
    const run = harness();
    run.send(onboardingPickerOpened(true));
    await settle();
    expect(getItems(run.state().repos)).toEqual([{ path: '/home/dev/app', name: 'app' }]);
  });

  it('does not scan the GitHub tab and does not repeat a scan on local-tab remounts', async () => {
    const scan = deferred<{ repositories: string[] }>();
    mockBackend({ 'workspace.findRepositories': scan.promise });
    const run = harness();
    run.send(onboardingPickerOpened(false));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    run.send(discoverLocalReposRequested());
    await settle();
    run.send(discoverLocalReposRequested());
    scan.resolve({ repositories: [] });
    await settle();
    run.send(discoverLocalReposRequested());
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(4);
    expect(run.state().status).toBe('complete');
  });

  it.each(['repo.list', 'workspace.list', 'host.listDirectory', 'workspace.findRepositories'])(
    'settles %s failure without retrying or treating a failed read as empty',
    async (method) => {
      mockBackend({ [method]: new Error('unavailable') });
      const run = harness();
      run.send(onboardingPickerOpened(true));
      await settle();
      expect(run.state().status).toBe('error');
      const count = mocks.request.mock.calls.length;
      run.send(discoverLocalReposRequested());
      await settle();
      expect(mocks.request).toHaveBeenCalledTimes(count);
      if (method !== 'workspace.findRepositories')
        expect(mocks.request.mock.calls.some(([m]) => m === 'workspace.findRepositories')).toBe(
          false,
        );
    },
  );

  it.each([
    { 'repo.list': undefined },
    { 'repo.list': { repos: null } },
    { 'workspace.list': undefined },
    { 'workspace.list': { workspaces: {} } },
  ])('does not infer an empty list from a malformed preflight: %o', async (response) => {
    mockBackend(response);
    const run = harness();
    run.send(onboardingPickerOpened(true));
    await settle();
    expect(run.state().status).toBe('error');
    expect(mocks.request.mock.calls).toEqual([
      ['repo.list', {}],
      ['workspace.list', { includeArchived: true }],
    ]);
  });

  it.each(['', '/', '\\', 'C:\\', 'C:/', 'C:'])(
    'never scans an unavailable or filesystem-root home: %s',
    async (homePath) => {
      mockBackend({ 'host.listDirectory': { ...home, home: homePath } });
      const run = harness();
      run.send(onboardingPickerOpened(true));
      await settle();
      expect(run.state().status).toBe('error');
      expect(mocks.request).toHaveBeenCalledTimes(3);
    },
  );

  it('does not begin scanning if the picker closes during preflight', async () => {
    const registry = deferred<{ repos: [] }>();
    mockBackend({ 'repo.list': registry.promise });
    const run = harness();
    run.send(onboardingPickerOpened(true));
    await settle();
    run.send(onboardingPickerClosed());
    registry.resolve({ repos: [] });
    await settle();
    expect(run.state().status).toBe('idle');
    expect(mocks.request.mock.calls).toEqual([
      ['repo.list', {}],
      ['workspace.list', { includeArchived: true }],
    ]);
  });

  it('discards a late result after closing and permits a new picker session', async () => {
    const scan = deferred<{ repositories: string[] }>();
    mockBackend({ 'workspace.findRepositories': scan.promise });
    const run = harness();
    run.send(onboardingPickerOpened(true));
    await settle();
    run.send(onboardingPickerClosed());
    scan.resolve({ repositories: ['/home/dev/stale'] });
    await settle();
    expect(run.state().status).toBe('idle');
    mockBackend();
    run.send(onboardingPickerOpened(true));
    await settle();
    expect(getItems(run.state().repos)[0].path).toBe('/home/dev/code/app');
  });

  it('cancels stale work on backend changes but not connection updates for the same backend', async () => {
    const old = deferred<{ repositories: string[] }>();
    mockBackend({ 'workspace.findRepositories': old.promise });
    const run = harness();
    run.send(onboardingPickerOpened(true));
    await settle();
    run.switchBackend('local');
    expect(mocks.request).toHaveBeenCalledTimes(4);
    mockBackend({
      'host.listDirectory': { ...home, home: '/home/remote' },
      'workspace.findRepositories': { repositories: ['/home/remote/repo'] },
    });
    run.switchBackend('remote');
    await settle();
    old.resolve({ repositories: ['/home/dev/stale'] });
    await settle();
    expect(run.state().backendId).toBe('remote');
    expect(getItems(run.state().repos)).toEqual([{ path: '/home/remote/repo', name: 'repo' }]);
    expect(mocks.request).toHaveBeenLastCalledWith('workspace.findRepositories', {
      directory: '/home/remote',
    });
  });
});
