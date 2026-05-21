import { beforeEach, describe, it, vi } from 'vitest';
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
import { ChangeStage } from '$features/file-tracking/types';
import { emptyWorkspaceState, initialState, setChangesData } from '../changes-slice';
import type { TrackedChange } from '../changes-types';
import { refreshOpenFileContentForPathsRequested } from '../../files/files-slice';
import { doLoadWorkspaceData, resetTrackingState } from './changes-operations-saga';

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
});
