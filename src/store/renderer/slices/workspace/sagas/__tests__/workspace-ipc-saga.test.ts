import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

// Must mock typed-redux-saga BEFORE importing saga modules
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
}));

const {
  takeEveryFromElectronChannelMock,
  takeEveryFromListenSyncMock,
  mockAppStoreFactory,
  mockDelete,
} = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
  mockAppStoreFactory: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("$store/renderer/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

vi.mock("$store/renderer/store", async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => mockAppStoreFactory()?.getState?.() ?? {},
    dispatch: (...args: any[]) => mockAppStoreFactory()?.dispatch?.(...args),
  });
});

vi.mock("$store/renderer/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: { delete: mockDelete },
}));

import {
  applyOptimisticTaskStatusUpdate,
  updateWorkspaceEntity,
} from "../../workspace-slice";
import { WorkspaceId } from "$shared/types/branded-ids";
import {
  watchWorkspaceUpdatedSaga,
  watchWorkspaceBackgroundEnrichmentSaga,
  watchTaskStatusChangedSaga,
  watchWorkspaceBeforeUnloadSaga,
  workspaceIpcSaga,
  WORKSPACE_BEFORE_UNLOAD_POLL_MS,
} from "../workspace-ipc-saga";

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("workspace-ipc-saga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppStoreFactory.mockReturnValue({
      getState: () => ({
        workspace: { pendingDeletions: { "ws-1": true } },
      }),
    });
  });

  it("forks all IPC sub-sagas", () => {
    testSaga(workspaceIpcSaga)
      .next()
      .fork(watchWorkspaceUpdatedSaga)
      .next()
      .fork(watchWorkspaceBackgroundEnrichmentSaga)
      .next()
      .fork(watchTaskStatusChangedSaga)
      .next()
      .fork(watchWorkspaceBeforeUnloadSaga)
      .next()
      .isDone();
  });

  describe("watchWorkspaceUpdatedSaga", () => {
    it("dispatches updateWorkspaceEntity on workspace:updated", () => {
      watchWorkspaceUpdatedSaga().next();

      const handler = getListenSyncHandler("workspace:updated");
      const effect = handler({
        workspaceId: "ws-1",
        changes: { title: "New Title" },
      }).next().value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-1", { title: "New Title" }),
      );
    });
  });

  describe("watchWorkspaceBackgroundEnrichmentSaga", () => {
    it("dispatches updateWorkspaceEntity on enrichment complete", () => {
      watchWorkspaceBackgroundEnrichmentSaga().next();

      const handler = getElectronHandler("workspace:background-enrichment-complete");
      const effect = handler({
        workspaceId: "ws-1",
        updates: { diffSummary: "Summary" },
      }).next().value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-1", { diffSummary: "Summary" }),
      );
    });

    it("is a no-op when workspaceId or updates is missing", () => {
      watchWorkspaceBackgroundEnrichmentSaga().next();

      const handler = getElectronHandler("workspace:background-enrichment-complete");
      const result = handler({ workspaceId: null, updates: null }).next();
      expect(result.done).toBe(true);
    });
  });

  describe("watchTaskStatusChangedSaga", () => {
    it("dispatches applyOptimisticTaskStatusUpdate on task:status-changed", () => {
      watchTaskStatusChangedSaga().next();

      const payload = {
        workspaceId: "ws-1",
        previousStatus: "in_progress",
        newStatus: "complete",
      };
      const handler = getListenSyncHandler("task:status-changed");
      const effect = handler(payload).next().value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(applyOptimisticTaskStatusUpdate(payload));
    });
  });

  describe("watchWorkspaceBeforeUnloadSaga", () => {
    it("registers a beforeunload listener that flushes pending deletions", () => {
      const iterator = watchWorkspaceBeforeUnloadSaga();

      // 1. Initial snapshot of pending deletions via selector effect
      const selectEffect = iterator.next().value as any;
      expect(selectEffect.type).toBe("SELECT");

      // 2. Fork a takeLatestFromSelector subscription to keep snapshot fresh
      const forkEffect = iterator.next({ "ws-1": true }).value as any;
      expect(forkEffect.type).toBe("FORK");

      // 3. Register the beforeunload listener via a CALL effect
      const callEffect = iterator.next().value as any;
      expect(callEffect.type).toBe("CALL");

      // Execute the handler function to verify it calls workspaceClient.delete
      const handler = callEffect.payload.args[0] as () => void;
      handler();
      expect(mockDelete).toHaveBeenCalledWith(WorkspaceId("ws-1"));

      // Next yield is the delay loop
      expect(iterator.next(() => {}).value).toEqual(
        sagaEffects.delay(WORKSPACE_BEFORE_UNLOAD_POLL_MS),
      );
    });
  });
});

