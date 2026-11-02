import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the daemon-backed workspace settings service
 * (PROTOCOL.md §5.1 `workspace.getAutoCommit`). The former in-memory
 * per-workspace map is retired; reads go straight to the daemon's persisted
 * per-workspace override. Writes are served by the renderer
 * `workspace:update-settings` seeder (`workspace.setAutoCommit`).
 */

const requestMock = vi.hoisted(() =>
  vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({
    autoCommit: { enabled: true, source: 'workspace' },
  })),
);

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

describe('workspace-settings.service ↔ daemon workspace.getAutoCommit', () => {
  beforeEach(() => {
    requestMock.mockClear();
    requestMock.mockImplementation(async () => ({
      autoCommit: { enabled: true, source: 'workspace' },
    }));
    vi.resetModules();
  });

  it('getWorkspaceSettings sends workspace.getAutoCommit with the workspaceId', async () => {
    const { getWorkspaceSettings } = await import('../workspace-settings.service');
    const settings = await getWorkspaceSettings('ws-1');
    expect(requestMock).toHaveBeenCalledWith('workspace.getAutoCommit', { workspaceId: 'ws-1' });
    expect(settings).toEqual({ autoCommitEnabled: true });
  });

  it('isAutoCommitEnabled surfaces a daemon false (per-workspace override)', async () => {
    requestMock.mockResolvedValueOnce({ autoCommit: { enabled: false, source: 'workspace' } });
    const { isAutoCommitEnabled } = await import('../workspace-settings.service');
    await expect(isAutoCommitEnabled('ws-2')).resolves.toBe(false);
  });

  it('surfaces the global fallback resolution (source: "global")', async () => {
    requestMock.mockResolvedValueOnce({ autoCommit: { enabled: false, source: 'global' } });
    const { getWorkspaceSettings } = await import('../workspace-settings.service');
    await expect(getWorkspaceSettings('ws-3')).resolves.toEqual({ autoCommitEnabled: false });
  });

  it('defaults to enabled when the daemon call fails', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { isAutoCommitEnabled } = await import('../workspace-settings.service');
    await expect(isAutoCommitEnabled('ws-4')).resolves.toBe(true);
  });

  it('defaults to enabled on a malformed daemon response', async () => {
    requestMock.mockResolvedValueOnce({});
    const { getWorkspaceSettings } = await import('../workspace-settings.service');
    await expect(getWorkspaceSettings('ws-5')).resolves.toEqual({ autoCommitEnabled: true });
  });
});
