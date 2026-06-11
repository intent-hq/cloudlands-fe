import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWatchEvent } from '../change-detection/file-watcher';

const mocks = vi.hoisted(() => ({
  sendToWorkspaceWindows: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  fileWatchers: [] as any[],
  changeProcessors: [] as any[],
  gitOpsInstances: [] as any[],
}));

const mockPerformanceMonitor = {
  start: vi.fn(),
  stop: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  incrementCounter: vi.fn(),
  recordChange: vi.fn(),
  recordEvent: vi.fn(),
  startTimer: vi.fn(),
  endTimer: vi.fn(() => 0),
  getMetrics: vi.fn(() => ({})),
};

const mockAdaptivePolling = {
  on: vi.fn(),
  off: vi.fn(),
  recordActivity: vi.fn(),
  getCurrentInterval: vi.fn(() => 15000),
};

vi.mock('../change-detection', () => {
  class MockEmitter {
    handlers = new Map<string, Function[]>();

    on(event: string, handler: Function) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    emit(event: string, payload?: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(payload);
      return true;
    }
  }

  class MockFileWatcher extends MockEmitter {
    constructor() {
      super();
      mocks.fileWatchers.push(this);
    }

    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    getStats = vi.fn(() => ({ isWatching: true, watchedPaths: 1 }));

    async emitAsync(event: string, payload: FileWatchEvent) {
      await Promise.all((this.handlers.get(event) ?? []).map((handler) => handler(payload)));
    }
  }

  class MockChangeProcessor extends MockEmitter {
    constructor() {
      super();
      mocks.changeProcessors.push(this);
    }

    initialize = vi.fn().mockResolvedValue(undefined);
    processFileChanges = vi.fn().mockResolvedValue([]);
    clearCache = vi.fn();
    destroy = vi.fn();
    getPendingCount = vi.fn(() => 0);
  }

  class MockEventCoordinator extends MockEmitter {
    handleChangesBatch = vi.fn().mockResolvedValue(undefined);
    flush = vi.fn().mockResolvedValue(undefined);
    destroy = vi.fn().mockResolvedValue(undefined);
    resetStats = vi.fn();
    getStats = vi.fn(() => ({ totalEvents: 0 }));
    getQueueSize = vi.fn(() => 0);
  }

  class MockSnapshotManager {
    takeSnapshots = vi.fn().mockResolvedValue(undefined);
    pruneOldSnapshots = vi.fn(() => 0);
    clearSnapshots = vi.fn();
    getSnapshotCount = vi.fn(() => 0);
  }

  return {
    FileWatcher: MockFileWatcher,
    ChangeProcessor: MockChangeProcessor,
    EventCoordinator: MockEventCoordinator,
    SnapshotManager: MockSnapshotManager,
  };
});

vi.mock('../change-detection/git-operations-safe-wrapper', () => ({
  GitOperationsSafe: class MockGitOperationsSafe {
    constructor() {
      mocks.gitOpsInstances.push(this);
    }

    invalidateCache = vi.fn();
    clearGitIgnoreCache = vi.fn();
    getStatus = vi.fn().mockResolvedValue({
      staged: [],
      stagedAdded: [],
      stagedDeleted: [],
      unstaged: [],
      untracked: [],
      deleted: [],
      renamed: new Map(),
    });
    getBatchDiffs = vi.fn().mockResolvedValue(new Map());
    getBatchDiffsStaged = vi.fn().mockResolvedValue(new Map());
    getFileAtHead = vi.fn().mockResolvedValue('');
  },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.readFile,
  stat: mocks.stat,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    default: { ...(actual.default ?? actual), existsSync: vi.fn(() => true) },
    existsSync: vi.fn(() => true),
  };
});

vi.mock('../../../file-tracking/performance-monitor', () => ({
  PerformanceMonitor: { getInstance: vi.fn(() => mockPerformanceMonitor) },
}));

vi.mock('../change-detection/adaptive-polling-manager', () => ({
  AdaptivePollingManager: { getInstance: vi.fn(() => mockAdaptivePolling) },
}));

vi.mock('../provenance/attribution-engine', () => ({
  getAttributionEngine: vi.fn(() => ({ getCurrentProvenance: vi.fn(() => null) })),
}));

import { ChangeDetectorRefactored } from '../change-detector-refactored';

function waitForAsyncHandlers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

async function waitForProcessedChanges(processor: any, changes: any[]): Promise<void> {
  await vi.waitFor(() => {
    expect(processor.processFileChanges).toHaveBeenCalledWith(changes);
  });
}

