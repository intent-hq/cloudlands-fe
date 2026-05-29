import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga, testSaga } from 'redux-saga-test-plan';
import * as matchers from 'redux-saga-test-plan/matchers';
import { dynamic } from 'redux-saga-test-plan/providers';

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
  invokeWithTimeout: vi.fn(),
  IpcTimeoutError: class IpcTimeoutError extends Error {},
}));

vi.mock('$features/line-changes/line-changes.client', () => ({
  lineChangesClient: {
    getAgentStats: vi.fn(),
  },
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import {
  changesSaga,
  handleInitWorkspace,
  handleInitWorkspaceWithListeners,
  handleOpenWorkspaceLocalChanges,
  handleTrackingReadyEvent,
  handleWorkspaceChangesEvent,
  replayPendingTrackingReadyForWorkspace,
  syncAgentStatsFromMain,
  watchGlobalTrackingReady,
  watchWorkspaceIpcListeners,
} from './changes-saga';
import { doLoadWorkspaceData, doSyncWithGit } from './changes-operations-saga';
import { TRACKING_CONFIG } from '$features/file-tracking/tracking.config';
import {
  initWorkspace,
  refreshRequested,
  setError,
  setHasLoadedInitialData,
  setLoading,
  updateAgentStatsBatch,
} from '../changes-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
import { selectAllWorkspaceAgents } from '../../workspace-agents/workspace-agents-selectors';
import { openWorkspaceLocalChanges } from '../../workspace-navigation/workspace-navigation-slice';
import { lineChangesClient } from '$features/line-changes/line-changes.client';
import type { FileTrackingSyncResult } from '$features/file-tracking/types';
import type { LineChangeStats } from '../changes-types';

const makeStats = (additions: number): LineChangeStats => ({
  additions,
  deletions: 0,
  timestamp: '2026-01-01T00:00:00.000Z',
});

const agent = (id: string) => ({ id }) as any;

describe('syncAgentStatsFromMain', () => {
  beforeEach(() => {
    vi.mocked(lineChangesClient.getAgentStats).mockReset();
  });

  it('dispatches one batched update with all entries when every agent succeeds', async () => {
    const a = makeStats(1);
    const b = makeStats(2);
    const c = makeStats(3);

    vi.mocked(lineChangesClient.getAgentStats).mockImplementation((async (id: string) => {
      if (id === 'a') return a;
      if (id === 'b') return b;
      if (id === 'c') return c;
      return null;
    }) as any);

    await expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), 'ws-1'],
        [
          matchers.select.selector(selectAllWorkspaceAgents.select),
          [agent('a'), agent('b'), agent('c')],
        ],
      ])
      .put(updateAgentStatsBatch({ a, b, c }))
      .silentRun(50);
  });

  it("includes other agents' stats when one agent's getAgentStats throws", async () => {
    const a = makeStats(10);
    const c = makeStats(30);

    vi.mocked(lineChangesClient.getAgentStats).mockImplementation((async (id: string) => {
      if (id === 'a') return a;
      if (id === 'b') throw new Error('boom');
      if (id === 'c') return c;
      return null;
    }) as any);

    await expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), 'ws-1'],
        [
          matchers.select.selector(selectAllWorkspaceAgents.select),
          [agent('a'), agent('b'), agent('c')],
        ],
      ])
      .put(updateAgentStatsBatch({ a, c }))
      .silentRun(50);
  });

  it('does not dispatch when there are zero agents', async () => {
    const dispatched: any[] = [];

    await expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), 'ws-1'],
        [matchers.select.selector(selectAllWorkspaceAgents.select), []],
        {
          put: dynamic(({ action }: any) => {
            dispatched.push(action);
            return undefined;
          }),
        },
      ])
      .silentRun(50);

    expect(dispatched).toEqual([]);
    expect(lineChangesClient.getAgentStats).not.toHaveBeenCalled();
  });

  it('runs per-agent getAgentStats calls concurrently rather than sequentially', async () => {
    // Track the order/timing: all calls must start before any resolves.
    const startedIds: string[] = [];
    let resolveAll: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    vi.mocked(lineChangesClient.getAgentStats).mockImplementation((async (id: string) => {
      startedIds.push(id);
      await gate;
      return makeStats(1);
    }) as any);

    const run = expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), 'ws-1'],
        [
          matchers.select.selector(selectAllWorkspaceAgents.select),
          [agent('a'), agent('b'), agent('c')],
        ],
      ])
      .silentRun(200);

    // Yield to the microtask queue so the saga can dispatch all 3 calls.
    await Promise.resolve();
    await Promise.resolve();

    expect(startedIds).toEqual(['a', 'b', 'c']);

    resolveAll!();
    await run;
  });
});

