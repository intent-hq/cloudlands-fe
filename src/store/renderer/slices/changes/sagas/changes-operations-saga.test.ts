import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { expectSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
  invokeWithTimeout: vi.fn(),
  IpcTimeoutError: class IpcTimeoutError extends Error {},
}));

vi.mock('$lib/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(function Logger() {
    return {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }),
}));

import { invokeWithTimeout } from '$lib/electron-bridge';
import { ChangeStage, type FileTrackingSyncResult } from '$features/file-tracking/types';
import {
  emptyWorkspaceState,
  fileTrackingReducer,
  initialState,
  refreshRequested,
  setChangesData,
  changesDataUpdated,
  changesRefreshStarted,
  changesRefreshQueued,
  changesRefreshDirtyConsumed,
  syncWithGitRequested,
  loadWorkspaceDataRequested,
} from '../changes-slice';
import {
  selectChangesLastUpdatedAt,
  selectCurrentChanges,
  selectCurrentUnstagedWorkingChanges,
  selectFileTrackingChanges,
  selectFileTrackingTotalChangesCount,
  selectUnstagedWorkingChanges,
} from '../changes-selectors';
import type { TrackedChange } from '../changes-types';
import { refreshOpenFileContentForPathsRequested } from '../../files/files-slice';
import {
  doLoadWorkspaceData,
  doSyncWithGit,
  handleRefresh,
  resetTrackingState,
} from './changes-operations-saga';

const WS_ID = 'ws-1';
const PATH = 'src/app.ts';
const PATH_2 = 'src/other.ts';

function makeChange(path: string, overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: `change-${path}`,
    file: path,
    relativePath: path,
    stage: ChangeStage.Unstaged,
    status: 'modified',
    stats: { additions: 1, deletions: 0 },
    attribution: { manual: true, timestamp: 1 },
    ...overrides,
  };
}

function stateWithChanges(changes: TrackedChange[] = []) {
  return {
    workspace: { activeWorkspaceId: WS_ID },
    changes: {
      ...initialState,
      byWorkspaceId: {
        [WS_ID]: {
          ...emptyWorkspaceState,
          changes,
        },
      },
    },
  } as any;
}

function reduceStoreState(state: any = stateWithChanges(), action: any) {
  return {
    ...state,
    changes: fileTrackingReducer(state.changes, action),
  };
}

function mockLoadResponse(changes: TrackedChange[]) {
  vi.mocked(invokeWithTimeout).mockImplementation((async (channel: string) => {
    if (channel === 'file-tracking:load') {
      return { changes, truncated: false, totalCount: changes.length };
    }
    if (channel === 'file-tracking:load-transitions') {
      return [];
    }
    return { commits: [], boundarySha: null };
  }) as any);
}

function expectSelectForWs(effect: any, wsId: string): void {
  expect(effect.type).toBe('SELECT');
  expect(effect.payload.args).toEqual([wsId]);
}

function mockSyncAndLoadResponse(changes: TrackedChange[]) {
  vi.mocked(invokeWithTimeout).mockImplementation((async (channel: string) => {
    if (channel === 'file-tracking:sync') {
      return { success: true, synced: true } satisfies FileTrackingSyncResult;
    }
    if (channel === 'file-tracking:load') {
      return { changes, truncated: false, totalCount: changes.length };
    }
    if (channel === 'file-tracking:load-transitions') {
      return [];
    }
    return { commits: [], boundarySha: null };
  }) as any);
}

