/**
 * Wire-contract tests for the shell reveal bridge seeder.
 *
 * Asserts `shell:showItemInFolder` is locality-gated on `system.status`
 * `host.locality` (PROTOCOL §5.7/§5.14) and forwards to the platform reveal
 * argv via `host.exec`: macOS `open -R <path>`, Windows
 * `explorer /select,<path>` (exit 1 tolerated), Linux `xdg-open <parent>`.
 * Remote daemons and daemon failures REJECT — never a fake success.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';

const mockedRequest = vi.mocked(backendRequest);

const CHANNEL = 'shell:showItemInFolder';

/** Route daemon methods to canned PROTOCOL-shaped responses. */
type MethodResponses = Record<string, unknown | ((params: unknown) => unknown)>;
function routeDaemon(responses: MethodResponses): void {
  mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
    if (!(method in responses)) throw new Error(`unexpected daemon method: ${method}`);
    const entry = responses[method];
    return typeof entry === 'function' ? (entry as (p: unknown) => unknown)(params) : entry;
  });
}

/** `system.status` subset with the given host os + locality. */
function systemStatus(os: string, locality: 'local' | 'remote') {
  return { running: true, host: { os, arch: 'arm64', hasDisplay: true, locality } };
}

const EXEC_OK = { stdout: '', stderr: '', exitCode: 0 };

/** Arity-proof negative assertion: no call routed to `host.exec` at all. */
function expectNoHostExec(): void {
  const execCalls = mockedRequest.mock.calls.filter(([method]) => method === 'host.exec');
  expect(execCalls).toEqual([]);
}

describe('shell-reveal-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./shell-reveal-bridge-seeder');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reveals via `open -R <path>` on a local macOS daemon host', async () => {
    routeDaemon({ 'system.status': systemStatus('macos', 'local'), 'host.exec': EXEC_OK });

    await expect(mockInvoke(CHANNEL, { path: '/repo/src/main.rs' })).resolves.toEqual({
      success: true,
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      'host.exec',
      { command: 'open', args: ['-R', '/repo/src/main.rs'], timeoutMs: 10_000 },
      { timeoutMs: 15_000 },
    );
  });

  it('reveals via `explorer /select,<path>` on Windows — tolerating exit code 1', async () => {
    routeDaemon({
      'system.status': systemStatus('windows', 'local'),
      'host.exec': { stdout: '', stderr: '', exitCode: 1 },
    });

    await expect(mockInvoke(CHANNEL, { path: 'C:\\repo\\main.rs' })).resolves.toEqual({
      success: true,
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      'host.exec',
      { command: 'explorer', args: ['/select,C:\\repo\\main.rs'], timeoutMs: 10_000 },
      { timeoutMs: 15_000 },
    );
  });

  it('opens the parent directory via `xdg-open` on Linux (no select flag)', async () => {
    routeDaemon({ 'system.status': systemStatus('linux', 'local'), 'host.exec': EXEC_OK });

    await expect(mockInvoke(CHANNEL, { path: '/repo/src/main.rs' })).resolves.toEqual({
      success: true,
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      'host.exec',
      { command: 'xdg-open', args: ['/repo/src'], timeoutMs: 10_000 },
      { timeoutMs: 15_000 },
    );
  });

  it('rejects on a remote daemon — without running any host.exec', async () => {
    routeDaemon({ 'system.status': systemStatus('macos', 'remote'), 'host.exec': EXEC_OK });

    await expect(mockInvoke(CHANNEL, { path: '/repo/src/main.rs' })).rejects.toThrow(
      /only available when the daemon runs on this machine/,
    );
    expectNoHostExec();
  });

  it('rejects when the path parameter is missing — without any daemon call', async () => {
    routeDaemon({});

    await expect(mockInvoke(CHANNEL, {})).rejects.toThrow('Missing required parameter: path');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('rejects on a non-tolerated exit code, surfacing stderr', async () => {
    routeDaemon({
      'system.status': systemStatus('macos', 'local'),
      'host.exec': { stdout: '', stderr: 'no such file', exitCode: 1 },
    });

    await expect(mockInvoke(CHANNEL, { path: '/gone' })).rejects.toThrow('no such file');
  });

  it('rejects on a daemon-side exec timeout', async () => {
    routeDaemon({
      'system.status': systemStatus('macos', 'local'),
      'host.exec': { stdout: '', stderr: '', exitCode: -1, timedOut: true },
    });

    await expect(mockInvoke(CHANNEL, { path: '/repo/file' })).rejects.toThrow(/timed out/);
  });

  it('rejects when the system.status RPC itself fails — without running host.exec', async () => {
    routeDaemon({
      'system.status': () => {
        throw new Error('daemon unreachable');
      },
    });

    await expect(mockInvoke(CHANNEL, { path: '/repo/file' })).rejects.toThrow('daemon unreachable');
    expectNoHostExec();
  });
});
