import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for find-binary.ts.
 *
 * Per PROTOCOL.md §5.14, all binary/PATH discovery is delegated to the daemon
 * via `host.findBinary` / `host.env`. These tests assert the exact request
 * shape sent on the wire and feed back PROTOCOL-shaped mock responses.
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

import {
  clearBinaryCache,
  findBinary,
  getCachedHostEnv,
  getCommonNpmPaths,
  getCommonNpxPaths,
  getEnhancedPath,
  initializeHostEnv,
} from '../find-binary';

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('findBinary (host.findBinary wire contract)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
    clearBinaryCache();
    process.env = { ...originalEnv };
    setPlatform(originalPlatform);
  });

  afterEach(() => {
    clearBinaryCache();
    process.env = { ...originalEnv };
    setPlatform(originalPlatform);
  });

  it('sends `host.findBinary` with just the name when no commonPaths are supplied', async () => {
    mockRequest.mockResolvedValue({ available: true, path: '/usr/local/bin/foo' });

    const result = await findBinary('foo', { cache: false });

    expect(result).toBe('/usr/local/bin/foo');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('host.findBinary', { name: 'foo' });
  });

  it('forwards `commonPaths` verbatim to the daemon', async () => {
    mockRequest.mockResolvedValue({ available: true, path: '/custom/foo' });

    const result = await findBinary('foo', {
      cache: false,
      commonPaths: ['/custom/foo', '/other/foo', '/custom/foo'],
    });

    expect(result).toBe('/custom/foo');
    expect(mockRequest).toHaveBeenCalledWith('host.findBinary', {
      name: 'foo',
      commonPaths: ['/custom/foo', '/other/foo'],
    });
  });

  it('returns null when the daemon reports the binary as unavailable', async () => {
    mockRequest.mockResolvedValue({ available: false });

    const result = await findBinary('foo', { cache: false });

    expect(result).toBeNull();
    expect(mockRequest).toHaveBeenCalledWith('host.findBinary', { name: 'foo' });
  });

  it('rejects unsafe binary names before touching the wire', async () => {
    const result = await findBinary('foo; rm -rf /');

    expect(result).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(loggerSpies.warn).toHaveBeenCalledWith('Invalid binary name rejected', {
      name: 'foo; rm -rf /',
    });
  });

  it('caches resolved paths per (name, commonPaths) so a second lookup is wire-free', async () => {
    mockRequest.mockResolvedValue({ available: true, path: '/usr/local/bin/foo' });

    const first = await findBinary('foo');
    const second = await findBinary('foo');

    expect(first).toBe('/usr/local/bin/foo');
    expect(second).toBe(first);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps cache entries separate for different commonPaths sets', async () => {
    mockRequest
      .mockResolvedValueOnce({ available: true, path: '/usr/local/bin/foo' })
      .mockResolvedValueOnce({ available: true, path: '/opt/homebrew/bin/foo' });

    const a = await findBinary('foo', { commonPaths: ['/a/foo'] });
    const b = await findBinary('foo', { commonPaths: ['/b/foo'] });

    expect(a).toBe('/usr/local/bin/foo');
    expect(b).toBe('/opt/homebrew/bin/foo');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('clearBinaryCache(name) drops every cached variant for that binary', async () => {
    mockRequest
      .mockResolvedValueOnce({ available: true, path: '/first/foo' })
      .mockResolvedValueOnce({ available: true, path: '/refreshed/foo' });

    await findBinary('foo');
    clearBinaryCache('foo');
    const refreshed = await findBinary('foo');

    expect(refreshed).toBe('/refreshed/foo');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('returns null and caches the miss when the daemon request rejects', async () => {
    mockRequest.mockRejectedValue(new Error('transport down'));

    const first = await findBinary('foo');
    const second = await findBinary('foo');

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('initializeHostEnv / getEnhancedPath (host.env wire contract)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    clearBinaryCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sends `host.env` (no params) and caches the response', async () => {
    const mockEnv = {
      path: '/usr/local/bin:/usr/bin:/bin',
      pathEntries: ['/usr/local/bin', '/usr/bin', '/bin'],
      enhancedPath: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',
      shell: '/bin/zsh',
      home: '/Users/test',
      varNames: ['PATH', 'SHELL', 'HOME'],
    };
    mockRequest.mockResolvedValue(mockEnv);

    const result = await initializeHostEnv();

    expect(mockRequest).toHaveBeenCalledWith('host.env');
    expect(result).toEqual(mockEnv);
    expect(getCachedHostEnv()).toEqual(mockEnv);
    expect(getEnhancedPath()).toBe(mockEnv.enhancedPath);
  });

  it('retries while the sidecar is starting', async () => {
    const mockEnv = {
      path: '/usr/bin:/bin',
      pathEntries: ['/usr/bin', '/bin'],
      enhancedPath: '/usr/bin:/bin:/Users/test/.local/bin',
      shell: '/bin/zsh',
      home: '/Users/test',
      varNames: ['HOME', 'PATH'],
    };
    mockRequest.mockRejectedValueOnce(new Error('socket not ready')).mockResolvedValue(mockEnv);

    const result = await initializeHostEnv({ retryForMs: 100, retryDelayMs: 0 });

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result).toEqual(mockEnv);
    expect(getEnhancedPath()).toBe(mockEnv.enhancedPath);
  });

  it('falls back to process.env.PATH when host.env has not been seeded', async () => {
    // Reset the cached env by simulating a failed initialize call.
    mockRequest.mockRejectedValue(new Error('not connected'));
    await initializeHostEnv();
    process.env.PATH = '/local/only';

    expect(getEnhancedPath()).toBe('/local/only');
  });
});

describe('getCommonNpmPaths / getCommonNpxPaths (static hints)', () => {
  const savedPlatform = process.platform;
  afterEach(() => {
    setPlatform(savedPlatform);
  });

  it('returns POSIX candidates on darwin without touching the filesystem', () => {
    setPlatform('darwin');
    const paths = getCommonNpmPaths('foo');
    expect(paths).toContain('/usr/local/bin/foo');
    expect(paths).toContain('/opt/homebrew/bin/foo');
  });

  it('returns Windows candidates on win32 without touching the filesystem', () => {
    setPlatform('win32');
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    const paths = getCommonNpmPaths('foo');
    // path.join() uses the host OS's separator, so just assert that a
    // Windows-only candidate (foo.cmd) appears — the daemon does the actual
    // resolution on the target host.
    expect(paths.some((p) => p.endsWith('foo.cmd'))).toBe(true);
  });

  it('getCommonNpxPaths delegates to getCommonNpmPaths(npx)', () => {
    setPlatform('darwin');
    expect(getCommonNpxPaths()).toEqual(getCommonNpmPaths('npx'));
  });
});
