import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for find-binary.ts.
 *
 * Per PROTOCOL.md §5.14, all binary/PATH discovery is delegated to the daemon
 * via `host.findBinary` / `host.env`. These tests assert the exact request
 * shape sent on the wire and feed back PROTOCOL-shaped mock responses.
 */

const { backendMocks, mockRequest, loggerSpies } = vi.hoisted(() => {
  const request = vi.fn();
  return {
    backendMocks: {
      client: { request },
      reconnectHandler: undefined as (() => void) | undefined,
    },
    mockRequest: request,
    loggerSpies: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../../../features/backend/main/backend.ipc', () => ({
  getBackendClient: () => backendMocks.client,
  onBackendReconnected: (handler: () => void) => {
    backendMocks.reconnectHandler = handler;
    return () => {};
  },
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
  FIND_BINARY_NEGATIVE_TTL_MS,
  FIND_BINARY_POSITIVE_TTL_MS,
  findBinary,
  findBinaryStrict,
  getCachedHostEnv,
  getCommonNpmPaths,
  getCommonNpxPaths,
  getEnhancedPath,
  initializeHostEnv,
  invalidateHostDiscoveryCache,
} from '../find-binary';
import { JsonRpcError } from '../../../features/backend/main/json-rpc-errors';

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('findBinary (host.findBinary wire contract)', () => {
  beforeEach(() => {
    backendMocks.client = { request: mockRequest };
    mockRequest.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
    invalidateHostDiscoveryCache();
    process.env = { ...originalEnv };
    setPlatform(originalPlatform);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('caches a positive probe for 5 seconds', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    mockRequest.mockResolvedValue({ available: true, path: '/usr/local/bin/foo' });

    expect(await findBinary('foo')).toBe('/usr/local/bin/foo');
    now.mockReturnValue(1_000 + FIND_BINARY_POSITIVE_TTL_MS - 1);
    expect(await findBinary('foo')).toBe('/usr/local/bin/foo');

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('caches an authoritative negative probe for 1 second', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    mockRequest.mockResolvedValue({ available: false });

    expect(await findBinary('foo')).toBeNull();
    now.mockReturnValue(1_000 + FIND_BINARY_NEGATIVE_TTL_MS - 1);
    expect(await findBinary('foo')).toBeNull();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('force refresh bypasses a negative TTL and observes a newly available binary', async () => {
    mockRequest
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValueOnce({ available: true, path: '/refreshed/foo' });

    const first = await findBinary('foo');
    const second = await findBinary('foo', { forceRefresh: true });

    expect(first).toBeNull();
    expect(second).toBe('/refreshed/foo');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('shares one request across concurrent identical normalized probes', async () => {
    let resolveProbe!: (value: { available: boolean; path: string }) => void;
    mockRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const first = findBinary('foo', { commonPaths: ['/a/foo', '/a/foo'] });
    const second = findBinaryStrict('foo', { commonPaths: ['/a/foo'] });
    resolveProbe({ available: true, path: '/a/foo' });

    await expect(Promise.all([first, second])).resolves.toEqual(['/a/foo', '/a/foo']);
    expect(mockRequest).toHaveBeenCalledTimes(1);
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

  it('invalidates cached probes when the backend client identity changes', async () => {
    mockRequest.mockResolvedValueOnce({ available: false });
    expect(await findBinary('foo')).toBeNull();

    const replacementRequest = vi.fn().mockResolvedValue({
      available: true,
      path: '/replacement/foo',
    });
    backendMocks.client = { request: replacementRequest };

    expect(await findBinary('foo')).toBe('/replacement/foo');
    expect(replacementRequest).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached probes on reconnect', async () => {
    mockRequest
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValueOnce({ available: true, path: '/reconnected/foo' });
    expect(await findBinary('foo')).toBeNull();

    backendMocks.reconnectHandler?.();

    expect(await findBinary('foo')).toBe('/reconnected/foo');
  });
});

describe('findBinaryStrict (strict probe semantics)', () => {
  beforeEach(() => {
    backendMocks.client = { request: mockRequest };
    mockRequest.mockReset();
    loggerSpies.warn.mockReset();
    invalidateHostDiscoveryCache();
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
    backendMocks.client = { request: mockRequest };
    mockRequest.mockReset();
    invalidateHostDiscoveryCache();
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

  it('invalidates binary probes when the daemon PATH context changes', async () => {
    mockRequest
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValueOnce({
        path: '/new/bin',
        pathEntries: ['/new/bin'],
        enhancedPath: '/new/bin:/usr/bin',
        shell: '/bin/zsh',
        home: '/Users/test',
        varNames: ['PATH'],
      })
      .mockResolvedValueOnce({ available: true, path: '/new/bin/foo' });

    expect(await findBinary('foo')).toBeNull();
    await initializeHostEnv();

    expect(await findBinary('foo')).toBe('/new/bin/foo');
    expect(mockRequest).toHaveBeenCalledTimes(3);
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
