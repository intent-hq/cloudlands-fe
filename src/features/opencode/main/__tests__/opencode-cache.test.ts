/**
 * TTL-cache tests for the opencode model-list accessor.
 *
 * `getCachedOpencodeModels()` is shared between the IPC handler and the
 * main-side model-override validator; the cache keeps the shell-out to
 * `opencode models` from being triggered on every validation pass. These
 * tests mock `child_process.spawn` directly so we can count invocations and
 * verify that:
 *   1. A second call within the TTL reads from the cache (no new spawn).
 *   2. A call after the TTL expires returns stale data and refreshes in the background.
 *   3. A hard failure (exit 1) does NOT get cached (next call retries).
 *
 * The opencode IPC module owns the cache at module scope, so `vi.resetModules`
 * is used between tests to start each one with an empty cache.
 */

import { EventEmitter } from 'events';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockSpawn, mockResolveOpenCodeCommand, mockGetEnhancedPath } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockResolveOpenCodeCommand: vi.fn(),
  mockGetEnhancedPath: vi.fn(),
}));

vi.mock(import('child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual, spawn: mockSpawn };
  return { ...patched, default: patched };
});

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
// stubbing `resolveOpenCodeCommand` and `getEnhancedPath`. This mirrors how
// the production code path goes through opencode-resolver + host.env without
// touching the local filesystem.
vi.mock('../opencode-resolver', () => ({
  resolveOpenCodeCommand: mockResolveOpenCodeCommand,
}));

vi.mock('../../../../shared/main/find-binary', () => ({
  getEnhancedPath: mockGetEnhancedPath,
}));

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function queueSpawnSuccess(stdout: string): MockChild {
  const child = createMockChildProcess();
  mockSpawn.mockReturnValueOnce(child as any);
  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', 0);
  });
  return child;
}

function queueSpawnFailure(): MockChild {
  const child = createMockChildProcess();
  mockSpawn.mockReturnValueOnce(child as any);
  setImmediate(() => {
    child.stderr.emit('data', Buffer.from('boom'));
    child.emit('close', 1);
  });
  return child;
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
    mockSpawn.mockReset();
    mockResolveOpenCodeCommand.mockReset();
    mockResolveOpenCodeCommand.mockResolvedValue({
      command: '/mocked/opencode',
      argsPrefix: [],
      usesNpx: false,
    });
    mockGetEnhancedPath.mockReset();
    mockGetEnhancedPath.mockReturnValue('/mocked/enhanced/path');
    Date.now = originalNow;
  });

  afterAll(() => {
    Date.now = originalNow;
  });

  it('routes the opencode lookup through resolveOpenCodeCommand + getEnhancedPath (no local probing)', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueSpawnSuccess('openai/gpt-5.2\n');
    await getCachedOpencodeModels();

    expect(mockResolveOpenCodeCommand).toHaveBeenCalledTimes(1);
    expect(mockGetEnhancedPath).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [spawnCmd, spawnArgs, spawnOpts] = mockSpawn.mock.calls[0];
    expect(spawnCmd).toBe('/mocked/opencode');
    expect(spawnArgs).toEqual(['models', '--log-level', 'DEBUG']);
    expect((spawnOpts as { env: Record<string, string> }).env.PATH).toBe('/mocked/enhanced/path');
  });

  it('returns null when the resolver cannot find opencode (no client-side healing)', async () => {
    mockResolveOpenCodeCommand.mockResolvedValueOnce(null);
    const { getCachedOpencodeModels } = await loadFreshIpc();
    const result = await getCachedOpencodeModels();
    expect(result).toBeNull();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('reads from the in-memory cache on successive calls within the TTL', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueSpawnSuccess('openai/gpt-5.2\nanthropic/claude-sonnet-4\n');
    const first = await getCachedOpencodeModels();
    const second = await getCachedOpencodeModels();

    expect(first).toEqual(['openai/gpt-5.2', 'anthropic/claude-sonnet-4']);
    expect(second).toEqual(first);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('returns stale data and refreshes in the background after the TTL window expires', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueSpawnSuccess('openai/gpt-5.2\n');
    const before = await getCachedOpencodeModels();
    expect(before).toEqual(['openai/gpt-5.2']);

    const fixedLater = originalNow() + 6 * 60 * 1000;
    Date.now = () => fixedLater;

    queueSpawnSuccess('openai/gpt-5.3\n');
    const stale = await getCachedOpencodeModels();
    await new Promise((resolve) => setImmediate(resolve));
    const refreshed = await getCachedOpencodeModels();

    expect(stale).toEqual(['openai/gpt-5.2']);
    expect(refreshed).toEqual(['openai/gpt-5.3']);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('does not cache hard failures — the next call retries', async () => {
    const { getCachedOpencodeModels } = await loadFreshIpc();
    queueSpawnFailure();
    const failed = await getCachedOpencodeModels();
    expect(failed).toBeNull();

    queueSpawnSuccess('openai/gpt-5.2\n');
    const retried = await getCachedOpencodeModels();
    expect(retried).toEqual(['openai/gpt-5.2']);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });
});
