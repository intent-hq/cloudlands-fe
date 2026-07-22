/**
 * Connection-mode resolution tests for startIntentdSidecar.
 *
 * Uses fully mocked net/child_process (same pattern as watchdog.test.ts) so
 * no real sockets or processes are created:
 *   - spawn policy disabled (env override) → external
 *   - adopt an already-running daemon      → external
 *   - spawn the daemon                     → sidecar
 */
// Mock fs.existsSync for socket/binary path checks
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

// Mock net.connect so the version probe never opens a real socket
vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    connect: vi.fn(),
  };
});

// Mock child_process.spawn so no real daemon process is launched. Both the
// `node:`-prefixed and bare specifiers must be mocked: the global test-setup
// mocks bare 'child_process' with the REAL spawn preserved, which otherwise
// wins the module-resolution race for this file. (vi.mock is hoisted, so the
// factories must be inline.)
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const spawnMock = vi.fn();
  return { ...actual, spawn: spawnMock, default: { ...actual, spawn: spawnMock } };
});
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const spawnMock = vi.fn();
  return { ...actual, spawn: spawnMock, default: { ...actual, spawn: spawnMock } };
});

import { spawn } from 'node:child_process';
import * as net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetIntentdSidecarForTesting,
  __setSidecarProcessForTesting,
  startIntentdSidecar,
} from '../intentd-sidecar';
import { __resetConnectionModeForTesting, getConnectionMode } from '../connection-mode';

const mockConnect = vi.mocked(net.connect);
const mockSpawn = vi.mocked(spawn);

/** Mock socket whose data handler answers system.status with the given payload (or stays silent). */
function mockProbeSocket(responseJson: string | null): void {
  mockConnect.mockImplementation(
    () =>
      ({
        write: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'connect') setTimeout(() => handler(), 0);
          if (event === 'data' && responseJson !== null) {
            setTimeout(() => handler(Buffer.from(responseJson + '\n')), 0);
          }
          if (event === 'error' && responseJson === null) {
            setTimeout(() => handler(new Error('connection refused')), 0);
          }
        }),
      }) as unknown as net.Socket,
  );
}

function mockSpawnedProcess(): void {
  mockSpawn.mockReturnValue({
    stdout: null,
    stderr: null,
    killed: false,
    exitCode: null,
    kill: vi.fn(() => true),
    on: vi.fn(),
  } as never);
}

describe('startIntentdSidecar connection-mode resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConnectionModeForTesting();
    __resetIntentdSidecarForTesting();
  });

  afterEach(() => {
    __setSidecarProcessForTesting(null);
    __resetIntentdSidecarForTesting();
    __resetConnectionModeForTesting();
  });

  it('sets external when the spawn policy disables spawning (env override)', async () => {
    await startIntentdSidecar({ INTENTD_SOCKET: '/tmp/x.sock' }, true, '/resources', '/cwd');
    expect(getConnectionMode()).toBe('external');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('sets external when adopting an already-running daemon (version handshake)', async () => {
    mockProbeSocket(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { running: true, version: '0.1.0', protocolVersion: '1' },
      }),
    );
    await startIntentdSidecar({ INTENTD_SIDECAR: '1' }, false, '/resources', '/cwd');
    expect(getConnectionMode()).toBe('external');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('sets sidecar when spawning the daemon', async () => {
    // Probe finds no daemon (connection refused), binary "exists" via mocked fs.
    mockProbeSocket(null);
    mockSpawnedProcess();
    await startIntentdSidecar(
      { INTENTD_SIDECAR: '1', INTENTD_BIN: '/fake/intentd' },
      false,
      '/resources',
      '/cwd',
    );
    expect(getConnectionMode()).toBe('sidecar');
    expect(mockSpawn).toHaveBeenCalledWith(
      '/fake/intentd',
      ['serve', '--listen', 'uds'],
      expect.objectContaining({ detached: false }),
    );
  });
});
