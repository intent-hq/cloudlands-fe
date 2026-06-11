import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUnifiedWatcher: vi.fn(),
  changeProcessors: [] as Array<{ initialize: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>,
  gitOpsInstances: [] as Array<{ getStatus: ReturnType<typeof vi.fn> }>,
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

const emptyStatus = {
  staged: [],
  stagedAdded: [],
  stagedDeleted: [],
  unstaged: [],
  untracked: [],
  deleted: [],
  renamed: new Map(),
};

vi.mock('../unified-workspace-watcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../unified-workspace-watcher')>();

  return {
    ...actual,
    getUnifiedWatcher: mocks.getUnifiedWatcher,
  };
});

vi.mock('../../../../lib/utils/main/gitignore-manager', () => ({
  GitignoreManager: class MockGitignoreManager {
    initialize = vi.fn().mockResolvedValue(undefined);
    shouldIgnore = vi.fn(() => false);
  },
}));

vi.mock('../change-detection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../change-detection')>();

  class MockEmitter {
    private handlers = new Map<string, Array<(payload?: unknown) => void>>();

    on(event: string, handler: (payload?: unknown) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    emit(event: string, payload?: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(payload);
      return true;
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
    ...actual,
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
    getStatus = vi.fn().mockResolvedValue(emptyStatus);
    getBatchDiffs = vi.fn().mockResolvedValue(new Map());
    getBatchDiffsStaged = vi.fn().mockResolvedValue(new Map());
    getFileAtHead = vi.fn().mockResolvedValue('');
  },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

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
import { WatcherStartDeferredError } from '../unified-workspace-watcher';

describe('ChangeDetectorRefactored watcher deferral startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUnifiedWatcher.mockReset();
    mocks.changeProcessors.length = 0;
    mocks.gitOpsInstances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('degrades memory-pressure watcher deferral to git polling', async () => {
    vi.useFakeTimers();
    const workspacePath = process.cwd();
    mocks.getUnifiedWatcher.mockRejectedValueOnce(
      new WatcherStartDeferredError(
        'Deferring watcher start: heap 830MB / RSS 1188MB exceeds threshold (heap>512MB or RSS>1024MB)',
      ),
    );

    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-deferral',
      workspacePath,
    });

    await expect(detector.start()).resolves.toBeUndefined();

    expect(mocks.getUnifiedWatcher).toHaveBeenCalledWith('ws-deferral', workspacePath);
    expect(detector.getStats()).toMatchObject({
      isRunning: true,
      gitPollingEnabled: true,
      fileWatcherEnabled: false,
    });
    expect(mockAdaptivePolling.on).toHaveBeenCalledWith('intervalChanged', expect.any(Function));

    await detector.stop();

    expect(mockPerformanceMonitor.off).toHaveBeenCalledWith(
      'threshold-exceeded',
      mockPerformanceMonitor.on.mock.calls[0][1],
    );
  });

  it('surfaces plain prefixed watcher startup errors as unexpected', async () => {
    vi.useFakeTimers();
    const workspacePath = process.cwd();
    mocks.getUnifiedWatcher.mockRejectedValueOnce(new Error('Deferring watcher start: native watcher exploded'));

    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-unexpected',
      workspacePath,
    });

    await expect(detector.start()).rejects.toThrow('Deferring watcher start: native watcher exploded');
    expect(detector.getStats()).toMatchObject({
      isRunning: false,
      gitPollingEnabled: false,
      fileWatcherEnabled: false,
    });
    expect(mockAdaptivePolling.on).not.toHaveBeenCalled();
    expect(mockPerformanceMonitor.off).toHaveBeenCalledWith(
      'threshold-exceeded',
      mockPerformanceMonitor.on.mock.calls[0][1],
    );
    expect(mocks.changeProcessors[0]?.destroy).toHaveBeenCalled();
  });
});