describe('ChangeDetectorRefactored content refresh emissions', () => {
  let detector: ChangeDetectorRefactored;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.fileWatchers.length = 0;
    mocks.changeProcessors.length = 0;
    mocks.gitOpsInstances.length = 0;
    mocks.stat.mockResolvedValue({ size: 12, mtimeMs: 1 });
    mocks.readFile.mockResolvedValue('updated content');
    detector = new ChangeDetectorRefactored({ workspaceId: 'ws-1', workspacePath: '/workspace' });
    await detector.start();
  });

  afterEach(async () => {
    await detector.stop();
  });

  it('emits file:content-changed for direct external writes', async () => {
    await mocks.fileWatchers[0].emitAsync('file-change', {
      type: 'change',
      path: '/workspace/src/app.ts',
      relativePath: 'src/app.ts',
      timestamp: new Date().toISOString(),
    });
    await waitForAsyncHandlers();

    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'file:content-changed', {
      path: '/workspace/src/app.ts',
      relativePath: 'src/app.ts',
      content: 'updated content',
      source: 'external',
      workspaceId: 'ws-1',
    });
  });

  it('emits file:content-changed when an atomic rename recreates the open file path', async () => {
    await mocks.fileWatchers[0].emitAsync('file-change', {
      type: 'unlink',
      path: '/workspace/src/app.ts',
      relativePath: 'src/app.ts',
      timestamp: new Date().toISOString(),
    });
    await mocks.fileWatchers[0].emitAsync('file-change', {
      type: 'add',
      path: '/workspace/src/app.ts',
      relativePath: 'src/app.ts',
      timestamp: new Date().toISOString(),
    });
    await waitForAsyncHandlers();

    const contentCalls = mocks.sendToWorkspaceWindows.mock.calls.filter(
      ([, channel]) => channel === 'file:content-changed',
    );
    expect(contentCalls).toHaveLength(1);
    expect(contentCalls[0][2]).toMatchObject({
      relativePath: 'src/app.ts',
      content: 'updated content',
    });
  });

  it('runs bounded follow-up git polls so a second same-path external edit is detected automatically', async () => {
    vi.useFakeTimers();
    const emptyStatus = {
      staged: [],
      stagedAdded: [],
      stagedDeleted: [],
      unstaged: [],
      untracked: [],
      deleted: [],
      renamed: new Map(),
    };
    const readmeStatus = { ...emptyStatus, unstaged: ['README.md'] };
    const firstDiff = { path: 'README.md', additions: 1, deletions: 0, diff: '+ first' };
    const secondDiff = { path: 'README.md', additions: 1, deletions: 0, diff: '+ second' };

    try {
      await detector.stop();
      detector = new ChangeDetectorRefactored({ workspaceId: 'ws-1', workspacePath: '/workspace' });
      mocks.fileWatchers[mocks.fileWatchers.length - 1].getStats.mockReturnValue({
        isWatching: false,
        watchedPaths: 0,
      });
      const gitOps = mocks.gitOpsInstances[mocks.gitOpsInstances.length - 1];
      const processor = mocks.changeProcessors[mocks.changeProcessors.length - 1];
      let currentStatus = emptyStatus;
      let currentDiff = firstDiff;
      gitOps.getStatus.mockImplementation(async () => currentStatus);
      gitOps.getBatchDiffs.mockImplementation(async () => new Map([['README.md', currentDiff]]));
      processor.processFileChanges.mockImplementation(async (changes: any[]) =>
        changes.map((change) => ({ change, event: {} })),
      );

      await detector.start();
      await flushPromises();
      processor.processFileChanges.mockClear();

      currentStatus = readmeStatus;
      currentDiff = firstDiff;
      await vi.advanceTimersByTimeAsync(15000);
      await flushPromises();

      await waitForProcessedChanges(processor, [
        {
          path: 'README.md',
          action: 'Modify',
          stage: 'unstaged',
          additions: 1,
          deletions: 0,
          diff: firstDiff,
        },
      ]);

      processor.processFileChanges.mockClear();
      currentDiff = secondDiff;
      await vi.advanceTimersByTimeAsync(2000);
      await flushPromises();

      await waitForProcessedChanges(processor, [
        {
          path: 'README.md',
          action: 'Modify',
          stage: 'unstaged',
          additions: 1,
          deletions: 0,
          diff: secondDiff,
        },
      ]);
    } finally {
      await detector.stop();
      vi.useRealTimers();
    }
  });
});
