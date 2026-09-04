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
  findBinary,
  findBinaryStrict,
  getCachedHostEnv,
  getCommonNpmPaths,
  getCommonNpxPaths,
  getEnhancedPath,
  initializeHostEnv,
} from '../find-binary';
import { JsonRpcError } from '../../../features/backend/main/json-rpc-errors';

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
    process.env = { ...originalEnv };
    setPlatform(originalPlatform);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setPlatform(originalPlatform);
  });

  it('sends `host.findBinary` with just the name when no commonPaths are supplied', async () => {
    mockRequest.mockResolvedValue({ available: true, path: '/usr/local/bin/foo' });

    const result = await findBinary('foo');

    expect(result).toBe('/usr/local/bin/foo');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('host.findBinary', { name: 'foo' });
  });

  it('forwards `commonPaths` verbatim to the daemon', async () => {
    mockRequest.mockResolvedValue({ available: true, path: '/custom/foo' });

    const result = await findBinary('foo', {
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

    const result = await findBinary('foo');

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

  it('never caches: every call issues a fresh wire request', async () => {
    mockRequest
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValueOnce({ available: true, path: '/refreshed/foo' });

    const first = await findBinary('foo');
    const second = await findBinary('foo');

    expect(first).toBeNull();
    expect(second).toBe('/refreshed/foo');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('returns null when the daemon request rejects, without caching the miss', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('transport down'))
      .mockResolvedValueOnce({ available: true, path: '/usr/local/bin/foo' });

    const first = await findBinary('foo');
    const second = await findBinary('foo');

    expect(first).toBeNull();
    expect(second).toBe('/usr/local/bin/foo');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});

describe('findBinaryStrict (strict probe semantics)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    loggerSpies.warn.mockReset();
  });

  it('sends the same host.findBinary request and returns the resolved path', async () => {
    mockRequest.mockResolvedValue({ available: true, path: '/usr/local/bin/foo' });

    const result = await findBinaryStrict('foo', { commonPaths: ['/custom/foo'] });

    expect(result).toBe('/usr/local/bin/foo');
    expect(mockRequest).toHaveBeenCalledWith('host.findBinary', {
      name: 'foo',
      commonPaths: ['/custom/foo'],
    });
  });

  it('returns null when the daemon authoritatively reports the binary unavailable', async () => {
    mockRequest.mockResolvedValue({ available: false });

    expect(await findBinaryStrict('foo')).toBeNull();
  });

  it('propagates a daemon RPC failure instead of folding it to null', async () => {
    // A rejected probe proves nothing about availability — strict callers
    // (availability checks) must be able to distinguish it from "not found".
    mockRequest.mockRejectedValue(new Error('transport down'));

    await expect(findBinaryStrict('foo')).rejects.toThrow('transport down');
  });

  it('treats available:true without a path as a probe failure, not "not found"', async () => {
    // A malformed/proxy-degraded response is not an authoritative
    // unavailable verdict — it must not fold to null.
    mockRequest.mockResolvedValue({ available: true });

    await expect(findBinaryStrict('foo')).rejects.toThrow('available:true without a path');
  });

  it('still rejects unsafe binary names locally with null (deterministic, not a probe failure)', async () => {
    const result = await findBinaryStrict('foo; rm -rf /');

    expect(result).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('initializeHostEnv / getEnhancedPath (host.env wire contract)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
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

  it('does not retry a JSON-RPC response error', async () => {
    mockRequest.mockRejectedValue(new JsonRpcError({ code: -32601, message: 'Method not found' }));

    const result = await initializeHostEnv({ retryForMs: 100, retryDelayMs: 0 });

    expect(result).toBeNull();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('ignores an in-flight response after startup aborts the request', async () => {
    const baseline = {
      path: '/usr/bin',
      pathEntries: ['/usr/bin'],
      enhancedPath: '/usr/bin:/baseline',
      shell: '/bin/zsh',
      home: '/Users/test',
      varNames: ['PATH'],
    };
    const late = { ...baseline, enhancedPath: '/usr/bin:/late' };
    mockRequest.mockResolvedValueOnce(baseline);
    await initializeHostEnv();

    let resolveLate!: (value: typeof late) => void;
    mockRequest.mockReturnValueOnce(new Promise((resolve) => (resolveLate = resolve)));
    const controller = new AbortController();
    const pending = initializeHostEnv({ retryForMs: 100, signal: controller.signal });
    controller.abort();
    resolveLate(late);

    expect(await pending).toBeNull();
    expect(getCachedHostEnv()).toEqual(baseline);
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
