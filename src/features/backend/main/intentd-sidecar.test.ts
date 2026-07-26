/**
 * Unit tests for the intentd sidecar manager.
 *
 * Tests the spawn-policy decision function, binary path resolution, and the
 * version-handshake probe (against a mock UDS server). Connection-mode
 * resolution in startIntentdSidecar is tested separately in
 * `__tests__/connection-mode-resolution.test.ts` (with mocked net/child_process).
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetIntentdSidecarForTesting,
  getSidecarRunLog,
  onSidecarStartupFailed,
  probeDaemonVersion,
  resolveIntentdBinaryPath,
  resolveSocketPath,
  shouldSpawnSidecar,
  startIntentdSidecar,
} from './intentd-sidecar';
import { __resetConnectionModeForTesting } from './connection-mode';

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

// Mock fs for binary path resolution tests
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

// Mock child_process.spawn for the run-log capture tests so no real daemon is
// launched. Both the `node:`-prefixed and bare specifiers must be mocked: the
// global test-setup mocks bare 'child_process' with the REAL spawn preserved,
// which otherwise wins the module-resolution race for this file.
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

describe('shouldSpawnSidecar', () => {
  it('returns false when INTENTD_SIDECAR=0 (any build)', () => {
    const decision = shouldSpawnSidecar({ INTENTD_SIDECAR: '0' }, false);
    expect(decision.shouldSpawn).toBe(false);
    expect(decision.reason).toContain('INTENTD_SIDECAR=0');
  });

  it('returns false when INTENTD_SOCKET is set (connect-only)', () => {
    const decision = shouldSpawnSidecar({ INTENTD_SOCKET: '/tmp/x.sock' }, true);
    expect(decision.shouldSpawn).toBe(false);
    expect(decision.reason).toContain('INTENTD_SOCKET');
  });

  it('returns false when INTENTD_WS_URL is set', () => {
    const decision = shouldSpawnSidecar({ INTENTD_WS_URL: 'ws://127.0.0.1:5181' }, true);
    expect(decision.shouldSpawn).toBe(false);
    expect(decision.reason).toContain('INTENTD_WS_URL');
  });

  it('returns false when INTENTD_TCP is set', () => {
    const decision = shouldSpawnSidecar({ INTENTD_TCP: '10.0.0.1:6000' }, true);
    expect(decision.shouldSpawn).toBe(false);
    expect(decision.reason).toContain('INTENTD_TCP');
  });

  it('returns false for dev build without INTENTD_SIDECAR=1', () => {
    const decision = shouldSpawnSidecar({}, false);
    expect(decision.shouldSpawn).toBe(false);
    expect(decision.reason).toContain('dev build requires INTENTD_SIDECAR=1');
  });

  it('returns true for dev build with INTENTD_SIDECAR=1', () => {
    const decision = shouldSpawnSidecar({ INTENTD_SIDECAR: '1' }, false);
    expect(decision.shouldSpawn).toBe(true);
    expect(decision.reason).toContain('INTENTD_SIDECAR=1');
  });

  it('returns true for packaged build with no overrides', () => {
    const decision = shouldSpawnSidecar({}, true);
    expect(decision.shouldSpawn).toBe(true);
    expect(decision.reason).toContain('packaged build');
  });

  it('prioritizes transport overrides over INTENTD_SIDECAR=1 (packaged)', () => {
    const decision = shouldSpawnSidecar(
      { INTENTD_SIDECAR: '1', INTENTD_SOCKET: '/x.sock' },
      true,
    );
    expect(decision.shouldSpawn).toBe(false);
    expect(decision.reason).toContain('INTENTD_SOCKET');
  });

  it('INTENTD_SIDECAR=0 wins over packaged mode', () => {
    const decision = shouldSpawnSidecar({ INTENTD_SIDECAR: '0' }, true);
    expect(decision.shouldSpawn).toBe(false);
    expect(decision.reason).toContain('INTENTD_SIDECAR=0');
  });
});

describe('resolveIntentdBinaryPath', () => {
  const mockExistsSync = vi.mocked(fs.existsSync);

  beforeEach(() => {
    mockExistsSync.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('honors INTENTD_BIN env override when the file exists', () => {
    mockExistsSync.mockReturnValue(true);
    const binaryPath = resolveIntentdBinaryPath(
      { INTENTD_BIN: '/custom/intentd' },
      false,
      '/resources',
      '/cwd',
    );
    expect(binaryPath).toBe('/custom/intentd');
    expect(mockExistsSync).toHaveBeenCalledWith('/custom/intentd');
  });

  it('ignores INTENTD_BIN when the file does not exist', () => {
    const binaryName = process.platform === 'win32' ? 'intentd.exe' : 'intentd';
    const expectedPath = path.join('/cwd/packages/intentd/target/release', binaryName);
    mockExistsSync.mockReturnValueOnce(false); // INTENTD_BIN does not exist
    mockExistsSync.mockReturnValueOnce(true); // release binary exists
    const binaryPath = resolveIntentdBinaryPath(
      { INTENTD_BIN: '/missing' },
      false,
      '/resources',
      '/cwd',
    );
    expect(binaryPath).toBe(expectedPath);
  });

  it('returns packaged binary path when isPackaged=true and file exists', () => {
    const binaryName = process.platform === 'win32' ? 'intentd.exe' : 'intentd';
    const expectedPath = path.join('/app/resources', 'intentd', binaryName);
    mockExistsSync.mockReturnValue(true);
    const binaryPath = resolveIntentdBinaryPath({}, true, '/app/resources', '/cwd');
    expect(binaryPath).toBe(expectedPath);
    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('returns null when packaged binary does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const binaryPath = resolveIntentdBinaryPath({}, true, '/app/resources', '/cwd');
    expect(binaryPath).toBeNull();
  });

  it('prefers release over debug in dev mode', () => {
    const binaryName = process.platform === 'win32' ? 'intentd.exe' : 'intentd';
    const expectedPath = path.join('/monorepo/packages/intentd/target/release', binaryName);
    mockExistsSync.mockReturnValueOnce(true); // release exists
    const binaryPath = resolveIntentdBinaryPath({}, false, '/resources', '/monorepo');
    expect(binaryPath).toBe(expectedPath);
  });

  it('falls back to debug when release does not exist', () => {
    const binaryName = process.platform === 'win32' ? 'intentd.exe' : 'intentd';
    const expectedPath = path.join('/monorepo/packages/intentd/target/debug', binaryName);
    mockExistsSync.mockReturnValueOnce(false); // release does not exist
    mockExistsSync.mockReturnValueOnce(true); // debug exists
    const binaryPath = resolveIntentdBinaryPath({}, false, '/resources', '/monorepo');
    expect(binaryPath).toBe(expectedPath);
  });

  it('returns null when neither release nor debug exists in dev mode', () => {
    mockExistsSync.mockReturnValue(false);
    const binaryPath = resolveIntentdBinaryPath({}, false, '/resources', '/monorepo');
    expect(binaryPath).toBeNull();
  });

  it('probes upward from cwd to locate packages/intentd/target when Electron cwd is a subdir', () => {
    const binaryName = process.platform === 'win32' ? 'intentd.exe' : 'intentd';
    const expectedPath = path.join('/monorepo/packages/intentd/target/release', binaryName);
    mockExistsSync.mockImplementation((probe) => probe === expectedPath);
    // Electron launched from packages/cloudlands-fe: cwd is a nested subdir.
    const binaryPath = resolveIntentdBinaryPath(
      {},
      false,
      '/resources',
      '/monorepo/packages/cloudlands-fe',
    );
    expect(binaryPath).toBe(expectedPath);
  });

  it('probes upward to find the debug binary when release is absent', () => {
    const binaryName = process.platform === 'win32' ? 'intentd.exe' : 'intentd';
    const expectedPath = path.join('/monorepo/packages/intentd/target/debug', binaryName);
    mockExistsSync.mockImplementation((probe) => probe === expectedPath);
    const binaryPath = resolveIntentdBinaryPath(
      {},
      false,
      '/resources',
      '/monorepo/packages/cloudlands-fe/src/main',
    );
    expect(binaryPath).toBe(expectedPath);
  });
});

describe('resolveSocketPath', () => {
  it('returns INTENTD_DATA_DIR/intentd.sock when INTENTD_DATA_DIR is set', () => {
    const socketPath = resolveSocketPath({ INTENTD_DATA_DIR: '/custom/data' });
    expect(socketPath).toBe('/custom/data/intentd.sock');
  });

  it('returns default macOS path when INTENTD_DATA_DIR is not set', () => {
    const socketPath = resolveSocketPath({});
    const expected = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'intentd',
      'intentd.sock',
    );
    expect(socketPath).toBe(expected);
  });

  it('trims INTENTD_DATA_DIR whitespace', () => {
    const socketPath = resolveSocketPath({ INTENTD_DATA_DIR: '  /custom/data  ' });
    expect(socketPath).toBe('/custom/data/intentd.sock');
  });

  it('ignores empty INTENTD_DATA_DIR and uses default', () => {
    const socketPath = resolveSocketPath({ INTENTD_DATA_DIR: '   ' });
    const expected = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'intentd',
      'intentd.sock',
    );
    expect(socketPath).toBe(expected);
  });
});

/** Start a mock UDS daemon that answers system.status with the given result. */
function startMockDaemon(
  socketPath: string,
  behavior:
    | { kind: 'result'; result: Record<string, unknown> }
    | { kind: 'garbage' }
    | { kind: 'silent' },
): Promise<net.Server> {
  const server = net.createServer((conn) => {
    conn.on('data', () => {
      if (behavior.kind === 'silent') return;
      if (behavior.kind === 'garbage') {
        conn.write('not json\n');
        return;
      }
      conn.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: behavior.result }) + '\n');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve(server));
  });
}

