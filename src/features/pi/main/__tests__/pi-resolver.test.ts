/**
 * Tests for pi-resolver module: `pi` engine detection, cache clearing, and
 * the pi-mcp-adapter install/probe helpers.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: vi.fn(),
  getCommonNpmPaths: vi.fn(() => []),
}));

vi.mock('../../../../shared/main/host-exec', () => ({
  hostExec: vi.fn(),
}));

import { findBinary } from '../../../../shared/main/find-binary';
import { hostExec } from '../../../../shared/main/host-exec';
import {
  clearPiCache,
  isPiInstalled,
  getPiPath,
  isPiMcpAdapterInstalled,
  installPiMcpAdapter,
} from '../pi-resolver';


describe('pi-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPiCache();
  });

  describe('clearPiCache()', () => {
    it('clears the cached pi path so re-detection uses new values', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/first/pi';
        return null;
      });

      expect(await getPiPath()).toBe('/first/pi');

      clearPiCache();
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/second/pi';
        return null;
      });

      expect(await getPiPath()).toBe('/second/pi');
    });
  });

  describe('isPiInstalled()', () => {
    it('returns true when the pi engine is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/usr/local/bin/pi';
        return null;
      });

      expect(await isPiInstalled()).toBe(true);
    });

    it('returns false when the pi engine is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);
      expect(await isPiInstalled()).toBe(false);
    });
  });

  describe('getPiPath()', () => {
    it('returns the path when the pi engine is found', async () => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'pi') return '/usr/local/bin/pi';
        return null;
      });

      expect(await getPiPath()).toBe('/usr/local/bin/pi');
    });

    it('returns null when the pi engine is not found', async () => {
      vi.mocked(findBinary).mockResolvedValue(null);
      expect(await getPiPath()).toBeNull();
    });
  });
});

// The pi registry row (id/command/canBeDisabled/isDefault) is compiled into
// the intentd daemon and served via providers.catalog (PROTOCOL §5.38); its
// shape is pinned by the daemon's own tests, not by FE snapshots.


describe('isPiMcpAdapterInstalled (host.exec seam)', () => {
  const ORIGINAL_PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    clearPiCache();
    // Point at a non-existent dir so the settings-file fast-path misses and
    // falls through to the `pi list` probe under test.
    process.env.PI_CODING_AGENT_DIR = '/nonexistent-pi-agent-dir-for-test';
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'pi') return '/usr/local/bin/pi';
      return null;
    });
  });

  afterEach(() => {
    if (ORIGINAL_PI_AGENT_DIR === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = ORIGINAL_PI_AGENT_DIR;
    }
  });

  it('routes `pi list` through host.exec with argv + timeout', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: 'installed:\n  pi-mcp-adapter@1.2.3\n',
      stderr: '',
      exitCode: 0,
    });

    const installed = await isPiMcpAdapterInstalled();

    expect(hostExec).toHaveBeenCalledWith('/usr/local/bin/pi', {
      args: ['list'],
      timeoutMs: 10_000,
    });
    expect(installed).toBe(true);
  });

  it('returns false when host.exec reports a non-zero exit code', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: 'boom',
      exitCode: 1,
    });

    expect(await isPiMcpAdapterInstalled()).toBe(false);
  });

  it('returns false when the host.exec probe times out', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 124,
      timedOut: true,
    });

    expect(await isPiMcpAdapterInstalled()).toBe(false);
  });

  it('returns false when host.exec throws (RPC failure)', async () => {
    vi.mocked(hostExec).mockRejectedValue(new Error('rpc down'));

    expect(await isPiMcpAdapterInstalled()).toBe(false);
  });
});

describe('installPiMcpAdapter (host.exec seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPiCache();
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'pi') return '/usr/local/bin/pi';
      return null;
    });
  });

  it('routes `pi install <adapter>` through host.exec with argv + timeout', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    });

    const result = await installPiMcpAdapter();

    expect(hostExec).toHaveBeenCalledWith('/usr/local/bin/pi', {
      args: ['install', 'npm:pi-mcp-adapter'],
      timeoutMs: 120_000,
    });
    expect(result).toEqual({ success: true });
  });

  it('surfaces stderr when host.exec reports a non-zero exit code', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: 'permission denied',
      exitCode: 1,
    });

    const result = await installPiMcpAdapter();
    expect(result.success).toBe(false);
    expect(result.error).toContain('permission denied');
  });

  it('reports timeout when host.exec times out', async () => {
    vi.mocked(hostExec).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 124,
      timedOut: true,
    });

    const result = await installPiMcpAdapter();
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('honest-degrades when host.exec throws (RPC failure)', async () => {
    vi.mocked(hostExec).mockRejectedValue(new Error('rpc down'));

    const result = await installPiMcpAdapter();
    expect(result.success).toBe(false);
    expect(result.error).toContain('rpc down');
  });

  it('returns error when pi engine is not found', async () => {
    vi.mocked(findBinary).mockResolvedValue(null);

    const result = await installPiMcpAdapter();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Pi CLI not found. Please install Pi first.');
    expect(hostExec).not.toHaveBeenCalled();
  });
});
