import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { expectSaga, testSaga } from 'redux-saga-test-plan';
import * as matchers from 'redux-saga-test-plan/matchers';

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
  handleAgentStreamCompletedForChanges,
  handleChangesUpdatedEvent,
  handleAgentFileChangedEvent,
  handleTrackingReadyEvent,
  handleWorkspaceUnmountedForChanges,
  handleWorkspaceChangesEvent,
  handleRequestAgentLineStats,
  replayPendingTrackingReadyForWorkspace,
  resetChangesSagaPendingState,
  watchGlobalTrackingReady,
  watchRequestedAgentLineStats,
  watchWorkspaceUnmountedForChanges,
  watchWorkspaceIpcListeners,
  isChangesAutomaticRefreshStale,
  CHANGES_AUTO_REFRESH_FRESHNESS_MS,
} from './changes-saga';
import { doLoadWorkspaceData, doSyncWithGit } from './changes-operations-saga';
import {
  initWorkspace,
  requestAgentLineStats,
  agentLineStatsRequestStarted,
  agentLineStatsRequestSucceeded,
  agentLineStatsRequestFailed,
  fileTrackingReducer,
  initialState,
  refreshRequested,
  setError,
  setHasLoadedInitialData,
  setLoading,
  updateAgentStats,
} from '../changes-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
import { selectChangesLastUpdatedAt } from '../changes-selectors';
import { openWorkspaceLocalChanges } from '../../workspace-navigation/workspace-navigation-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { streamCompleted } from '../../chat-state/chat-state-slice';
import { selectAgentSessionWorkspaceId } from '../../agent-session/agent-session-selectors';
import { lineChangesClient } from '$features/line-changes/line-changes.client';
import type { FileTrackingSyncResult } from '$features/file-tracking/types';
import type { LineChangeStats } from '../changes-types';

const makeStats = (additions: number): LineChangeStats => ({
  additions,
  deletions: 0,
  timestamp: '2026-01-01T00:00:00.000Z',
});

const asStoreState = (changes = initialState) => ({ changes }) as any;

function collectPuts(dispatched: any[]) {
  return {
    put({ action }: any) {
      dispatched.push(action);
      return undefined;
    },
  };
}

beforeEach(() => {
  resetChangesSagaPendingState();
});