describe('probeDaemonVersion', () => {
  const mockExistsSync = vi.mocked(fs.existsSync);
  let tmpDir: string;
  let server: net.Server | null = null;

  beforeEach(() => {
    mockExistsSync.mockImplementation(actualFs.existsSync);
    tmpDir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'intentd-probe-'));
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    actualFs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns alive with version and protocolVersion from system.status', async () => {
    const socketPath = path.join(tmpDir, 'i.sock');
    server = await startMockDaemon(socketPath, {
      kind: 'result',
      result: { running: true, version: '0.1.0', protocolVersion: '1' },
    });
    const probe = await probeDaemonVersion(socketPath);
    expect(probe).toEqual({ alive: true, version: '0.1.0', protocolVersion: '1' });
  });

  it('returns alive without versions when the response lacks them', async () => {
    const socketPath = path.join(tmpDir, 'i.sock');
    server = await startMockDaemon(socketPath, { kind: 'result', result: { running: true } });
    const probe = await probeDaemonVersion(socketPath);
    expect(probe).toEqual({ alive: true, version: undefined, protocolVersion: undefined });
  });

  it('returns alive when the daemon responds with unparsable data', async () => {
    const socketPath = path.join(tmpDir, 'i.sock');
    server = await startMockDaemon(socketPath, { kind: 'garbage' });
    const probe = await probeDaemonVersion(socketPath);
    expect(probe).toEqual({ alive: true });
  });

  it('returns not alive when the socket file does not exist', async () => {
    const probe = await probeDaemonVersion(path.join(tmpDir, 'missing.sock'));
    expect(probe).toEqual({ alive: false });
  });

  it('returns not alive when the socket exists but nothing accepts connections', async () => {
    const socketPath = path.join(tmpDir, 'stale.sock');
    actualFs.writeFileSync(socketPath, '');
    const probe = await probeDaemonVersion(socketPath, 500);
    expect(probe.alive).toBe(false);
  });

  it('resolves alive on timeout only if data arrived without a newline', async () => {
    const socketPath = path.join(tmpDir, 'i.sock');
    server = await startMockDaemon(socketPath, { kind: 'silent' });
    const probe = await probeDaemonVersion(socketPath, 300);
    expect(probe).toEqual({ alive: false });
  });
});

