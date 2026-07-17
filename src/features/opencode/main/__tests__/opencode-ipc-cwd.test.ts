/**
 * Regression test for opencode host.exec cwd parameter.
 *
 * Verifies that opencode CLI invocations (`models`, `--version`) do NOT
 * send a `cwd` parameter to the daemon's `host.exec` — a regression from
 * cloudlands-fe PR #7 that passed `cwd: os.homedir()` without a `workspaceId`,
 * causing the daemon to reject with `-32602`.
 *
 * PROTOCOL.md §5.14 states that `cwd` requires `workspaceId` for the containment
 * guard. OpenCode reads global config/auth from `$HOME`/XDG env, not the working
 * directory, so the `cwd` was unnecessary.
 */

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { OPENCODE_CHANNELS } from '../../../../shared/ipc/channels';

const { mockBackendRequest, mockResolveOpenCodeCommand } = vi.hoisted(() => ({
  mockBackendRequest: vi.fn(),
  mockResolveOpenCodeCommand: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    error = vi.fn();
    info = vi.fn();
    warn = vi.fn();
  },
}));

vi.mock('../opencode-resolver', () => ({
  resolveOpenCodeCommand: mockResolveOpenCodeCommand,
}));

// Mock the backend client to assert the exact wire request shape
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockBackendRequest }),
}));

describe('opencode IPC - cwd parameter regression', () => {
  beforeEach(() => {
    mockBackendRequest.mockReset();
    mockResolveOpenCodeCommand.mockReset();
    mockResolveOpenCodeCommand.mockResolvedValue({
      command: '/mocked/opencode',
      argsPrefix: [],
      usesNpx: false,
    });
  });

  it('does NOT send cwd or workspaceId when fetching models', async () => {
    // Mock successful response with PROTOCOL-shaped payload
    mockBackendRequest.mockResolvedValueOnce({
      stdout: 'openai/gpt-5.2\nanthropic/claude-sonnet-4\n',
      stderr: '',
      exitCode: 0,
    });

    // Fresh import to get uncached module
    vi.resetModules();
    const { getCachedOpencodeModels } = await import('../opencode.ipc');
    const result = await getCachedOpencodeModels();

    // Assert the response was parsed correctly
    expect(result).toEqual(['openai/gpt-5.2', 'anthropic/claude-sonnet-4']);

    // Assert the wire request contains expected fields and NO cwd/workspaceId
    expect(mockBackendRequest).toHaveBeenCalledTimes(1);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      'host.exec',
      expect.objectContaining({
        command: '/mocked/opencode',
        args: ['models', '--log-level', 'DEBUG'],
        timeoutMs: 10000,
      }),
    );

    // Explicitly assert cwd and workspaceId are absent
    const [_method, params] = mockBackendRequest.mock.calls[0];
    expect(params).not.toHaveProperty('cwd');
    expect(params).not.toHaveProperty('workspaceId');
  });

  it('does NOT send cwd or workspaceId when checking availability', async () => {
    // Mock successful --version response
    mockBackendRequest.mockResolvedValueOnce({
      stdout: 'opencode 1.0.0\n',
      stderr: '',
      exitCode: 0,
    });

    // Fresh import
    vi.resetModules();
    const ipcModule = await import('../opencode.ipc');

    // Manually invoke the executeOpencodeCommand path via setupOpencodeIPC
    // We need to access the private executeOpencodeCommand, so we'll test via
    // the availability check which calls it with ['--version']
    ipcModule.setupOpencodeIPC();

    // Get the registered handler for CHECK_AVAILABILITY
    const { ipcMain } = await import('electron');
    const handleCall = (ipcMain.handle as any).mock.calls.find(
      (call: any) => call[0] === OPENCODE_CHANNELS.CHECK_AVAILABILITY
    );
    expect(handleCall).toBeDefined();

    const handler = handleCall[1];
    await handler();

    // Assert the wire request contains expected fields and NO cwd/workspaceId
    expect(mockBackendRequest).toHaveBeenCalledTimes(1);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      'host.exec',
      expect.objectContaining({
        command: '/mocked/opencode',
        args: ['--version'],
        timeoutMs: 5000,
      }),
    );

    // Explicitly assert cwd and workspaceId are absent
    const [_method, params] = mockBackendRequest.mock.calls[0];
    expect(params).not.toHaveProperty('cwd');
    expect(params).not.toHaveProperty('workspaceId');
  });
});
