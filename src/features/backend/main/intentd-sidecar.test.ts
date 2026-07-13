/**
 * Unit tests for the intentd sidecar manager.
 *
 * Tests the spawn-policy decision function and binary path resolution across
 * all env combinations and dev/packaged modes.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveIntentdBinaryPath,
  resolveSocketPath,
  shouldSpawnSidecar,
} from './intentd-sidecar';

// Mock fs for binary path resolution tests
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
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