/** Fake ChildProcess with emitter-backed stdout/stderr for run-log capture tests. */
class FakeSidecarProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  pid: number | undefined = 4242;
  kill = vi.fn(() => true);
}

describe('sidecar run-log capture (backend:get-sidecar-run-log contract)', () => {
  const mockExistsSync = vi.mocked(fs.existsSync);
  const mockSpawn = vi.mocked(spawn);

  /** Spawn via startIntentdSidecar with a fake process; probe finds no daemon. */
  async function startWithFakeProc(): Promise<FakeSidecarProcess> {
    const proc = new FakeSidecarProcess();
    mockSpawn.mockReturnValueOnce(proc as never);
    await startIntentdSidecar(
      { INTENTD_SIDECAR: '1', INTENTD_BIN: '/fake/intentd' },
      false,
      '/resources',
      '/cwd',
    );
    return proc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetIntentdSidecarForTesting();
    __resetConnectionModeForTesting();
    // Binary "exists"; socket does not (probe reports no live daemon).
    mockExistsSync.mockImplementation((p) => !String(p).endsWith('.sock'));
  });

  afterEach(() => {
    __resetIntentdSidecarForTesting();
    __resetConnectionModeForTesting();
    vi.clearAllMocks();
  });

  it('reports available:false with null fields before any run', () => {
    expect(getSidecarRunLog()).toEqual({
      available: false,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      signal: null,
      spawnError: null,
      lines: [],
    });
  });

  it('captures the combined stdout+stderr tail for the current run', async () => {
    const proc = await startWithFakeProc();
    proc.stdout.emit('data', Buffer.from('hello\nworld\n'));
    proc.stderr.emit('data', Buffer.from('oops\n'));

    const log = getSidecarRunLog();
    expect(log.available).toBe(true);
    expect(typeof log.startedAt).toBe('string');
    expect(log.endedAt).toBeNull();
    expect(log.exitCode).toBeNull();
    expect(log.signal).toBeNull();
    expect(log.spawnError).toBeNull();
    expect(log.lines).toEqual(['hello', 'world', 'oops']);
  });

  it('caps the tail at the last 400 lines', async () => {
    const proc = await startWithFakeProc();
    for (let i = 1; i <= 450; i++) {
      proc.stdout.emit('data', Buffer.from(`line-${i}\n`));
    }

    const log = getSidecarRunLog();
    expect(log.lines).toHaveLength(400);
    expect(log.lines[0]).toBe('line-51');
    expect(log.lines[399]).toBe('line-450');
  });

  it('records endedAt/exitCode/signal when the process exits', async () => {
    const proc = await startWithFakeProc();
    proc.stdout.emit('data', Buffer.from('starting\n'));
    proc.emit('exit', 3, null);

    const log = getSidecarRunLog();
    expect(log.endedAt).not.toBeNull();
    expect(log.exitCode).toBe(3);
    expect(log.signal).toBeNull();
    expect(log.lines).toEqual(['starting']);
  });

  it('starts a fresh record on respawn (rollover) while retaining the old one until then', async () => {
    const proc1 = await startWithFakeProc();
    proc1.stdout.emit('data', Buffer.from('first-run\n'));
    expect(getSidecarRunLog().lines).toEqual(['first-run']);

    const proc2 = await startWithFakeProc();
    expect(getSidecarRunLog().lines).toEqual([]);
    expect(getSidecarRunLog().endedAt).toBeNull();

    proc2.stdout.emit('data', Buffer.from('second-run\n'));
    expect(getSidecarRunLog().lines).toEqual(['second-run']);
  });

  it('records spawnError and fires onSidecarStartupFailed when the binary is not found', async () => {
    mockExistsSync.mockReturnValue(false);
    const failed = vi.fn();
    onSidecarStartupFailed(failed);

    await startIntentdSidecar({ INTENTD_SIDECAR: '1' }, false, '/resources', '/cwd');

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith('intentd binary not found');
    const log = getSidecarRunLog();
    expect(log.available).toBe(true);
    expect(log.spawnError).toBe('intentd binary not found');
    expect(log.endedAt).toBe(log.startedAt);
    expect(log.lines).toEqual([]);
  });

  it('records spawnError and fires onSidecarStartupFailed on a spawn-time process error', async () => {
    const failed = vi.fn();
    onSidecarStartupFailed(failed);

    const proc = await startWithFakeProc();
    proc.pid = undefined;
    proc.emit('error', new Error('spawn ENOENT'));

    expect(failed).toHaveBeenCalledWith('spawn ENOENT');
    const log = getSidecarRunLog();
    expect(log.spawnError).toBe('spawn ENOENT');
    expect(log.endedAt).not.toBeNull();
  });
});
