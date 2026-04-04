import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import * as sagaEffects from "redux-saga/effects";

// Must mock typed-redux-saga before importing saga modules
vi.mock("typed-redux-saga", () => ({
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
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
  cancelled: function* () {
    return yield sagaEffects.cancelled();
  },
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
  spawn: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.spawn(fn, ...args);
  },
  getContext: function* (key: string) {
    return yield sagaEffects.getContext(key);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

vi.mock("$lib/utils/client-logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

// Import after mocks
import {
  refreshPRStatusRequested,
  prStatusRefreshCompleted,
} from "../pr-status-slice";
import { selectPRStatusLastRefreshTime } from "../pr-status-selectors";
import {
  selectWorkspaceById,
} from "$lib/store/slices/workspace/workspace-selectors";
import { init } from "$lib/store/init";

// Access the handleRefreshPRStatus handler through the module
// We'll test via the saga's takeLatest behavior



const mockWorkspace = {
  id: "ws-1",
  branch: "feature/test",
  repositoryOwner: "testorg",
  repositoryName: "testrepo",
  prNumber: null,
  pullRequests: [],
  activePullRequest: null,
  baseRef: "main",
};

describe("PR Status Saga", () => {
  const FIXED_NOW = 1000000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleRefreshPRStatus", () => {
    it("skips refresh when rate limited", async () => {
      const { storeState } = init();
      const { prStatusSaga } = await import("./pr-status-saga");

      await expectSaga(prStatusSaga)
        .provide([
          [matchers.getContext("readableStoreState"), storeState],
          [matchers.select.selector(selectPRStatusLastRefreshTime.select), Date.now() - 1000],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
        ])
        .dispatch(refreshPRStatusRequested("ws-1", false, false))
        .put(prStatusRefreshCompleted("ws-1", true))
        .silentRun(100);
    });

    it("returns error when workspace not found", async () => {
      const { storeState } = init();
      const { prStatusSaga } = await import("./pr-status-saga");

      await expectSaga(prStatusSaga)
        .provide([
          [matchers.getContext("readableStoreState"), storeState],
          [matchers.select.selector(selectPRStatusLastRefreshTime.select), null],
          [matchers.select.selector(selectWorkspaceById.select), undefined],
        ])
        .dispatch(refreshPRStatusRequested("ws-1", true, false))
        .put(prStatusRefreshCompleted("ws-1", false, "Workspace not found"))
        .silentRun(100);
    });

    it("returns error when missing repo info", async () => {
      const { storeState } = init();
      const { prStatusSaga } = await import("./pr-status-saga");

      await expectSaga(prStatusSaga)
        .provide([
          [matchers.getContext("readableStoreState"), storeState],
          [matchers.select.selector(selectPRStatusLastRefreshTime.select), null],
          [matchers.select.selector(selectWorkspaceById.select), { ...mockWorkspace, repositoryOwner: null }],
        ])
        .dispatch(refreshPRStatusRequested("ws-1", true, false))
        .put(prStatusRefreshCompleted("ws-1", false, "Missing repository info"))
        .silentRun(100);
    });
  });
});