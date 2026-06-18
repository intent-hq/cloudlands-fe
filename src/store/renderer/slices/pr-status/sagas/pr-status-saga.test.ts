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
import {
  selectActiveWorkspace,
  selectWorkspaceById,
} from "$store/renderer/slices/workspace/workspace-selectors";
import {
  initialState as workspaceInitialState,
  updateWorkspaceEntity,
} from "$store/renderer/slices/workspace/workspace-slice";
import type { StoreState } from "$store/renderer/types";
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

function isDelayEffect(effect: { fn?: { name?: string }; args?: unknown[]; payload?: { fn?: { name?: string }; args?: unknown[] } }): boolean {
  const delayEffect = effect.fn ? effect : effect.payload;
  return delayEffect?.fn?.name === "delayP" && typeof delayEffect.args?.[0] === "number";
}

const createReadableStoreState = () => readable({
  "@internal_storeUtility": { updatesLocked: false },
  workspace: workspaceInitialState,
} as any as StoreState);

const createReduxStoreContext = () => {
  const state = {
    "@internal_storeUtility": { updatesLocked: false },
    workspace: workspaceInitialState,
  } as any as StoreState;

  return {
    getState: () => state,
    dispatch: vi.fn(),
    subscribe: (_listener: () => void) => () => {},
  };
};

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
	      const reduxStore = createReduxStoreContext();
      const { prStatusSaga } = await import("./pr-status-saga");

      await expectSaga(prStatusSaga)
        .provide([
	          [matchers.getContext("reduxStore"), reduxStore],
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
	      const reduxStore = createReduxStoreContext();
      const { prStatusSaga } = await import("./pr-status-saga");

      await expectSaga(prStatusSaga)
        .provide([
	          [matchers.getContext("reduxStore"), reduxStore],
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
	      const reduxStore = createReduxStoreContext();
      const { prStatusSaga } = await import("./pr-status-saga");

      await expectSaga(prStatusSaga)
        .provide([
	          [matchers.getContext("reduxStore"), reduxStore],
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
	      const reduxStore = createReduxStoreContext();
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
	          [matchers.getContext("reduxStore"), reduxStore],
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

  describe("active workspace polling", () => {
    it("polls the active workspace from one polling flow", async () => {
      const { pollActiveWorkspacePRStatus } = await import("./pr-status-saga");
      const activePR = makePR();
      let delayCount = 0;

      await expectSaga(pollActiveWorkspacePRStatus)
        .provide({
          call(effect, next) {
            if (isDelayEffect(effect)) {
              delayCount += 1;
              return delayCount === 1 ? undefined : new Promise(() => {});
            }
            return next();
          },
          select(effect, next) {
            if (effect.selector === selectActiveWorkspace.select) {
              return { ...mockWorkspace, id: "ws-active", activePullRequest: activePR };
            }
            return next();
          },
        })
        .put(refreshPRStatusRequested("ws-active", false, false))
        .silentRun(50);
    });

    it("registers a single global polling loop from the root saga", async () => {
      const { prStatusSaga, pollActiveWorkspacePRStatus } = await import("./pr-status-saga");
      const generator = prStatusSaga();

      const focusWatcher = generator.next().value as any;
      expect(focusWatcher.type).toBe("FORK");
      expect(focusWatcher.payload.fn.name).toBe("watchWindowFocus");

      expect(generator.next().value).toEqual(
        sagaEffects.fork(pollActiveWorkspacePRStatus),
      );

      const refreshWatcher = generator.next().value as any;
      expect(refreshWatcher.type).toBe("FORK");
      expect(refreshWatcher.payload.args[0]).toBe(refreshPRStatusRequested);
    });

    it("keeps the global polling loop idle when there is no active pull request", async () => {
      const { pollActiveWorkspacePRStatus } = await import("./pr-status-saga");
      const generator = pollActiveWorkspacePRStatus();

      expect(isDelayEffect(generator.next().value as any)).toBe(true);
      expect(generator.next().value).toEqual(
        sagaEffects.select(selectActiveWorkspace.select),
      );
      expect(isDelayEffect(generator.next(undefined).value as any)).toBe(true);

      expect(generator.next().value).toEqual(
        sagaEffects.select(selectActiveWorkspace.select),
      );
      expect(isDelayEffect(
        generator.next({ ...mockWorkspace, activePullRequest: null }).value as any,
      )).toBe(true);
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

    it("discovers a head-filtered PR even when the compact payload omits sourceBranch", async () => {
      // Step 2a: the server-side head filter already guarantees the match, so an
      // empty sourceBranch from the compact listing payload must not drop the PR.
      const workspace = {
        id: "ws-empty-src",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string) => {
        if (channel === "git-tracking:get-pull-requests") {
          return Promise.resolve({
            success: true,
            data: [
              { number: 42, sourceBranch: "", state: "open", title: "PR", url: "u" },
            ],
          });
        }
        return Promise.resolve({ success: false });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-empty-src", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toHaveLength(1);
      expect(result.returnValue.prs[0].number).toBe(42);
    });

    it("still excludes a head-filtered PR whose present sourceBranch does not match", async () => {
      const workspace = {
        id: "ws-mismatch",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string) => {
        if (channel === "git-tracking:get-pull-requests") {
          return Promise.resolve({
            success: true,
            data: [
              { number: 99, sourceBranch: "some-other-branch", state: "open", title: "Other", url: "u" },
            ],
          });
        }
        // No broad/search matches either.
        return Promise.resolve({ success: true, data: [] });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-mismatch", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toEqual([]);
    });

    it("resolves head ref via per-PR details lookup in the broad fallback when sourceBranch is empty", async () => {
      // Step 2a head-filtered fetch returns nothing; broad fallback returns a
      // compact PR with empty sourceBranch that must be resolved to match.
      const workspace = {
        id: "ws-broad",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string, payload: any) => {
        if (channel === "git-tracking:get-pull-requests") {
          // Head-filtered (has `head` option) returns empty; broad fetch returns compact PRs.
          if (payload?.options?.head) {
            return Promise.resolve({ success: true, data: [] });
          }
          return Promise.resolve({
            success: true,
            data: [
              { number: 7, sourceBranch: "", state: "open", title: "Mine", url: "u7" },
              { number: 8, sourceBranch: "", state: "open", title: "Unrelated", url: "u8" },
            ],
          });
        }
        if (channel === "git-tracking:get-pull-request") {
          if (payload?.number === 7) {
            return Promise.resolve({
              success: true,
              data: { number: 7, sourceBranch: "feature/test", state: "open", title: "Mine", url: "u7" },
            });
          }
          return Promise.resolve({
            success: true,
            data: { number: 8, sourceBranch: "different-branch", state: "open", title: "Unrelated", url: "u8" },
          });
        }
        return Promise.resolve({ success: false });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-broad", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toHaveLength(1);
      expect(result.returnValue.prs[0].number).toBe(7);
    });
  });

  describe("discoverPRsForBranch known-PR retention", () => {
    it("(a) keeps a known open PR by number when 2a/2b/3 return empty", async () => {
      const workspace = {
        id: "ws-known",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
        pullRequests: [makePR({ number: 50, status: PullRequestStatus.Open })],
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string, payload: any) => {
        if (channel === "git-tracking:get-pull-request" && payload?.number === 50) {
          return Promise.resolve({
            success: true,
            data: { number: 50, sourceBranch: "feature/test", state: "open", title: "Known", url: "u50" },
          });
        }
        // All branch-list queries come back empty.
        return Promise.resolve({ success: true, data: [] });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-known", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toHaveLength(1);
      expect(result.returnValue.prs[0].number).toBe(50);
      expect(result.returnValue.prs[0].status).toBe(PullRequestStatus.Open);
    });

    it("(b) re-fetches and retains multiple known open PRs", async () => {
      const workspace = {
        id: "ws-multi",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
        pullRequests: [
          makePR({ number: 50, status: PullRequestStatus.Open }),
          makePR({ number: 51, status: PullRequestStatus.Draft }),
        ],
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string, payload: any) => {
        if (channel === "git-tracking:get-pull-request") {
          if (payload?.number === 50) {
            return Promise.resolve({
              success: true,
              data: { number: 50, sourceBranch: "feature/test", state: "open", title: "K50", url: "u50" },
            });
          }
          return Promise.resolve({
            success: true,
            data: { number: 51, sourceBranch: "feature/test", state: "open", draft: true, title: "K51", url: "u51" },
          });
        }
        return Promise.resolve({ success: true, data: [] });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-multi", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      const numbers = result.returnValue.prs.map((pr: PullRequestInfo) => pr.number).sort();
      expect(numbers).toEqual([50, 51]);
    });

    it("(c) still surfaces a newly discovered PR not previously known", async () => {
      const workspace = {
        id: "ws-new",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
        pullRequests: [],
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string) => {
        if (channel === "git-tracking:get-pull-requests") {
          return Promise.resolve({
            success: true,
            data: [
              { number: 77, sourceBranch: "feature/test", state: "open", title: "New", url: "u77" },
            ],
          });
        }
        return Promise.resolve({ success: false });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-new", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toHaveLength(1);
      expect(result.returnValue.prs[0].number).toBe(77);
    });

    it("(d) does not double-count a PR that is both known and head-filter-matched", async () => {
      const workspace = {
        id: "ws-dup",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
        pullRequests: [makePR({ number: 42, status: PullRequestStatus.Open })],
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string, payload: any) => {
        if (channel === "git-tracking:get-pull-request" && payload?.number === 42) {
          return Promise.resolve({
            success: true,
            data: { number: 42, sourceBranch: "feature/test", state: "open", title: "Dup", url: "u42" },
          });
        }
        if (channel === "git-tracking:get-pull-requests") {
          return Promise.resolve({
            success: true,
            data: [
              { number: 42, sourceBranch: "feature/test", state: "open", title: "Dup", url: "u42" },
            ],
          });
        }
        return Promise.resolve({ success: false });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-dup", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toHaveLength(1);
      expect(result.returnValue.prs[0].number).toBe(42);
    });

    it("(e) leaves stored-prNumber branch-mismatch behavior unchanged", async () => {
      const workspace = {
        id: "ws-stored-mismatch",
        branch: "feature/test",
        repositoryOwner: "testorg",
        repositoryName: "testrepo",
        baseRef: "main",
        prNumber: 99,
      } as any;

      vi.mocked(invoke).mockImplementation(((channel: string, payload: any) => {
        if (channel === "git-tracking:get-pull-request" && payload?.number === 99) {
          return Promise.resolve({
            success: true,
            data: { number: 99, sourceBranch: "some-other-branch", state: "open", title: "Mismatch", url: "u99" },
          });
        }
        // No branch-list matches either.
        return Promise.resolve({ success: true, data: [] });
      }) as any);

      const result = await expectSaga(discoverPRsForBranch, "ws-stored-mismatch", workspace, true)
        .silentRun(100);

      expect(result.returnValue.success).toBe(true);
      expect(result.returnValue.prs).toEqual([]);
    });
  });
});
