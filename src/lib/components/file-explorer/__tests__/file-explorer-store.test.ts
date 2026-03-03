import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFileExplorerStore } from '../file-explorer-store.svelte';
import * as electronBridge from '$lib/electron-bridge';

// Mock the electron-bridge module
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

// Mock the client-logger module
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('FileExplorerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create store without errors', () => {
    const store = createFileExplorerStore('/test/path');
    expect(store).toBeDefined();
    expect(store.initialize).toBeDefined();
    expect(store.refresh).toBeDefined();
    expect(store.toggleDirectory).toBeDefined();
  });

  it('should not attempt to listen for file-explorer:refresh event', () => {
    const store = createFileExplorerStore('/test/path');

    // The file-explorer:refresh listener should be commented out
    // so on() should not be called with 'file-explorer:refresh'
    const onMock = vi.mocked(electronBridge.on);
    const calls = onMock.mock.calls;
    const hasFileExplorerRefreshCall = calls.some((call) => call[0] === 'file-explorer:refresh');

    expect(hasFileExplorerRefreshCall).toBe(false);
  });

  it('should have refresh method that works without IPC events', async () => {
    const invokeMock = vi.mocked(electronBridge.invoke);
    invokeMock.mockResolvedValue({ success: true, data: { fileStatuses: {}, fileChanges: {} } });

    const store = createFileExplorerStore('/test/path');
    store.setWorkspacePath('/test/path');

    // Refresh should work without relying on IPC events
    await expect(store.refresh()).resolves.not.toThrow();
  });

  it('should handle workspace path changes', async () => {
    const invokeMock = vi.mocked(electronBridge.invoke);
    // Mock the file:list response
    invokeMock.mockResolvedValue({
      success: true,
      data: [],
    });

    const store = createFileExplorerStore('/test/path');
    const testPath = '/test/workspace/path';

    store.setWorkspacePath(testPath);

    // Store should update with new path
    expect(store).toBeDefined();
  });

  it('should handle git status loading', async () => {
    const invokeMock = vi.mocked(electronBridge.invoke);
    const mockGitStatus = {
      success: true,
      data: {
        fileStatuses: {
          'file1.ts': 'M ',
          'file2.ts': 'A ',
        },
        fileChanges: {
          'file1.ts': { additions: 10, deletions: 5 },
          'file2.ts': { additions: 20, deletions: 0 },
        },
      },
    };

    invokeMock.mockResolvedValue(mockGitStatus);

    const store = createFileExplorerStore('/test/path');
    store.setWorkspacePath('/test/path');

    // Git status should load without errors
    await expect(store.refresh()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Gitignore / shouldHide integration tests
//
// These test the gitignore filtering logic end-to-end by mocking IPC calls
// and verifying which files appear in the loaded tree and their isGitignored state.
//
// Gitignored files are shown in the tree (dimmed) but marked with isGitignored: true.
// Only ALWAYS_HIDE entries (e.g. .git) are completely removed from the tree.
// ---------------------------------------------------------------------------

/** Helper: create a mock dir entry as returned by file:readDirWithStats */
function mockEntry(name: string, isDirectory = false) {
  return { name, isDirectory, isFile: !isDirectory, size: 100, modified: '2025-01-01T00:00:00Z' };
}

/**
 * Helper: set up IPC mocks and load a workspace, returning the children nodes.
 *
 * @param gitignorePatterns - patterns the mock .gitignore contains
 * @param dirEntries        - entries returned by readDirWithStats
 * @param workspacePath     - workspace root (default '/workspace')
 */
async function getLoadedChildren(
  gitignorePatterns: string[],
  dirEntries: ReturnType<typeof mockEntry>[],
  workspacePath = '/workspace',
) {
  const invokeMock = vi.mocked(electronBridge.invoke);

  invokeMock.mockImplementation(async (channel: string, ..._args: unknown[]) => {
    if (channel === 'file:getGitignorePatterns') {
      return { success: true, data: gitignorePatterns };
    }
    if (channel === 'file:readDirWithStats') {
      return { success: true, data: dirEntries };
    }
    if (channel === 'file:getGitStatus') {
      return { success: true, data: { fileStatuses: {}, fileChanges: {} } };
    }
    if (channel === 'workspace:get') {
      return { ok: true, data: {} };
    }
    // Default for any other channel
    return { success: true, data: [] };
  });

  const store = createFileExplorerStore(workspacePath);
  await store.setWorkspacePath(workspacePath);

  return store.rootNode?.children ?? [];
}

describe('gitignore semantics — shouldHide + isGitignored', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Advance past the 200ms delay in setWorkspacePath
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Wrap setWorkspacePath calls so the 200ms setTimeout resolves
  async function loadWithTimers(
    patterns: string[],
    entries: ReturnType<typeof mockEntry>[],
    workspacePath = '/workspace',
  ) {
    const promise = getLoadedChildren(patterns, entries, workspacePath);
    // Flush the 200ms delay inside setWorkspacePath
    await vi.advanceTimersByTimeAsync(300);
    return promise;
  }

  it('should show default-ignored files as gitignored (dimmed), not hidden', async () => {
    const entries = [
      mockEntry('src', true),
      mockEntry('node_modules', true),
      mockEntry('dist', true),
      mockEntry('.DS_Store'),
      mockEntry('Thumbs.db'),
      mockEntry('package.json'),
      mockEntry('debug.log'),
    ];

    const children = await loadWithTimers([], entries);
    const names = children.map((n) => n.name);

    // All files should be visible in the tree
    expect(names).toContain('src');
    expect(names).toContain('package.json');
    expect(names).toContain('node_modules');
    expect(names).toContain('dist');
    expect(names).toContain('.DS_Store');
    expect(names).toContain('Thumbs.db');
    expect(names).toContain('debug.log');

    // But default-ignored ones should be marked as gitignored
    const byName = (name: string) => children.find((n) => n.name === name)!;
    expect(byName('node_modules').isGitignored).toBe(true);
    expect(byName('dist').isGitignored).toBe(true);
    expect(byName('.DS_Store').isGitignored).toBe(true);
    expect(byName('Thumbs.db').isGitignored).toBe(true);
    expect(byName('debug.log').isGitignored).toBe(true);

    // Non-ignored ones should NOT be marked
    expect(byName('src').isGitignored).toBeFalsy();
    expect(byName('package.json').isGitignored).toBeFalsy();
  });

  it('should allow negation patterns to override defaults (e.g. !dist)', async () => {
    const entries = [
      mockEntry('dist', true),
      mockEntry('build', true),
      mockEntry('src', true),
    ];

    // User's .gitignore negates dist
    const children = await loadWithTimers(['!dist'], entries);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(byName('dist').isGitignored).toBeFalsy();
    expect(byName('src').isGitignored).toBeFalsy();
    // build is still gitignored by defaults
    expect(byName('build').isGitignored).toBe(true);
  });

  it('should respect last-match-wins for negation then re-ignore', async () => {
    const entries = [
      mockEntry('important.log'),
      mockEntry('debug.log'),
    ];

    // *.log is in defaults. User negates important.log, then re-ignores it.
    const children = await loadWithTimers(
      ['!important.log', 'important.log'],
      entries,
    );
    const byName = (name: string) => children.find((n) => n.name === name)!;

    // Both should be gitignored: debug.log by default *.log, important.log re-ignored
    expect(byName('important.log').isGitignored).toBe(true);
    expect(byName('debug.log').isGitignored).toBe(true);
  });

  it('should completely hide .git (even with negation) — not just dim it', async () => {
    const entries = [
      mockEntry('.git', true),
      mockEntry('src', true),
    ];

    // Even if user tries to negate .git, it should stay completely hidden
    const children = await loadWithTimers(['!.git'], entries);
    const names = children.map((n) => n.name);

    expect(names).not.toContain('.git');
    expect(names).toContain('src');
  });

  it('should show dotfiles that are not in any ignore pattern (not gitignored)', async () => {
    const entries = [
      mockEntry('.prettierrc'),
      mockEntry('.eslintrc.json'),
      mockEntry('.npmrc'),
      mockEntry('.gitignore'),
      mockEntry('.editorconfig'),
    ];

    const children = await loadWithTimers([], entries);

    for (const child of children) {
      expect(child.isGitignored).toBeFalsy();
    }
  });

  it('should mark dotfiles in gitignore as gitignored, respect negation', async () => {
    const entries = [
      mockEntry('.env'),
      mockEntry('.env.local'),
      mockEntry('.env.example'),
      mockEntry('.npmrc'),
    ];

    // User's gitignore ignores .env and .env.local but negates .env.example
    const children = await loadWithTimers(
      ['.env', '.env.local', '.env.example', '!.env.example'],
      entries,
    );
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(byName('.env').isGitignored).toBe(true);
    expect(byName('.env.local').isGitignored).toBe(true);
    expect(byName('.env.example').isGitignored).toBeFalsy();
    expect(byName('.npmrc').isGitignored).toBeFalsy();
  });

  it('should handle glob patterns from gitignore', async () => {
    const entries = [
      mockEntry('app.min.js'),
      mockEntry('app.js'),
      mockEntry('styles.min.css'),
      mockEntry('styles.css'),
    ];

    const children = await loadWithTimers(['*.min.*'], entries);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(byName('app.min.js').isGitignored).toBe(true);
    expect(byName('styles.min.css').isGitignored).toBe(true);
    expect(byName('app.js').isGitignored).toBeFalsy();
    expect(byName('styles.css').isGitignored).toBeFalsy();
  });

  it('should apply default ignores even with no gitignore file (empty patterns)', async () => {
    const entries = [
      mockEntry('src', true),
      mockEntry('node_modules', true),
      mockEntry('package.json'),
    ];

    const children = await loadWithTimers([], entries);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    // All should be in the tree
    expect(children.map((n) => n.name)).toContain('node_modules');

    // Defaults still mark node_modules as gitignored
    expect(byName('node_modules').isGitignored).toBe(true);
    expect(byName('src').isGitignored).toBeFalsy();
    expect(byName('package.json').isGitignored).toBeFalsy();
  });
});
