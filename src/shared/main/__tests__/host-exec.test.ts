import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * Wire-contract tests for host-exec.ts.
 *
 * Per PROTOCOL.md §5.14, arbitrary one-shot execution is delegated to the
 * daemon via `host.exec`. These tests assert the exact request shape sent on
 * the wire and feed back PROTOCOL-shaped mock responses.
 */

const { mockRequest, loggerSpies } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  loggerSpies: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));

vi.mock('../../logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

import { hostExec } from '../host-exec';

describe('hostExec', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
  });

  it('sends only { command } when no options are supplied', async () => {
    mockRequest.mockResolvedValue({ stdout: 'hi\n', stderr: '', exitCode: 0 });

    const result = await hostExec('echo');

    expect(mockRequest).toHaveBeenCalledWith('host.exec', { command: 'echo' });
    expect(result).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 });
  });

  it('forwards args, cwd, env, timeoutMs, workspaceId when provided', async () => {
    mockRequest.mockResolvedValue({
      stdout: 'out',
      stderr: 'err',
      exitCode: 0,
    });

    await hostExec('git', {
      args: ['status', '--porcelain'],
      cwd: '/workspaces/foo',
      env: { GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 5000,
      workspaceId: 'ws-1',
    });

    expect(mockRequest).toHaveBeenCalledWith('host.exec', {
      command: 'git',
      args: ['status', '--porcelain'],
      cwd: '/workspaces/foo',
      env: { GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 5000,
      workspaceId: 'ws-1',
    });
  });

  it('omits empty args / env and blank cwd / workspaceId', async () => {
    mockRequest.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await hostExec('ls', {
      args: [],
      cwd: '',
      env: {},
      workspaceId: '',
    });

    expect(mockRequest).toHaveBeenCalledWith('host.exec', { command: 'ls' });
  });

  it('surfaces a non-zero exit code without throwing', async () => {
    mockRequest.mockResolvedValue({
      stdout: '',
      stderr: 'boom',
      exitCode: 2,
    });

    const result = await hostExec('false');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('boom');
  });

  it('propagates `timedOut: true` from the daemon on timeout', async () => {
    mockRequest.mockResolvedValue({
      stdout: 'partial',
      stderr: '',
      exitCode: 124,
      timedOut: true,
    });

    const result = await hostExec('sleep', { args: ['9999'], timeoutMs: 10 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  it('rethrows RPC errors after logging', async () => {
    mockRequest.mockRejectedValue(new Error('connection reset'));

    await expect(hostExec('echo')).rejects.toThrow('connection reset');
    expect(loggerSpies.debug).toHaveBeenCalledWith(
      'host.exec request failed',
      expect.objectContaining({ command: 'echo', error: 'connection reset' }),
    );
  });
});
