import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the repo-registry rewire (PROTOCOL.md §5.12).
 * The legacy `repo-registry` electron-store is retired; the registry now
 * reads/writes the daemon-owned `repos.known` setting via `settings.get` /
 * `settings.update`, with an in-memory cache backing the sync API surface.
 */

const requestMock = vi.hoisted(() => vi.fn(async () => ({ path: 'repos.known', value: [] })));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('repo-registry ↔ daemon settings.* (PROTOCOL.md §5.12)', () => {
  beforeEach(async () => {
    requestMock.mockClear();
    requestMock.mockImplementation(async () => ({ path: 'repos.known', value: [] }));
    vi.resetModules();
    const mod = await import('../repo-registry');
    mod.__resetRepoRegistryForTesting();
  });

  it('initRepoRegistry hydrates the cache from settings.get', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'repos.known',
      value: [{ path: '/a', name: 'a', addedAt: 't', lastUsedAt: 't' }],
    });
    const { initRepoRegistry, getAllRepos } = await import('../repo-registry');
    await initRepoRegistry();
    expect(requestMock).toHaveBeenCalledWith('settings.get', { path: 'repos.known' });
    expect(getAllRepos()).toHaveLength(1);
    expect(getAllRepos()[0].path).toBe('/a');
  });

  it('addRepo pushes the updated list via settings.update { changes: [...] }', async () => {
    const { initRepoRegistry, addRepo } = await import('../repo-registry');
    await initRepoRegistry();
    requestMock.mockClear();
    addRepo({ path: '/b', name: 'b' });
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [method, params] = requestMock.mock.calls[0];
    expect(method).toBe('settings.update');
    const body = params as { changes: { path: string; value: unknown[] }[] };
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0].path).toBe('repos.known');
    expect(body.changes[0].value).toHaveLength(1);
  });

  it('addRepo persists a path-less GitHub pick (githubUrl + owner/repo shorthand key)', async () => {
    const { initRepoRegistry, addRepo, getAllRepos } = await import('../repo-registry');
    await initRepoRegistry();
    requestMock.mockClear();
    addRepo({
      path: 'acme/widget',
      name: 'widget',
      owner: 'acme',
      githubUrl: 'https://github.com/acme/widget',
    });
    await flush();
    const repos = getAllRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      path: 'acme/widget',
      name: 'widget',
      owner: 'acme',
      githubUrl: 'https://github.com/acme/widget',
    });
    const [method, params] = requestMock.mock.calls[0];
    expect(method).toBe('settings.update');
    const body = params as { changes: { path: string; value: unknown[] }[] };
    expect(body.changes[0].value[0]).toMatchObject({
      githubUrl: 'https://github.com/acme/widget',
    });
  });

  it('addRepo keeps an existing githubUrl when re-adding without one', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'repos.known',
      value: [
        {
          path: 'acme/widget',
          name: 'widget',
          githubUrl: 'https://github.com/acme/widget',
          addedAt: 't',
          lastUsedAt: 't',
        },
      ],
    });
    const { initRepoRegistry, addRepo, getAllRepos } = await import('../repo-registry');
    await initRepoRegistry();
    addRepo({ path: 'acme/widget', name: 'widget' });
    expect(getAllRepos()[0].githubUrl).toBe('https://github.com/acme/widget');
  });

  it('removeRepo pushes the updated list when a repo is removed', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'repos.known',
      value: [{ path: '/a', name: 'a', addedAt: 't', lastUsedAt: 't' }],
    });
    const { initRepoRegistry, removeRepo } = await import('../repo-registry');
    await initRepoRegistry();
    requestMock.mockClear();
    expect(removeRepo('/a')).toBe(true);
    await flush();
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'repos.known', value: [] }],
    });
  });

  it('clearRepos pushes an empty list', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'repos.known',
      value: [{ path: '/a', name: 'a', addedAt: 't', lastUsedAt: 't' }],
    });
    const { initRepoRegistry, clearRepos, getAllRepos } = await import('../repo-registry');
    await initRepoRegistry();
    requestMock.mockClear();
    clearRepos();
    await flush();
    expect(getAllRepos()).toHaveLength(0);
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'repos.known', value: [] }],
    });
  });

  it('pushes exactly the { changes: [{ path, value }] } wire shape (regression for B1)', async () => {
    const { initRepoRegistry, addRepo } = await import('../repo-registry');
    await initRepoRegistry();
    requestMock.mockClear();
    addRepo({ path: '/c', name: 'c', owner: 'me' });
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [method, params] = requestMock.mock.calls[0];
    expect(method).toBe('settings.update');
    // Top-level params MUST be { changes: [...] } — never { path, value }.
    expect(params).toHaveProperty('changes');
    expect(params).not.toHaveProperty('path');
    expect(params).not.toHaveProperty('value');
    const body = params as { changes: { path: string; value: unknown }[] };
    expect(Array.isArray(body.changes)).toBe(true);
    expect(body.changes[0]).toMatchObject({ path: 'repos.known' });
    expect(Array.isArray(body.changes[0].value)).toBe(true);
  });

  it('logs push failures so daemon RPC errors (e.g. -32602) are visible', async () => {
    const errorSpy = vi.fn();
    vi.doMock('../../../../shared/logger', () => ({
      Logger: class {
        info() {}
        warn() {}
        debug() {}
        error = errorSpy;
      },
    }));
    vi.resetModules();
    const { initRepoRegistry, addRepo, __resetRepoRegistryForTesting } = await import(
      '../repo-registry'
    );
    __resetRepoRegistryForTesting();
    await initRepoRegistry();
    requestMock.mockClear();
    const rpcError = Object.assign(new Error('invalid params'), { code: -32602 });
    requestMock.mockRejectedValueOnce(rpcError);
    addRepo({ path: '/d', name: 'd' });
    await flush();
    await flush();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist repos on daemon'),
      rpcError,
    );
    vi.doUnmock('../../../../shared/logger');
  });
});
