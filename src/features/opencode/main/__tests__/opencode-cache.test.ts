/**
 * TTL-cache tests for the opencode model-list accessor.
 *
 * `getCachedOpencodeModels()` is shared between the IPC handler and the
 * main-side model-override validator; the cache keeps the invocation to
 * `opencode models` from being triggered on every validation pass. These
 * tests mock the backend `host.exec` request (AUDIT-R1b: `executeOpencodeCommand`
 * now proxies through `hostExec` instead of `child_process.spawn`) so we can
 * count invocations and verify that:
 *   1. A second call within the TTL reads from the cache (no new exec).
 *   2. A call after the TTL expires returns stale data and refreshes in the background.
 *   3. A hard failure (non-zero exit) does NOT get cached (next call retries).
 *
 * The opencode IPC module owns the cache at module scope, so `vi.resetModules`
 * is used between tests to start each one with an empty cache.
 */

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockBackendRequest, mockResolveOpenCodeCommand } = vi.hoisted(() => ({
  mockBackendRequest: vi.fn(),
  mockResolveOpenCodeCommand: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    error = vi.fn();
    info = vi.fn();
    warn = vi.fn();
  },
}));

// Route opencode binary resolution through the daemon-backed seam in tests by
// stubbing `resolveOpenCodeCommand`. This mirrors how the production code path
// goes through opencode-resolver + host.env without touching the local filesystem.
vi.mock('../opencode-resolver', () => ({
  resolveOpenCodeCommand: mockResolveOpenCodeCommand,
}));

// AUDIT-R1b: `executeOpencodeCommand` calls `hostExec` -> `getBackendClient()
// .request('host.exec', ...)`. Stubbing the backend client lets us assert the
// exact wire shape sent for the `opencode models` invocation.
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockBackendRequest }),
}));

function queueExecSuccess(stdout: string): void {
  mockBackendRequest.mockResolvedValueOnce({ stdout, stderr: '', exitCode: 0 });
}

function queueExecFailure(): void {
  mockBackendRequest.mockResolvedValueOnce({ stdout: '', stderr: 'boom', exitCode: 1 });
}

/**
 * Fresh import of the opencode IPC module with an empty cache. Each test
 * calls this so the module-level cache is reset.
 */
async function loadFreshIpc(): Promise<{
  getCachedOpencodeModels: () => Promise<string[] | null>;
}> {
  vi.resetModules();
  return await import('../opencode.ipc');
}

describe('opencode model cache', () => {
  const originalNow = Date.now;

  beforeEach(() => {
    mockBackendRequest.mockReset();
    mockResolveOpenCodeCommand.mockReset();
    mockResolveOpenCodeCommand.mockResolvedValue({
      command: '/mocked/opencode',
      argsPrefix: [],
      usesNpx: false,
    });
    Date.now = originalNow;
  });

  afterAll(() => {
    Date.now = originalNow;
  });

  it('routes the opencode lookup through resolveOpenCodeCommand + host.exec (no local probing)', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueExecSuccess('openai/gpt-5.2\n');
    await getCachedOpencodeModels();

    expect(mockResolveOpenCodeCommand).toHaveBeenCalledTimes(1);
    expect(mockBackendRequest).toHaveBeenCalledTimes(1);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      'host.exec',
      expect.objectContaining({
        command: '/mocked/opencode',
        args: ['models', '--log-level', 'DEBUG'],
        timeoutMs: 10000,
      }),
    );
  });

  it('returns null when the resolver cannot find opencode (no client-side healing)', async () => {
    mockResolveOpenCodeCommand.mockResolvedValueOnce(null);
    const { getCachedOpencodeModels } = await loadFreshIpc();
    const result = await getCachedOpencodeModels();
    expect(result).toBeNull();
    expect(mockBackendRequest).not.toHaveBeenCalled();
  });

  it('reads from the in-memory cache on successive calls within the TTL', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueExecSuccess('openai/gpt-5.2\nanthropic/claude-sonnet-4\n');
    const first = await getCachedOpencodeModels();
    const second = await getCachedOpencodeModels();

    expect(first).toEqual(['openai/gpt-5.2', 'anthropic/claude-sonnet-4']);
    expect(second).toEqual(first);
    expect(mockBackendRequest).toHaveBeenCalledTimes(1);
  });

  it('returns stale data and refreshes in the background after the TTL window expires', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueExecSuccess('openai/gpt-5.2\n');
    const before = await getCachedOpencodeModels();
    expect(before).toEqual(['openai/gpt-5.2']);

    const fixedLater = originalNow() + 6 * 60 * 1000;
    Date.now = () => fixedLater;

    queueExecSuccess('openai/gpt-5.3\n');
    const stale = await getCachedOpencodeModels();
    await new Promise((resolve) => setImmediate(resolve));
    const refreshed = await getCachedOpencodeModels();

    expect(stale).toEqual(['openai/gpt-5.2']);
    expect(refreshed).toEqual(['openai/gpt-5.3']);
    expect(mockBackendRequest).toHaveBeenCalledTimes(2);
  });

  it('does not cache hard failures — the next call retries', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueExecFailure();
    const failed = await getCachedOpencodeModels();
    expect(failed).toBeNull();

    queueExecSuccess('openai/gpt-5.2\n');
    const retried = await getCachedOpencodeModels();
    expect(retried).toEqual(['openai/gpt-5.2']);
    expect(mockBackendRequest).toHaveBeenCalledTimes(2);
  });
});
