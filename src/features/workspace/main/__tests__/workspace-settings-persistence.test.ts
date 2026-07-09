import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the workspace-settings rewire (PROTOCOL.md §5.12).
 * The legacy `settings` electron-store `autoCommit` key is retired; the
 * source of truth is the daemon-owned `git.autoCommit` setting, hydrated
 * into an in-memory cache via `settings.get`.
 */

const requestMock = vi.hoisted(() =>
  vi.fn(async () => ({ path: 'git.autoCommit', value: true })),
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

describe('workspace-settings.service ↔ daemon git.autoCommit', () => {
  beforeEach(async () => {
    requestMock.mockClear();
    requestMock.mockImplementation(async () => ({ path: 'git.autoCommit', value: true }));
    vi.resetModules();
    const mod = await import('../workspace-settings.service');
    mod.__resetWorkspaceSettingsForTesting();
  });

  it('initWorkspaceSettings hydrates from settings.get git.autoCommit', async () => {
    const { initWorkspaceSettings } = await import('../workspace-settings.service');
    await initWorkspaceSettings();
    expect(requestMock).toHaveBeenCalledWith('settings.get', { path: 'git.autoCommit' });
  });

  it('isAutoCommitEnabled returns hydrated value (false) after init', async () => {
    requestMock.mockResolvedValueOnce({ path: 'git.autoCommit', value: false });
    const { initWorkspaceSettings, isAutoCommitEnabled } = await import(
      '../workspace-settings.service'
    );
    await initWorkspaceSettings();
    expect(isAutoCommitEnabled('ws-1')).toBe(false);
  });

  it('defaults to true when the daemon call fails', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { initWorkspaceSettings, isAutoCommitEnabled } = await import(
      '../workspace-settings.service'
    );
    await initWorkspaceSettings();
    expect(isAutoCommitEnabled('ws-2')).toBe(true);
  });

  it('defaults to true before hydration completes (no race regression)', async () => {
    // Do NOT await initWorkspaceSettings; the sync API must still work.
    const { isAutoCommitEnabled } = await import('../workspace-settings.service');
    expect(isAutoCommitEnabled('ws-3')).toBe(true);
  });

  it('renderer sync overrides the daemon default for that workspace', async () => {
    requestMock.mockResolvedValueOnce({ path: 'git.autoCommit', value: true });
    const { initWorkspaceSettings, updateWorkspaceSettings, isAutoCommitEnabled } =
      await import('../workspace-settings.service');
    await initWorkspaceSettings();
    updateWorkspaceSettings('ws-4', { autoCommitEnabled: false });
    expect(isAutoCommitEnabled('ws-4')).toBe(false);
    // Other workspaces still see the daemon default.
    expect(isAutoCommitEnabled('ws-5')).toBe(true);
  });

  it('assertAgentCommitAllowed blocks when auto-commit is off (integration)', async () => {
    requestMock.mockResolvedValueOnce({ path: 'git.autoCommit', value: false });
    const { initWorkspaceSettings, assertAgentCommitAllowed } = await import(
      '../workspace-settings.service'
    );
    await initWorkspaceSettings();
    const result = assertAgentCommitAllowed('ws-6');
    expect(result.allowed).toBe(false);
    const bypass = assertAgentCommitAllowed('ws-6', { userRequested: true });
    expect(bypass.allowed).toBe(true);
  });

  it('never writes back to the daemon (read-only consumer)', async () => {
    const { initWorkspaceSettings } = await import('../workspace-settings.service');
    await initWorkspaceSettings();
    const writes = requestMock.mock.calls.filter(([m]) => m === 'settings.update');
    expect(writes).toHaveLength(0);
  });
});
