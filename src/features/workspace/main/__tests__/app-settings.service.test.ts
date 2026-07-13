import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestSpy, loggerSpies } = vi.hoisted(() => ({
  requestSpy: vi.fn(),
  loggerSpies: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestSpy }),
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

describe('app-settings.service (daemon-backed hydration cache)', () => {
  beforeEach(async () => {
    vi.resetModules();
    requestSpy.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
  });

  it('sync getters return "" before hydration completes', async () => {
    const { getBranchPrefix, getWorktreesLocation, getSshKeyPath } = await import(
      '../app-settings.service'
    );
    expect(getBranchPrefix()).toBe('');
    expect(getWorktreesLocation()).toBe('');
    expect(getSshKeyPath()).toBe('');
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('initAppSettingsService fetches the three daemon paths via settings.get', async () => {
    requestSpy.mockImplementation(async (_method: string, params: { path: string }) => {
      switch (params.path) {
        case 'workspace.branchPrefix':
          return { path: params.path, value: 'feature/' };
        case 'workspace.worktreesLocation':
          return { path: params.path, value: '/tmp/wt' };
        case 'workspace.sshKeyPath':
          return { path: params.path, value: '/home/me/.ssh/id_ed25519' };
        default:
          throw new Error(`unexpected path ${params.path}`);
      }
    });

    const {
      initAppSettingsService,
      getBranchPrefix,
      getWorktreesLocation,
      getSshKeyPath,
    } = await import('../app-settings.service');

    await initAppSettingsService();

    // Assert the exact wire calls per PROTOCOL.md §5.12 settings.get.
    expect(requestSpy).toHaveBeenCalledTimes(3);
    expect(requestSpy).toHaveBeenCalledWith('settings.get', { path: 'workspace.branchPrefix' });
    expect(requestSpy).toHaveBeenCalledWith('settings.get', {
      path: 'workspace.worktreesLocation',
    });
    expect(requestSpy).toHaveBeenCalledWith('settings.get', { path: 'workspace.sshKeyPath' });

    expect(getBranchPrefix()).toBe('feature/');
    expect(getWorktreesLocation()).toBe('/tmp/wt');
    expect(getSshKeyPath()).toBe('/home/me/.ssh/id_ed25519');
  });

  it('missing / non-string daemon values fall back to ""', async () => {
    requestSpy.mockImplementation(async (_method: string, params: { path: string }) => {
      if (params.path === 'workspace.branchPrefix') return { path: params.path, value: null };
      if (params.path === 'workspace.worktreesLocation') return { path: params.path };
      return { path: params.path, value: 42 };
    });

    const {
      initAppSettingsService,
      getBranchPrefix,
      getWorktreesLocation,
      getSshKeyPath,
    } = await import('../app-settings.service');

    await initAppSettingsService();

    expect(getBranchPrefix()).toBe('');
    expect(getWorktreesLocation()).toBe('');
    expect(getSshKeyPath()).toBe('');
  });

  it('daemon errors per-path degrade to "" without failing hydration', async () => {
    requestSpy.mockImplementation(async (_method: string, params: { path: string }) => {
      if (params.path === 'workspace.branchPrefix') throw new Error('boom');
      return { path: params.path, value: 'ok' };
    });

    const { initAppSettingsService, getBranchPrefix, getWorktreesLocation } = await import(
      '../app-settings.service'
    );

    await expect(initAppSettingsService()).resolves.toBeUndefined();
    expect(getBranchPrefix()).toBe('');
    expect(getWorktreesLocation()).toBe('ok');
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      'Failed to hydrate workspace.branchPrefix from daemon',
      expect.objectContaining({ error: 'boom' }),
    );
  });

  it('concurrent initAppSettingsService calls share a single hydration', async () => {
    requestSpy.mockImplementation(async (_method: string, params: { path: string }) => ({
      path: params.path,
      value: '',
    }));

    const { initAppSettingsService } = await import('../app-settings.service');
    await Promise.all([initAppSettingsService(), initAppSettingsService()]);

    // 3 daemon paths × 1 hydration cycle = 3 calls, not 6.
    expect(requestSpy).toHaveBeenCalledTimes(3);
  });
});
