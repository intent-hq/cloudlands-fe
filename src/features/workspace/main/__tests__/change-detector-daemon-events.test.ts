import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notificationHandlers: [] as Array<(n: unknown) => void>,
  reconnectHandlers: [] as Array<() => void>,
  request: vi.fn(),
  clientOff: vi.fn(),
  reconnectDisposer: vi.fn(),
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

const emptyStatus = {
  staged: [],
  stagedAdded: [],
  stagedDeleted: [],
  unstaged: [],
  untracked: [],
  deleted: [],
  renamed: new Map(),
};

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({
    on: (event: string, handler: (n: unknown) => void) => {
      if (event === 'notification') mocks.notificationHandlers.push(handler);
    },
    off: mocks.clientOff,
    request: mocks.request,
  }),
  onBackendReconnected: (handler: () => void) => {
    mocks.reconnectHandlers.push(handler);
    return mocks.reconnectDisposer;
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
    getStatus = vi.fn().mockResolvedValue(emptyStatus);
    getBatchDiffs = vi.fn().mockResolvedValue(new Map());
    getBatchDiffsStaged = vi.fn().mockResolvedValue(new Map());
    getFileAtHead = vi.fn().mockResolvedValue('');
  },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
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

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function emitDaemonNotification(params: unknown): void {
  for (const handler of [...mocks.notificationHandlers]) {
    handler({ method: 'events.event', params });
  }
}