describe('handleWorkspaceChangesEvent', () => {
  it('forces a git sync before loading changes data for the active workspace', () => {
    testSaga(handleWorkspaceChangesEvent, 'ws-1', { workspaceId: 'ws-1' })
      .next()
      .delay(TRACKING_CONFIG.fileTracking.updateDebounce)
      .next()
      .call(doSyncWithGit, 'ws-1', true)
      .next()
      .call(doLoadWorkspaceData, 'ws-1')
      .next()
      .isDone();
  });

  it('ignores workspace change events for other workspaces', () => {
    testSaga(handleWorkspaceChangesEvent, 'ws-1', { workspaceId: 'ws-2' }).next().isDone();
  });
});

describe('changes refresh triggers', () => {
  it('refreshes through changes operations when Local Changes opens for the active workspace', () => {
    testSaga(handleOpenWorkspaceLocalChanges, openWorkspaceLocalChanges('ws-1'))
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .put(refreshRequested('ws-1'))
      .next()
      .isDone();
  });

  it('ignores Local Changes opens for a non-active workspace', () => {
    testSaga(handleOpenWorkspaceLocalChanges, openWorkspaceLocalChanges('ws-2'))
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .isDone();
  });

  it('finishes an initially empty workspace init after not-ready sync so tracking-ready can recover later', async () => {
    const notReadyResult: FileTrackingSyncResult = {
      success: false,
      notReady: true,
      code: 'GIT_INTEGRATION_NOT_READY',
      error: 'Git integration is not ready for this workspace',
    };

    await expectSaga(handleInitWorkspace, initWorkspace('ws-1'))
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), 'ws-1'],
        [matchers.call.fn(doSyncWithGit), notReadyResult],
        [matchers.call.fn(doLoadWorkspaceData), undefined],
      ])
      .put(setLoading('ws-1', true))
      .put(setError('ws-1', null))
      .put(setHasLoadedInitialData('ws-1', true))
      .put(setLoading('ws-1', false))
      .silentRun(50);
  });

  it('refreshes through changes operations when tracking is ready for the active workspace', () => {
    testSaga(handleTrackingReadyEvent, { workspaceId: 'ws-1' })
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .put(refreshRequested('ws-1'))
      .next()
      .isDone();
  });

  it('buffers tracking-ready events that arrive before the workspace is active', () => {
    testSaga(handleTrackingReadyEvent, { workspaceId: 'ws-1' })
      .next()
      .select(selectActiveWorkspaceId.select)
      .next(null)
      .isDone();

    testSaga(replayPendingTrackingReadyForWorkspace, 'ws-1')
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .put(refreshRequested('ws-1'))
      .next()
      .isDone();
  });

  it('does not replay buffered tracking-ready for a non-active workspace', () => {
    testSaga(handleTrackingReadyEvent, { workspaceId: 'ws-2' })
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .isDone();

    testSaga(replayPendingTrackingReadyForWorkspace, 'ws-2')
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .isDone();

    testSaga(replayPendingTrackingReadyForWorkspace, 'ws-2')
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-2')
      .put(refreshRequested('ws-2'))
      .next()
      .isDone();
  });

  it('registers workspace IPC listeners before initial workspace sync/load starts', () => {
    const action = initWorkspace('ws-1');
    const listenerTask = { cancel: vi.fn() } as any;

    testSaga(handleInitWorkspaceWithListeners, action)
      .next()
      .fork(watchWorkspaceIpcListeners, 'ws-1')
      .next(listenerTask)
      .call(handleInitWorkspace, action)
      .next()
      .call(replayPendingTrackingReadyForWorkspace, 'ws-1')
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .isDone();
  });

  it('registers the global tracking-ready listener before the initWorkspace watcher', () => {
    const iterator = changesSaga();

    iterator.next();
    iterator.next();
    iterator.next();

    const trackingReadyEffect = iterator.next().value as any;
    expect(trackingReadyEffect.type).toBe('FORK');
    expect(trackingReadyEffect.payload.fn).toBe(watchGlobalTrackingReady);

    const initWatcherEffect = iterator.next().value as any;
    expect(initWatcherEffect.type).toBe('FORK');
    expect(initWatcherEffect.payload.args[0]).toBe(initWorkspace);
    expect(initWatcherEffect.payload.args[1]).toBe(handleInitWorkspaceWithListeners);
  });
});