describe('requested agent line stats', () => {
  beforeEach(() => {
    vi.mocked(lineChangesClient.getAgentStats).mockReset();
  });

  it('fetches and stores only the requested agent line stats', async () => {
    const stats = makeStats(1);
    const dispatched: any[] = [];

    vi.mocked(lineChangesClient.getAgentStats).mockResolvedValue(stats as any);

    await expectSaga(handleRequestAgentLineStats, requestAgentLineStats('agent-1'))
      .withState(asStoreState())
      .provide([collectPuts(dispatched)])
      .silentRun(50);

    expect(lineChangesClient.getAgentStats).toHaveBeenCalledTimes(1);
    expect(lineChangesClient.getAgentStats).toHaveBeenCalledWith('agent-1');
    expect(dispatched[0]).toMatchObject({
      type: agentLineStatsRequestStarted.type,
      payload: { agentId: 'agent-1' },
    });
    expect(dispatched).toContainEqual(updateAgentStats('agent-1', stats));
    expect(dispatched.at(-1)).toMatchObject({
      type: agentLineStatsRequestSucceeded.type,
      payload: { agentId: 'agent-1' },
    });
  });

  it('skips the fetch when stats are already cached and forceRefresh is false', async () => {
    const cached = makeStats(5);
    const dispatched: any[] = [];
    const cachedState = fileTrackingReducer(initialState, updateAgentStats('agent-1', cached));

    await expectSaga(handleRequestAgentLineStats, requestAgentLineStats('agent-1'))
      .withState(asStoreState(cachedState))
      .provide([collectPuts(dispatched)])
      .silentRun(50);

    expect(lineChangesClient.getAgentStats).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('skips duplicate in-flight requests using Redux request lifecycle state', async () => {
    const dispatched: any[] = [];
    const inFlightState = fileTrackingReducer(
      initialState,
      agentLineStatsRequestStarted('agent-1', '2026-01-01T00:00:00.000Z'),
    );

    await expectSaga(handleRequestAgentLineStats, requestAgentLineStats('agent-1'))
      .withState(asStoreState(inFlightState))
      .provide([collectPuts(dispatched)])
      .silentRun(50);

    expect(lineChangesClient.getAgentStats).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('force-refreshes cached stats when requested', async () => {
    const cached = makeStats(5);
    const fresh = makeStats(9);
    const dispatched: any[] = [];
    const cachedState = fileTrackingReducer(initialState, updateAgentStats('agent-1', cached));

    vi.mocked(lineChangesClient.getAgentStats).mockResolvedValue(fresh as any);

    await expectSaga(handleRequestAgentLineStats, requestAgentLineStats('agent-1', true))
      .withState(asStoreState(cachedState))
      .provide([collectPuts(dispatched)])
      .silentRun(50);

    expect(lineChangesClient.getAgentStats).toHaveBeenCalledTimes(1);
    expect(lineChangesClient.getAgentStats).toHaveBeenCalledWith('agent-1');
    expect(dispatched).toContainEqual(updateAgentStats('agent-1', fresh));
  });

  it('does not dispatch an update when the requested stats are missing', async () => {
    const dispatched: any[] = [];

    vi.mocked(lineChangesClient.getAgentStats).mockResolvedValue(null as any);

    await expectSaga(handleRequestAgentLineStats, requestAgentLineStats('agent-1'))
      .withState(asStoreState())
      .provide([collectPuts(dispatched)])
      .silentRun(50);

    expect(dispatched.some((action) => action.type === updateAgentStats.type)).toBe(false);
    expect(dispatched.at(-1)).toMatchObject({ type: agentLineStatsRequestSucceeded.type });
    expect(lineChangesClient.getAgentStats).toHaveBeenCalledWith('agent-1');
  });

  it('catches per-agent fetch failures and clears loading through failure lifecycle', async () => {
    const dispatched: any[] = [];

    vi.mocked(lineChangesClient.getAgentStats).mockRejectedValue(new Error('boom'));

    await expectSaga(handleRequestAgentLineStats, requestAgentLineStats('agent-1'))
      .withState(asStoreState())
      .provide([collectPuts(dispatched)])
      .silentRun(50);

    expect(dispatched.some((action) => action.type === updateAgentStats.type)).toBe(false);
    expect(dispatched.at(-1)).toMatchObject({
      type: agentLineStatsRequestFailed.type,
      payload: { agentId: 'agent-1', error: 'boom' },
    });
    expect(lineChangesClient.getAgentStats).toHaveBeenCalledWith('agent-1');
  });

  it('keeps agent line-stat request state out of module globals', () => {
    const source = readFileSync('src/store/renderer/slices/changes/sagas/changes-saga.ts', 'utf8');
    const removedGlobalName = 'pendingAgent' + 'LineStatsRequests';

    expect(source).not.toContain(removedGlobalName);
    expect(source).not.toMatch(/agentLineStatsRequests\s*=\s*new\s+(Set|Map)/);
  });

  it('watches explicit request actions instead of polling all agents', () => {
    testSaga(watchRequestedAgentLineStats)
      .next()
      .takeEvery(requestAgentLineStats, handleRequestAgentLineStats)
      .next()
      .isDone();
  });

  it('registers requested line-stat loads from the root saga without an all-agent polling fork', () => {
    const iterator = changesSaga();

    const operationsEffect = iterator.next().value as any;
    expect(operationsEffect.type).toBe('FORK');

    const requestedStatsEffect = iterator.next().value as any;
    expect(requestedStatsEffect.type).toBe('FORK');
    expect(requestedStatsEffect.payload.fn).toBe(watchRequestedAgentLineStats);
  });
});

describe('handleWorkspaceChangesEvent', () => {
  it('does not sync or load changes data automatically for the active workspace', () => {
    testSaga(handleWorkspaceChangesEvent, 'ws-1', { workspaceId: 'ws-1' })
      .next()
      .isDone();
  });

  it('ignores workspace change events for other workspaces', () => {
    testSaga(handleWorkspaceChangesEvent, 'ws-1', { workspaceId: 'ws-2' }).next().isDone();
  });
});

describe('changes refresh triggers', () => {
  it('treats updates older than 60 seconds as stale for automatic refreshes', () => {
    expect(isChangesAutomaticRefreshStale(0, 10)).toBe(true);
    expect(isChangesAutomaticRefreshStale(1_000, 1_000 + CHANGES_AUTO_REFRESH_FRESHNESS_MS)).toBe(false);
    expect(isChangesAutomaticRefreshStale(1_000, 1_001 + CHANGES_AUTO_REFRESH_FRESHNESS_MS)).toBe(true);
  });

  it('refreshes through changes operations when Local Changes opens for the active workspace', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);

    testSaga(handleOpenWorkspaceLocalChanges, openWorkspaceLocalChanges('ws-1'))
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .select(selectChangesLastUpdatedAt.select, 'ws-1')
      .next(39_999)
      .put(refreshRequested('ws-1'))
      .next()
      .isDone();

    nowSpy.mockRestore();
  });

  it('skips Local Changes automatic refresh when changes data is 60 seconds old or newer', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);

    testSaga(handleOpenWorkspaceLocalChanges, openWorkspaceLocalChanges('ws-1'))
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .select(selectChangesLastUpdatedAt.select, 'ws-1')
      .next(40_000)
      .isDone();

    nowSpy.mockRestore();
  });

  it('ignores Local Changes opens for a non-active workspace', () => {
    testSaga(handleOpenWorkspaceLocalChanges, openWorkspaceLocalChanges('ws-2'))
      .next()
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .isDone();
  });

  it('refreshes through changes operations when an agent completion signal is stale', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);

    testSaga(
      handleAgentStreamCompletedForChanges,
      streamCompleted('agent-1', { lastAttemptedMessage: null, modelUnavailable: null }),
    )
      .next()
      .select(selectAgentSessionWorkspaceId.select, 'agent-1')
      .next('ws-1')
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .select(selectChangesLastUpdatedAt.select, 'ws-1')
      .next(39_999)
      .put(refreshRequested('ws-1'))
      .next()
      .isDone();

    nowSpy.mockRestore();
  });

  it('skips agent completion automatic refresh for fresh or inactive workspaces', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);

    testSaga(
      handleAgentStreamCompletedForChanges,
      streamCompleted('agent-1', { lastAttemptedMessage: null, modelUnavailable: null }),
    )
      .next()
      .select(selectAgentSessionWorkspaceId.select, 'agent-1')
      .next('ws-1')
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .select(selectChangesLastUpdatedAt.select, 'ws-1')
      .next(40_000)
      .isDone();

    testSaga(
      handleAgentStreamCompletedForChanges,
      streamCompleted('agent-2', { lastAttemptedMessage: null, modelUnavailable: null }),
    )
      .next()
      .select(selectAgentSessionWorkspaceId.select, 'agent-2')
      .next('ws-2')
      .select(selectActiveWorkspaceId.select)
      .next('ws-1')
      .isDone();

    nowSpy.mockRestore();
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

  it('does not refresh when tracking is ready because listener-ready is not an approved automatic trigger', () => {
    testSaga(handleTrackingReadyEvent, { workspaceId: 'ws-1' })
      .next()
      .isDone();
  });

  it('does not refresh when file-tracking changes-updated fires', () => {
    testSaga(handleChangesUpdatedEvent, 'ws-1', { workspaceId: 'ws-1', changeCount: 2 })
      .next()
      .isDone();
  });

  it('does not sync or load when agent-file-changed fires', () => {
    testSaga(handleAgentFileChangedEvent, 'ws-1', {
      workspaceId: 'ws-1',
      filePath: 'src/app.ts',
    })
      .next()
      .isDone();
  });

  it('does not watch git status updates as changes refresh triggers', () => {
    const source = readFileSync('src/store/renderer/slices/changes/sagas/changes-saga.ts', 'utf8');

    expect(source).not.toContain('setGitStatus');
    expect(source).not.toContain('watchGitStatusAction');
    expect(source).not.toMatch(/takeLatest\(setGitStatus/);
  });

  it('keeps disallowed event paths away from refresh-equivalent work', () => {
    const source = readFileSync('src/store/renderer/slices/changes/sagas/changes-saga.ts', 'utf8');

    expect(source).not.toMatch(
      /file-tracking:changes-updated[\s\S]{0,240}(doSyncWithGit|doLoadWorkspaceData|refreshRequested)/,
    );
    expect(source).not.toMatch(
      /file-tracking:agent-file-changed[\s\S]{0,240}(doSyncWithGit|doLoadWorkspaceData|refreshRequested)/,
    );
    expect(source).not.toMatch(
      /workspace-changes[\s\S]{0,240}(doSyncWithGit|doLoadWorkspaceData|refreshRequested)/,
    );
  });

  it('keeps approved automatic triggers routed through the 60-second freshness helper', () => {
    const source = readFileSync('src/store/renderer/slices/changes/sagas/changes-saga.ts', 'utf8');

    expect(source).toMatch(
      /handleOpenWorkspaceLocalChanges[\s\S]{0,500}requestAutomaticChangesRefreshIfStale\(wsId\)/,
    );
    expect(source).toMatch(
      /handleAgentStreamCompletedForChanges[\s\S]{0,600}requestAutomaticChangesRefreshIfStale\(wsId\)/,
    );
    expect(source).toMatch(
      /requestAutomaticChangesRefreshIfStale[\s\S]{0,260}selectChangesLastUpdatedAt[\s\S]{0,260}isChangesAutomaticRefreshStale[\s\S]{0,260}refreshRequested/,
    );
  });

  it('does not replay tracking-ready refreshes after workspace activation', () => {
    testSaga(handleTrackingReadyEvent, { workspaceId: 'ws-1' })
      .next()
      .isDone();

    testSaga(replayPendingTrackingReadyForWorkspace, 'ws-1')
      .next()
      .isDone();
  });

  it('does not replay buffered tracking-ready for any workspace', () => {
    testSaga(handleTrackingReadyEvent, { workspaceId: 'ws-2' })
      .next()
      .isDone();

    testSaga(replayPendingTrackingReadyForWorkspace, 'ws-2')
      .next()
      .isDone();

    testSaga(replayPendingTrackingReadyForWorkspace, 'ws-2')
      .next()
      .isDone();
  });

  it('drops buffered tracking-ready ids when their workspace unmounts', () => {
    testSaga(handleTrackingReadyEvent, { workspaceId: 'ws-stale' })
      .next()
      .isDone();

    testSaga(handleWorkspaceUnmountedForChanges, workspaceUnmounted('ws-stale'))
      .next()
      .isDone();

    testSaga(replayPendingTrackingReadyForWorkspace, 'ws-stale')
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

    const agentCompletionEffect = iterator.next().value as any;
    expect(agentCompletionEffect.type).toBe('FORK');

    const trackingReadyEffect = iterator.next().value as any;
    expect(trackingReadyEffect.type).toBe('FORK');
    expect(trackingReadyEffect.payload.fn).toBe(watchGlobalTrackingReady);

    const unmountWatcherEffect = iterator.next().value as any;
    expect(unmountWatcherEffect.type).toBe('FORK');
    expect(unmountWatcherEffect.payload.fn).toBe(watchWorkspaceUnmountedForChanges);

    const initWatcherEffect = iterator.next().value as any;
    expect(initWatcherEffect.type).toBe('FORK');
    expect(initWatcherEffect.payload.args[0]).toBe(initWorkspace);
    expect(initWatcherEffect.payload.args[1]).toBe(handleInitWorkspaceWithListeners);
  });
});