describe('ChangeDetectorRefactored daemon file-event subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationHandlers.length = 0;
    mocks.reconnectHandlers.length = 0;
    mocks.changeProcessors.length = 0;
    mocks.gitOpsInstances.length = 0;
    mocks.request.mockResolvedValue({ subscriptionId: 'sub-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to workspace-scoped file:* events on start and unsubscribes on stop', async () => {
    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-sub',
      workspacePath: '/workspace',
    });

    await detector.start();
    await flushPromises();

    expect(mocks.request).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['file:changed', 'file:created', 'file:deleted'],
      workspaceId: 'ws-sub',
    });
    expect(detector.getStats()).toMatchObject({ isRunning: true });

    await detector.stop();

    expect(mocks.clientOff).toHaveBeenCalledWith('notification', expect.any(Function));
    expect(mocks.reconnectDisposer).toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'sub-1',
    });
  });

  it('runs a forced git check when a matching daemon file:changed event arrives', async () => {
    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-evt',
      workspacePath: '/workspace',
    });

    await detector.start();
    await flushPromises();

    const gitOps = mocks.gitOpsInstances[mocks.gitOpsInstances.length - 1];
    const readmeStatus = { ...emptyStatus, unstaged: ['README.md'] };
    const diff = { path: 'README.md', additions: 1, deletions: 0, diff: '+ a' };
    gitOps.getStatus.mockResolvedValue(readmeStatus);
    gitOps.getBatchDiffs.mockResolvedValue(new Map([['README.md', diff]]));
    gitOps.getStatus.mockClear();

    emitDaemonNotification({
      subscriptionId: 'sub-1',
      event: {
        type: 'file:changed',
        workspaceId: 'ws-evt',
        data: { path: 'README.md', relativePath: 'README.md', action: 'modify' },
      },
    });

    await vi.waitFor(() => {
      expect(gitOps.getStatus).toHaveBeenCalled();
    });
    expect(gitOps.invalidateCache).toHaveBeenCalled();

    await detector.stop();
  });

  it('ignores events for other workspaces and other subscriptions', async () => {
    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-scope',
      workspacePath: '/workspace',
    });

    await detector.start();
    await flushPromises();

    const gitOps = mocks.gitOpsInstances[mocks.gitOpsInstances.length - 1];
    gitOps.invalidateCache.mockClear();

    emitDaemonNotification({
      subscriptionId: 'sub-1',
      event: {
        type: 'file:changed',
        workspaceId: 'ws-other',
        data: { path: 'a.ts', relativePath: 'a.ts', action: 'modify' },
      },
    });
    emitDaemonNotification({
      subscriptionId: 'someone-elses-sub',
      event: {
        type: 'file:changed',
        workspaceId: 'ws-scope',
        data: { path: 'a.ts', relativePath: 'a.ts', action: 'modify' },
      },
    });
    await flushPromises();

    expect(gitOps.invalidateCache).not.toHaveBeenCalled();

    await detector.stop();
  });

  it('re-subscribes and runs a one-time full refresh on backend reconnect', async () => {
    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-reconnect',
      workspacePath: '/workspace',
    });

    await detector.start();
    await flushPromises();

    const gitOps = mocks.gitOpsInstances[mocks.gitOpsInstances.length - 1];
    gitOps.getStatus.mockClear();
    gitOps.invalidateCache.mockClear();
    mocks.request.mockClear();
    mocks.request.mockResolvedValue({ subscriptionId: 'sub-2' });

    expect(mocks.reconnectHandlers).toHaveLength(1);
    mocks.reconnectHandlers[0]();
    await flushPromises();

    expect(mocks.request).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['file:changed', 'file:created', 'file:deleted'],
      workspaceId: 'ws-reconnect',
    });
    expect(gitOps.invalidateCache).toHaveBeenCalled();
    expect(gitOps.getStatus).toHaveBeenCalled();

    await detector.stop();
  });

  it('retries a failed events.subscribe with backoff without waiting for a reconnect', async () => {
    vi.useFakeTimers();
    mocks.request.mockRejectedValueOnce(new Error('request timed out'));

    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-retry',
      workspacePath: '/workspace',
    });

    await detector.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenLastCalledWith('events.subscribe', {
      eventTypes: ['file:changed', 'file:created', 'file:deleted'],
      workspaceId: 'ws-retry',
    });

    await detector.stop();
  });

  it('cancels a pending subscribe retry on stop', async () => {
    vi.useFakeTimers();
    mocks.request.mockRejectedValueOnce(new Error('request timed out'));

    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-retry-stop',
      workspacePath: '/workspace',
    });

    await detector.start();
    await vi.advanceTimersByTimeAsync(0);
    await detector.stop();

    mocks.request.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('releases a subscription whose subscribe resolves after stop instead of leaking it', async () => {
    let resolveSubscribe!: (value: { subscriptionId: string }) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubscribe = resolve;
        }),
    );

    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-late',
      workspacePath: '/workspace',
    });

    await detector.start();
    await detector.stop();

    mocks.request.mockClear();
    resolveSubscribe({ subscriptionId: 'late-sub' });
    await flushPromises();

    expect(mocks.request).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'late-sub',
    });
  });

  it('starts successfully even when the initial events.subscribe fails', async () => {
    mocks.request.mockRejectedValueOnce(new Error('daemon not reachable'));

    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-nodaemon',
      workspacePath: '/workspace',
    });

    await expect(detector.start()).resolves.toBeUndefined();
    await flushPromises();
    expect(detector.getStats()).toMatchObject({ isRunning: true });

    await detector.stop();
  });

  it('cleans up runtime resources when startup fails', async () => {
    const detector = new ChangeDetectorRefactored({
      workspaceId: 'ws-fail',
      workspacePath: '/workspace',
    });
    const processor = mocks.changeProcessors[mocks.changeProcessors.length - 1];
    processor.initialize.mockRejectedValueOnce(new Error('init exploded'));

    await expect(detector.start()).rejects.toThrow('init exploded');
    expect(detector.getStats()).toMatchObject({ isRunning: false });
    expect(mockPerformanceMonitor.off).toHaveBeenCalledWith(
      'threshold-exceeded',
      mockPerformanceMonitor.on.mock.calls[0][1],
    );
    expect(processor.destroy).toHaveBeenCalled();
  });
});
