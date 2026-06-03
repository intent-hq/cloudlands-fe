import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import { dynamic } from 'redux-saga-test-plan/providers';
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
} from '../changes-slice';
import {
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

    await expectSaga(doLoadWorkspaceData, WS_ID)
      .withState(stateWithChanges())
      .put(setChangesData(WS_ID, [change], false, 1))
      .put(refreshOpenFileContentForPathsRequested(WS_ID, [PATH]))
      .silentRun(50);
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
    const dispatched: any[] = [];
    vi.mocked(invokeWithTimeout).mockResolvedValue(notReadyResult as any);

    const result = await expectSaga(doSyncWithGit, WS_ID, true)
      .provide([
        {
          put: dynamic(({ action }: any) => {
            dispatched.push(action);
            return undefined;
          }),
        },
      ])
      .silentRun(50);

    expect(result.returnValue).toEqual(notReadyResult);
    expect(dispatched).toEqual([]);
    expect(invokeWithTimeout).toHaveBeenCalledWith(
      'file-tracking:sync',
      { workspaceId: WS_ID, force: true },
      30000,
    );
  });

  it('serializes overlapping refresh requests into one follow-up sync/load', () => {
    const firstRefresh = handleRefresh(refreshRequested(WS_ID));

    expect(firstRefresh.next().value).toEqual(sagaEffects.call(doSyncWithGit, WS_ID, true));

    const overlappingRefresh = handleRefresh(refreshRequested(WS_ID));
    expect(overlappingRefresh.next().done).toBe(true);

    firstRefresh.next();
    expect(firstRefresh.next(WS_ID).value).toEqual(sagaEffects.call(doLoadWorkspaceData, WS_ID));
    expect(firstRefresh.next().value).toEqual(sagaEffects.delay(0));
    expect(firstRefresh.next().value).toEqual(sagaEffects.call(handleRefresh, refreshRequested(WS_ID)));
    expect(firstRefresh.next().done).toBe(true);
  });

  it('replays the queued workspace when a different workspace refresh overlaps', () => {
    const firstRefresh = handleRefresh(refreshRequested('ws-a'));

    expect(firstRefresh.next().value).toEqual(sagaEffects.call(doSyncWithGit, 'ws-a', true));

    const overlappingRefresh = handleRefresh(refreshRequested('ws-b'));
    expect(overlappingRefresh.next().done).toBe(true);

    firstRefresh.next();
    expect(firstRefresh.next('ws-a').value).toEqual(sagaEffects.call(doLoadWorkspaceData, 'ws-a'));
    expect(firstRefresh.next().value).toEqual(sagaEffects.delay(0));
    expect(firstRefresh.next().value).toEqual(sagaEffects.call(handleRefresh, refreshRequested('ws-b')));
    expect(firstRefresh.next().done).toBe(true);
  });

  it('clears queued refresh work on reset', () => {
    const firstRefresh = handleRefresh(refreshRequested('ws-a'));

    expect(firstRefresh.next().value).toEqual(sagaEffects.call(doSyncWithGit, 'ws-a', true));

    const overlappingRefresh = handleRefresh(refreshRequested('ws-b'));
    expect(overlappingRefresh.next().done).toBe(true);

    resetTrackingState();

    firstRefresh.next();
    expect(firstRefresh.next('ws-a').value).toEqual(sagaEffects.call(doLoadWorkspaceData, 'ws-a'));
    expect(firstRefresh.next().done).toBe(true);
  });
});
