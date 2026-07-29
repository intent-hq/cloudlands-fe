import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the daemon-backed workspace settings service
 * (PROTOCOL.md §5.1 `workspace.getAutoCommit` / `workspace.setAutoCommit`).
 * The former in-memory per-workspace map is retired; reads and writes go
 * straight to the daemon's persisted per-workspace override.
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

describe('workspace-settings.service ↔ daemon workspace.getAutoCommit/setAutoCommit', () => {
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

  it('updateWorkspaceSettings persists via workspace.setAutoCommit and reads back', async () => {
    requestMock
      .mockResolvedValueOnce({ autoCommit: { enabled: false, source: 'workspace' } }) // set
      .mockResolvedValueOnce({ autoCommit: { enabled: false, source: 'workspace' } }); // read-back
    const { updateWorkspaceSettings } = await import('../workspace-settings.service');
    const updated = await updateWorkspaceSettings('ws-6', { autoCommitEnabled: false });
    expect(requestMock).toHaveBeenNthCalledWith(1, 'workspace.setAutoCommit', {
      workspaceId: 'ws-6',
      enabled: false,
    });
    expect(requestMock).toHaveBeenNthCalledWith(2, 'workspace.getAutoCommit', {
      workspaceId: 'ws-6',
    });
    expect(updated).toEqual({ autoCommitEnabled: false });
  });

  it('updateWorkspaceSettings with no autoCommitEnabled never writes', async () => {
    const { updateWorkspaceSettings } = await import('../workspace-settings.service');
    await updateWorkspaceSettings('ws-7', {});
    const writes = requestMock.mock.calls.filter(([m]) => m === 'workspace.setAutoCommit');
    expect(writes).toHaveLength(0);
  });

  it('never writes the global git.autoCommit setting', async () => {
    const { updateWorkspaceSettings } = await import('../workspace-settings.service');
    await updateWorkspaceSettings('ws-8', { autoCommitEnabled: true });
    const globalWrites = requestMock.mock.calls.filter(([m]) => m === 'settings.update');
    expect(globalWrites).toHaveLength(0);
  });
});
