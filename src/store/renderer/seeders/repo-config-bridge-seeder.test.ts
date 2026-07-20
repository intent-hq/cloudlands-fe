/**
 * Wire-contract tests for the repo-config IPC bridge seeder.
 *
 * Asserts `setup-scripts:read-repo-config` (a) forwards to the daemon-owned
 * exec (`host.exec`, PROTOCOL §5.14) with the exact path-based argv, and
 * (b) folds a missing `.intent/config.json` to a soft `{ content: null }`
 * result — never an error — matching the tolerant-read contract the
 * new-workspace initializer relies on.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.14 host.exec result. */
function execResult(
  overrides: Partial<{ stdout: string; stderr: string; exitCode: number }> = {},
) {
  return { stdout: '', stderr: '', exitCode: 0, ...overrides };
}

describe('repo-config-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./repo-config-bridge-seeder');
  });

  afterEach(() => vi.clearAllMocks());

  it('forwards to host.exec with the path-based .intent/config.json read', async () => {
    const content = JSON.stringify({ setupScript: 'npm ci' });
    mockedRequest.mockResolvedValueOnce(execResult({ stdout: content }));

    const result = await mockInvoke(IPC_CHANNELS.SETUP_SCRIPTS.READ_REPO_CONFIG, {
      repoPath: '/Users/dev/repo',
    });

    expect(mockedRequest).toHaveBeenCalledWith('host.exec', {
      command: 'cat',
      args: ['/Users/dev/repo/.intent/config.json'],
      timeoutMs: 10_000,
    });
    expect(result).toEqual({ success: true, data: { content } });
  });

  it('folds a missing config file (non-zero exit) to a soft null, not an error', async () => {
    mockedRequest.mockResolvedValueOnce(
      execResult({ exitCode: 1, stderr: 'cat: no such file or directory' }),
    );

    const result = await mockInvoke(IPC_CHANNELS.SETUP_SCRIPTS.READ_REPO_CONFIG, {
      repoPath: '/Users/dev/repo',
    });

    expect(result).toEqual({ success: true, data: { content: null } });
  });

  it('folds a daemon rejection to the error envelope (never throws)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('transport down'));

    const result = await mockInvoke(IPC_CHANNELS.SETUP_SCRIPTS.READ_REPO_CONFIG, {
      repoPath: '/Users/dev/repo',
    });

    expect(result).toEqual({ success: false, error: 'transport down' });
  });

  it('rejects a missing repoPath with a shaped error', async () => {
    const result = await mockInvoke(IPC_CHANNELS.SETUP_SCRIPTS.READ_REPO_CONFIG, {});

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'repoPath is required' });
  });
});
