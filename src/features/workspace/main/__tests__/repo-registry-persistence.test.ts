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

  it('addRepo pushes the updated list via settings.update', async () => {
    const { initRepoRegistry, addRepo } = await import('../repo-registry');
    await initRepoRegistry();
    requestMock.mockClear();
    addRepo({ path: '/b', name: 'b' });
    await flush();
    expect(requestMock).toHaveBeenCalledWith(
      'settings.update',
      expect.objectContaining({ path: 'repos.known' }),
    );
    const [, body] = requestMock.mock.calls[0];
    const payload = body as { value: unknown[] };
    expect(payload.value).toHaveLength(1);
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
    expect(requestMock).toHaveBeenCalledWith(
      'settings.update',
      expect.objectContaining({ path: 'repos.known' }),
    );
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
      path: 'repos.known',
      value: [],
    });
  });
});
