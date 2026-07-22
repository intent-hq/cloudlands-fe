/**
 * Wire-contract tests for the Pi MCP adapter bridge seeder.
 *
 * Asserts `pi:check-mcp-adapter` / `pi:install-mcp-adapter` forward to the
 * canonical daemon probes (`host.findBinary` + `host.exec` — PROTOCOL §5.14):
 * check runs `pi list` and matches pi-mcp-adapter lines, install runs
 * `pi install npm:pi-mcp-adapter` and preserves the `{ success, error? }`
 * caller shape. Failures resolve honestly (check `false`, install a shaped
 * error) — never fake positives.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { PI_CHANNELS } from '$shared/ipc/channels';

const mockedRequest = vi.mocked(backendRequest);

/** Route daemon methods to canned PROTOCOL-shaped responses. */
type MethodResponses = Record<string, unknown | ((params: unknown) => unknown)>;
function routeDaemon(responses: MethodResponses): void {
  mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
    if (!(method in responses)) throw new Error(`unexpected daemon method: ${method}`);
    const entry = responses[method];
    return typeof entry === 'function' ? (entry as (p: unknown) => unknown)(params) : entry;
  });
}

/** Arity-proof negative assertion: no call routed to `host.exec` at all
 * (a positional `toHaveBeenCalledWith` matcher would miss 3-arg calls). */
function expectNoHostExec(): void {
  const execCalls = mockedRequest.mock.calls.filter(([method]) => method === 'host.exec');
  expect(execCalls).toEqual([]);
}

const PI_FOUND = { available: true, path: '/usr/local/bin/pi' };

type InstallResult = { success: boolean; error?: string };

describe('pi-mcp-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./pi-mcp-bridge-seeder');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('pi:check-mcp-adapter → host.findBinary + host.exec `pi list`', () => {
    it('resolves true when `pi list` output includes pi-mcp-adapter', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: 'pi-acp 0.0.31\npi-mcp-adapter 1.2.0\n', stderr: '', exitCode: 0 },
      });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(true);

      expect(mockedRequest).toHaveBeenCalledWith('host.findBinary', { name: 'pi' });
      // Third arg: transport-timeout override with headroom over the daemon
      // exec bound, so the daemon's structured `timedOut` result wins over
      // the JsonRpcClient's flat 30s default.
      expect(mockedRequest).toHaveBeenCalledWith(
        'host.exec',
        {
          command: '/usr/local/bin/pi',
          args: ['list'],
          timeoutMs: 10_000,
        },
        { timeoutMs: 15_000 },
      );
    });

    it('resolves false when `pi list` output lacks the adapter', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: 'pi-acp 0.0.31\n', stderr: '', exitCode: 0 },
      });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(false);
    });

    it('resolves false when the pi CLI is not installed — without running pi list', async () => {
      routeDaemon({ 'host.findBinary': { available: false } });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(false);
      expectNoHostExec();
    });

    it('resolves false for an untrusted whitespace-only findBinary path — without running pi list', async () => {
      routeDaemon({ 'host.findBinary': { available: true, path: '   ' } });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(false);
      expectNoHostExec();
    });

    it('trims the resolved path before using it as the exec command', async () => {
      routeDaemon({
        'host.findBinary': { available: true, path: ' /usr/local/bin/pi \n' },
        'host.exec': { stdout: 'pi-mcp-adapter 1.2.0\n', stderr: '', exitCode: 0 },
      });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(true);
      expect(mockedRequest).toHaveBeenCalledWith(
        'host.exec',
        {
          command: '/usr/local/bin/pi',
          args: ['list'],
          timeoutMs: 10_000,
        },
        { timeoutMs: 15_000 },
      );
    });

    it('resolves false on non-zero exit', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: '', stderr: 'boom', exitCode: 1 },
      });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(false);
    });

    it('resolves false on timeout', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: '', stderr: '', exitCode: -1, timedOut: true },
      });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(false);
    });

    it('resolves false when the exec RPC itself rejects', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': () => {
          throw new Error('daemon unreachable');
        },
      });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(false);
    });

    it('resolves false when the findBinary RPC itself rejects — without running pi list', async () => {
      routeDaemon({
        'host.findBinary': () => {
          throw new Error('daemon unreachable');
        },
      });

      await expect(mockInvoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER)).resolves.toBe(false);
      expectNoHostExec();
    });
  });

  describe('pi:install-mcp-adapter → host.exec `pi install npm:pi-mcp-adapter`', () => {
    it('runs the install on the daemon host and resolves success', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: 'installed pi-mcp-adapter\n', stderr: '', exitCode: 0 },
      });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      // Third arg: transport override so a >30s npm download is bounded by
      // the daemon's 120s exec limit, not the flat client default.
      expect(mockedRequest).toHaveBeenCalledWith(
        'host.exec',
        {
          command: '/usr/local/bin/pi',
          args: ['install', 'npm:pi-mcp-adapter'],
          timeoutMs: 120_000,
        },
        { timeoutMs: 125_000 },
      );
      expect(result).toEqual({ success: true });
    });

    it('shapes a missing pi CLI as a failure without running the install', async () => {
      routeDaemon({ 'host.findBinary': { available: false } });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      expect(result).toEqual({
        success: false,
        error: 'Pi CLI not found. Please install Pi first.',
      });
      expectNoHostExec();
    });

    it('surfaces stderr on non-zero exit', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: '', stderr: 'npm registry unreachable', exitCode: 1 },
      });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      expect(result).toEqual({ success: false, error: 'npm registry unreachable' });
    });

    it('falls back to the exit code when stderr is empty', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: '', stderr: '', exitCode: 7 },
      });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      expect(result).toEqual({ success: false, error: 'pi install exited with code 7' });
    });

    it('shapes a timeout as a failure', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': { stdout: '', stderr: '', exitCode: -1, timedOut: true },
      });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      expect(result).toEqual({ success: false, error: 'pi install timed out' });
    });

    it('shapes an exec RPC rejection as a failure with the error message', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': () => {
          throw new Error('daemon unreachable');
        },
      });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      expect(result).toEqual({ success: false, error: 'daemon unreachable' });
    });

    it('surfaces a findBinary RPC rejection instead of mis-reporting "Pi CLI not found"', async () => {
      routeDaemon({
        'host.findBinary': () => {
          throw new Error('JSON-RPC request timed out: host.findBinary');
        },
      });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      expect(result).toEqual({
        success: false,
        error: 'JSON-RPC request timed out: host.findBinary',
      });
      expectNoHostExec();
    });

    it('falls back to a generic message when the rejection has no usable message', async () => {
      routeDaemon({
        'host.findBinary': PI_FOUND,
        'host.exec': () => {
          throw new Error('');
        },
      });

      const result = await mockInvoke<InstallResult>(PI_CHANNELS.INSTALL_MCP_ADAPTER);

      expect(result).toEqual({ success: false, error: 'Failed to install pi-mcp-adapter' });
    });
  });
});
