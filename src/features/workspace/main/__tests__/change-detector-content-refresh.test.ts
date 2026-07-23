import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendToWorkspaceWindows: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  notificationHandlers: [] as Array<(n: unknown) => void>,
  reconnectHandlers: [] as Array<() => void>,
  request: vi.fn(),
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

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({
    on: (event: string, handler: (n: unknown) => void) => {
      if (event === 'notification') mocks.notificationHandlers.push(handler);
    },
    off: vi.fn(),
    request: mocks.request,
  }),
  onBackendReconnected: (handler: () => void) => {
    mocks.reconnectHandlers.push(handler);
    return vi.fn();
  },
}));

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

import { ChangeDetectorRefactored } from '../change-detector-refactored';

function waitForAsyncHandlers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Wait for the detector's background work (including dynamic import('fs')) to
// fully settle so a subsequent poll is not swallowed by the concurrency guard.
// Uses real macrotask ticks (no fake timers).
async function waitForIdle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForProcessedChanges(processor: any, changes: any[]): Promise<void> {
  await vi.waitFor(() => {
    expect(processor.processFileChanges).toHaveBeenCalledWith(changes);
  });
}

/** Deliver a daemon `events.event` notification to the detector's listener. */
function emitDaemonFileEvent(
  type: string,
  data: Record<string, unknown>,
  workspaceId = 'ws-1',
): void {
  for (const handler of [...mocks.notificationHandlers]) {
    handler({
      method: 'events.event',
      params: { subscriptionId: 'sub-1', event: { type, workspaceId, data } },
    });
  }
}

describe('ChangeDetectorRefactored content refresh emissions', () => {
  let detector: ChangeDetectorRefactored;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.notificationHandlers.length = 0;
    mocks.reconnectHandlers.length = 0;
    mocks.changeProcessors.length = 0;
    mocks.gitOpsInstances.length = 0;
    mocks.request.mockResolvedValue({ subscriptionId: 'sub-1' });
    mocks.stat.mockResolvedValue({ size: 12, mtimeMs: 1 });
    mocks.readFile.mockResolvedValue('updated content');
    detector = new ChangeDetectorRefactored({ workspaceId: 'ws-1', workspacePath: '/workspace' });
    await detector.start();
    await waitForIdle();
  });

  afterEach(async () => {
    await detector.stop();
  });

  it('emits file:content-changed for direct external writes', async () => {
    emitDaemonFileEvent('file:changed', {
      path: 'src/app.ts',
      relativePath: 'src/app.ts',
      action: 'modify',
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
    emitDaemonFileEvent('file:deleted', {
      path: 'src/app.ts',
      relativePath: 'src/app.ts',
      action: 'delete',
    });
    emitDaemonFileEvent('file:created', {
      path: 'src/app.ts',
      relativePath: 'src/app.ts',
      action: 'create',
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

  it('re-diffs a second same-path external edit signalled by another daemon file event', async () => {
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

    const gitOps = mocks.gitOpsInstances[mocks.gitOpsInstances.length - 1];
    const processor = mocks.changeProcessors[mocks.changeProcessors.length - 1];
    let currentDiff = firstDiff;
    gitOps.getStatus.mockResolvedValue(readmeStatus);
    gitOps.getBatchDiffs.mockImplementation(async () => new Map([['README.md', currentDiff]]));
    processor.processFileChanges.mockImplementation(async (changes: any[]) =>
      changes.map((change) => ({ change, event: {} })),
    );

    emitDaemonFileEvent('file:changed', {
      path: 'README.md',
      relativePath: 'README.md',
      action: 'modify',
    });

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

    // A second edit to the same path leaves the git status string unchanged;
    // the daemon-event-driven check must still force a re-diff and detect it.
    processor.processFileChanges.mockClear();
    currentDiff = secondDiff;
    emitDaemonFileEvent('file:changed', {
      path: 'README.md',
      relativePath: 'README.md',
      action: 'modify',
    });

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
  });

  it('re-detects an identical git status after detectGitChanges throws once', async () => {
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
    const diff = { path: 'README.md', additions: 1, deletions: 0, diff: '+ a' };

    const gitOps = mocks.gitOpsInstances[mocks.gitOpsInstances.length - 1];

    // Switch to a status that requires a diff; the first detection throws, so the
    // processed-status marker must NOT advance and the next identical poll must retry.
    gitOps.getStatus.mockResolvedValue(readmeStatus);
    gitOps.getBatchDiffs.mockClear();
    gitOps.getBatchDiffs
      .mockRejectedValueOnce(new Error('diff failed'))
      .mockResolvedValue(new Map([['README.md', diff]]));

    await detector.forceGitCheck();
    await detector.forceGitCheck();

    expect(gitOps.getBatchDiffs).toHaveBeenCalledTimes(2);
  });

  it('detects a forced/triggered check on an unchanged status while a plain poll short-circuits', async () => {
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
    const diff = { path: 'README.md', additions: 1, deletions: 0, diff: '+ a' };

    const gitOps = mocks.gitOpsInstances[mocks.gitOpsInstances.length - 1];
    const processor = mocks.changeProcessors[mocks.changeProcessors.length - 1];
    gitOps.getStatus.mockResolvedValue(readmeStatus);
    gitOps.getBatchDiffs.mockResolvedValue(new Map([['README.md', diff]]));
    processor.processFileChanges.mockResolvedValue([]);

    // Seed the processed-status marker with the current status.
    await detector.forceGitCheck();
    await waitForIdle();

    gitOps.getBatchDiffs.mockClear();

    // A non-forced poll on the unchanged status short-circuits (no re-diff).
    await detector.forceGitCheck();
    expect(gitOps.getBatchDiffs).not.toHaveBeenCalled();

    // A forced/triggered check bypasses the short-circuit and re-runs detection.
    await detector.triggerImmediateCheck('file-save');
    expect(gitOps.getBatchDiffs).toHaveBeenCalledTimes(1);
  });
});
