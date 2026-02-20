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
// shouldIgnore integration tests
//
// These test the gitignore filtering logic end-to-end by mocking IPC calls
// and verifying which files appear in the loaded tree.
// ---------------------------------------------------------------------------

/** Helper: create a mock dir entry as returned by file:readDirWithStats */
function mockEntry(name: string, isDirectory = false) {
  return { name, isDirectory, isFile: !isDirectory, size: 100, modified: '2025-01-01T00:00:00Z' };
}

/**
 * Helper: set up IPC mocks and load a workspace, returning visible file names.
 *
 * @param gitignorePatterns - patterns the mock .gitignore contains
 * @param dirEntries        - entries returned by readDirWithStats
 * @param workspacePath     - workspace root (default '/workspace')
 */
async function getVisibleNames(
  gitignorePatterns: string[],
  dirEntries: ReturnType<typeof mockEntry>[],
  workspacePath = '/workspace',
): Promise<string[]> {
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

  const children = store.rootNode?.children ?? [];
  return children.map((n) => n.name);
}

describe('shouldIgnore — gitignore semantics', () => {
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
    const promise = getVisibleNames(patterns, entries, workspacePath);
    // Flush the 200ms delay inside setWorkspacePath
    await vi.advanceTimersByTimeAsync(300);
    return promise;
  }

  it('should hide default-ignored files (node_modules, dist, .DS_Store, etc.)', async () => {
    const entries = [
      mockEntry('src', true),
      mockEntry('node_modules', true),
      mockEntry('dist', true),
      mockEntry('.DS_Store'),
      mockEntry('Thumbs.db'),
      mockEntry('package.json'),
      mockEntry('debug.log'),
    ];

    const visible = await loadWithTimers([], entries);

    expect(visible).toContain('src');
    expect(visible).toContain('package.json');
    expect(visible).not.toContain('node_modules');
    expect(visible).not.toContain('dist');
    expect(visible).not.toContain('.DS_Store');
    expect(visible).not.toContain('Thumbs.db');
    expect(visible).not.toContain('debug.log');
  });

  it('should allow negation patterns to override defaults (e.g. !dist)', async () => {
    const entries = [
      mockEntry('dist', true),
      mockEntry('build', true),
      mockEntry('src', true),
    ];

    // User's .gitignore negates dist
    const visible = await loadWithTimers(['!dist'], entries);

    expect(visible).toContain('dist');
    expect(visible).toContain('src');
    // build is still hidden by defaults
    expect(visible).not.toContain('build');
  });

  it('should respect last-match-wins for negation then re-ignore', async () => {
    const entries = [
      mockEntry('important.log'),
      mockEntry('debug.log'),
    ];

    // *.log is in defaults. User negates important.log, then re-ignores it.
    const visible = await loadWithTimers(
      ['!important.log', 'important.log'],
      entries,
    );

    // Both should be hidden: debug.log by default *.log, important.log re-ignored
    expect(visible).not.toContain('important.log');
    expect(visible).not.toContain('debug.log');
  });

  it('should hide .git unconditionally (even with negation)', async () => {
    const entries = [
      mockEntry('.git', true),
      mockEntry('src', true),
    ];

    // Even if user tries to negate .git, it should stay hidden
    const visible = await loadWithTimers(['!.git'], entries);

    expect(visible).not.toContain('.git');
    expect(visible).toContain('src');
  });

  it('should show dotfiles that are not in any ignore pattern', async () => {
    const entries = [
      mockEntry('.prettierrc'),
      mockEntry('.eslintrc.json'),
      mockEntry('.npmrc'),
      mockEntry('.gitignore'),
      mockEntry('.editorconfig'),
    ];

    const visible = await loadWithTimers([], entries);

    expect(visible).toContain('.prettierrc');
    expect(visible).toContain('.eslintrc.json');
    expect(visible).toContain('.npmrc');
    expect(visible).toContain('.gitignore');
    expect(visible).toContain('.editorconfig');
  });

  it('should hide dotfiles that ARE in gitignore patterns', async () => {
    const entries = [
      mockEntry('.env'),
      mockEntry('.env.local'),
      mockEntry('.env.example'),
      mockEntry('.npmrc'),
    ];

    // User's gitignore ignores .env and .env.local but negates .env.example
    const visible = await loadWithTimers(
      ['.env', '.env.local', '.env.example', '!.env.example'],
      entries,
    );

    expect(visible).not.toContain('.env');
    expect(visible).not.toContain('.env.local');
    expect(visible).toContain('.env.example');
    expect(visible).toContain('.npmrc');
  });

  it('should handle glob patterns from gitignore', async () => {
    const entries = [
      mockEntry('app.min.js'),
      mockEntry('app.js'),
      mockEntry('styles.min.css'),
      mockEntry('styles.css'),
    ];

    const visible = await loadWithTimers(['*.min.*'], entries);

    expect(visible).not.toContain('app.min.js');
    expect(visible).not.toContain('styles.min.css');
    expect(visible).toContain('app.js');
    expect(visible).toContain('styles.css');
  });

  it('should work with no gitignore file (empty patterns)', async () => {
    const entries = [
      mockEntry('src', true),
      mockEntry('node_modules', true),
      mockEntry('package.json'),
    ];

    const visible = await loadWithTimers([], entries);

    // Defaults still apply
    expect(visible).toContain('src');
    expect(visible).toContain('package.json');
    expect(visible).not.toContain('node_modules');
  });
});
