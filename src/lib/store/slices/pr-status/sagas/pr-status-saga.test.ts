import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import * as sagaEffects from "redux-saga/effects";
import { readable } from "svelte/store";

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
  setContext: function* (props: any) {
    return yield sagaEffects.setContext(props);
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
import { selectWorkspaceById } from "$lib/store/slices/workspace/workspace-selectors";
import {
  initialState as workspaceInitialState,
  updateWorkspaceEntity,
} from "$lib/store/slices/workspace/workspace-slice";
import type { StoreState } from "$lib/store/types";
import { invoke } from "$lib/electron-bridge";
import { discoverPRsForBranch } from "./pr-status-saga";
import {
  PullRequestStatus,
  type PullRequestInfo,
} from "$shared/types";

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

const timestamp = "2026-01-01T00:00:00.000Z";

const createReadableStoreState = () => readable({
  storeUtility: { updatesLocked: false },
  workspace: workspaceInitialState,
} as StoreState);

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: "42",
    number: 42,
    url: "https://example.com/pull/42",
    title: "Test PR",
    status: PullRequestStatus.Open,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

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
      const storeState = createReadableStoreState();
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
      const storeState = createReadableStoreState();
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
      const storeState = createReadableStoreState();
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

    it("dispatches activePullRequest null when a tracked PR refreshes as merged", async () => {
      const storeState = createReadableStoreState();
      const { prStatusSaga } = await import("./pr-status-saga");
      const openPR = makePR({ status: PullRequestStatus.Open });
      const mergedPR = makePR({
        status: PullRequestStatus.Merged,
        mergedAt: "2026-01-02T00:00:00.000Z",
      });
      const workspace = {
        ...mockWorkspace,
        prNumber: openPR.number,
        prStatus: PullRequestStatus.Open,
        prUrl: openPR.url,
        pullRequests: [openPR],
        activePullRequest: openPR,
      };

      await expectSaga(prStatusSaga)
        .provide([
          [matchers.getContext("readableStoreState"), storeState],
          [matchers.select.selector(selectPRStatusLastRefreshTime.select), null],
          [matchers.select.selector(selectWorkspaceById.select), workspace],
          [matchers.call.fn(discoverPRsForBranch), { success: true, prs: [mergedPR] }],
          [matchers.call.fn(invoke), { success: true, data: mergedPR }],
        ])
        .dispatch(refreshPRStatusRequested("ws-1", true, false))
        .put(updateWorkspaceEntity("ws-1", {
          prStatus: PullRequestStatus.Merged,
          prNumber: mergedPR.number,
          prUrl: mergedPR.url,
          activePullRequest: null,
          pullRequests: [mergedPR],
        }))
        .silentRun(100);
    });
  });

  describe("discoverPRsForBranch baseRef matching", () => {
    it("matches an open PR whose sourceBranch equals baseRef after stripping allowlisted remote", async () => {
      const workspace = {
        id: "ws-review",
        branch: "local-review-branch",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "origin/feature",
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string) => {
        if (channel === "git-tracking:get-pull-requests") {
          return Promise.resolve({
            success: true,
            data: [
              { number: 42, sourceBranch: "feature", state: "open", title: "PR", url: "u" },
              { number: 43, sourceBranch: "other", state: "open", title: "Other", url: "u" },
            ],
          });
        }
        return Promise.resolve({ success: false });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-review", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toHaveLength(1);
      expect(result.returnValue.prs[0].number).toBe(42);
    });

    it("does NOT over-strip a slashed local baseRef", async () => {
      // Regression: baseRef="feature/foo" must not falsely match sourceBranch="foo".
      const workspace = {
        id: "ws-local",
        branch: "local-review-branch",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "feature/foo",
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string) => {
        if (channel === "git-tracking:get-pull-requests") {
          return Promise.resolve({
            success: true,
            data: [
              { number: 42, sourceBranch: "foo", state: "open", title: "Would-be-false-match", url: "u" },
            ],
          });
        }
        return Promise.resolve({ success: false });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-local", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toEqual([]);
    });
  });
});