describe('changes operations saga open-file refresh bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrackingState();
  });

  it('requests open file content refreshes for unstaged paths discovered by changes load', async () => {
    const change = makeChange(PATH);
    mockLoadResponse([change]);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123_456);

    const result = await expectSaga(doLoadWorkspaceData, WS_ID)
      .withReducer(reduceStoreState, stateWithChanges())
      .put(setChangesData(WS_ID, [change], false, 1))
      .put(refreshOpenFileContentForPathsRequested(WS_ID, [PATH]))
      .put(changesDataUpdated(WS_ID, 123_456))
      .silentRun(50);

    expect(selectChangesLastUpdatedAt.select(result.storeState as any, WS_ID)).toBe(123_456);
    nowSpy.mockRestore();
  });

  it('still requests open file refresh when changes data is unchanged', async () => {
    const change = makeChange(PATH);
    mockLoadResponse([change]);

    await expectSaga(doLoadWorkspaceData, WS_ID)
      .withState(stateWithChanges([change]))
      .put(refreshOpenFileContentForPathsRequested(WS_ID, [PATH]))
      .silentRun(50);
  });

  it('dedupes refresh paths and ignores staged or deleted changes', async () => {
    const unstaged = makeChange(PATH);
    const duplicate = makeChange(PATH, { id: 'change-duplicate' });
    const staged = makeChange(PATH_2, { stage: ChangeStage.Staged });
    const deleted = makeChange('src/deleted.ts', { status: 'deleted' });
    mockLoadResponse([unstaged, duplicate, staged, deleted]);

    await expectSaga(doLoadWorkspaceData, WS_ID)
      .withState(stateWithChanges())
      .put(refreshOpenFileContentForPathsRequested(WS_ID, [PATH]))
      .silentRun(50);
  });

  it('populates Redux-backed current and local changes from forced refresh with an initially empty workspace state', async () => {
    const modified = makeChange(PATH, { stats: { additions: 3, deletions: 1 } });
    const untracked = makeChange('src/new-file.ts', {
      id: 'change-src/new-file.ts',
      status: 'added',
      stats: { additions: 5, deletions: 0 },
    });
    mockSyncAndLoadResponse([modified, untracked]);

    const result = await expectSaga(handleRefresh, refreshRequested(WS_ID))
      .withReducer(reduceStoreState, stateWithChanges())
      .silentRun(100);

    const storeState = result.storeState as any;
    const expectedPaths = [PATH, 'src/new-file.ts'];
    expect(selectFileTrackingChanges.select(storeState, WS_ID).map((c) => c.relativePath)).toEqual(expectedPaths);
    expect(selectCurrentChanges.select(storeState).map((c) => c.relativePath)).toEqual(expectedPaths);
    expect(selectUnstagedWorkingChanges.select(storeState, WS_ID).map((c) => c.relativePath)).toEqual(expectedPaths);
    expect(selectCurrentUnstagedWorkingChanges.select(storeState).map((c) => c.relativePath)).toEqual(expectedPaths);
    expect(selectFileTrackingTotalChangesCount.select(storeState, WS_ID)).toBe(2);
    expect(invokeWithTimeout).toHaveBeenCalledWith(
      'file-tracking:sync',
      { workspaceId: WS_ID, force: true },
      30000,
    );
  });

  it('treats not-ready sync results as transient without sticky state actions', async () => {
    const notReadyResult: FileTrackingSyncResult = {
      success: false,
      notReady: true,
      code: 'GIT_INTEGRATION_NOT_READY',
      error: 'Git integration is not ready for this workspace',
    };
    vi.mocked(invokeWithTimeout).mockResolvedValue(notReadyResult as any);

    const result = await expectSaga(doSyncWithGit, WS_ID, true)
      .withReducer(reduceStoreState, stateWithChanges())
      .silentRun(50);

    expect(result.returnValue).toEqual(notReadyResult);
    expect((result.storeState as any).changes.byWorkspaceId[WS_ID].coordination).toMatchObject({
      syncInProgress: false,
      syncDirty: false,
      syncDirtyForce: false,
    });
    expect(invokeWithTimeout).toHaveBeenCalledWith(
      'file-tracking:sync',
      { workspaceId: WS_ID, force: true },
      30000,
    );
  });

  it('serializes overlapping refresh requests into one action-driven follow-up refresh', async () => {
    const overlappingRefresh = handleRefresh(refreshRequested(WS_ID));
    expectSelectForWs(overlappingRefresh.next().value, WS_ID);
    expect(overlappingRefresh.next(true).value).toEqual(sagaEffects.put(changesRefreshQueued(WS_ID)));
    expect(overlappingRefresh.next().done).toBe(true);

    mockSyncAndLoadResponse([]);
    const dirtyRefreshState = stateWithChanges();
    dirtyRefreshState.changes.byWorkspaceId[WS_ID].coordination = {
      ...dirtyRefreshState.changes.byWorkspaceId[WS_ID].coordination,
      refreshDirty: true,
    };

    await expectSaga(handleRefresh, refreshRequested(WS_ID))
      .withState(dirtyRefreshState)
      .put(changesRefreshDirtyConsumed(WS_ID))
      .put(refreshRequested(WS_ID))
      .silentRun(100);
  });

  it('coordinates different workspace refreshes independently', () => {
    const firstRefresh = handleRefresh(refreshRequested('ws-a'));

    expectSelectForWs(firstRefresh.next().value, 'ws-a');
    expect(firstRefresh.next(false).value).toEqual(sagaEffects.put(changesRefreshStarted('ws-a')));

    const otherWorkspaceRefresh = handleRefresh(refreshRequested('ws-b'));
    expectSelectForWs(otherWorkspaceRefresh.next().value, 'ws-b');
    expect(otherWorkspaceRefresh.next(false).value).toEqual(
      sagaEffects.put(changesRefreshStarted('ws-b')),
    );
  });

  it('does not replay refresh when Redux dirty state is clear', async () => {
    mockSyncAndLoadResponse([]);

    await expectSaga(handleRefresh, refreshRequested(WS_ID))
      .withState(stateWithChanges())
      .not.put(refreshRequested(WS_ID))
      .silentRun(100);
  });

  it('dispatches queued sync/load request actions instead of recursive worker calls', () => {
    const source = readFileSync('src/store/renderer/slices/changes/sagas/changes-operations-saga.ts', 'utf8');

    expect(source).toMatch(/changesSyncDirtyConsumed\(wsId\)[\s\S]{0,160}put\(syncWithGitRequested\(wsId, dirtyForce\)\)/);
    expect(source).toMatch(/changesLoadDirtyConsumed\(wsId\)[\s\S]{0,160}put\(loadWorkspaceDataRequested\(wsId\)\)/);
    expect(source).toMatch(/changesRefreshDirtyConsumed\(wsId\)[\s\S]{0,160}put\(refreshRequested\(wsId\)\)/);
    expect(source).not.toMatch(/changesSyncDirtyConsumed\(wsId\)[\s\S]{0,160}call\(doSyncWithGit/);
    expect(source).not.toMatch(/changesLoadDirtyConsumed\(wsId\)[\s\S]{0,160}call\(doLoadWorkspaceData/);
    expect(source).not.toMatch(/changesRefreshDirtyConsumed\(wsId\)[\s\S]{0,160}call\(handleRefresh/);
  });

  it('keeps queued follow-up actions canonical', () => {
    expect(syncWithGitRequested(WS_ID, true).type).toBe('changes/syncWithGitRequested');
    expect(loadWorkspaceDataRequested(WS_ID).type).toBe('changes/loadWorkspaceDataRequested');
    expect(refreshRequested(WS_ID).type).toBe('changes/refreshRequested');
  });
});
