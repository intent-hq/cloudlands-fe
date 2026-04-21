import { describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import * as sagaEffects from "redux-saga/effects";

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
}));

vi.mock("$lib/utils/logger", () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock("$features/agent/deferred-results-cache", () => ({
  hasDeferredResults: vi.fn(),
  getDeferredResults: vi.fn(),
}));

import { hasDeferredResults, getDeferredResults } from "$features/agent/deferred-results-cache";
import { setExecutorState } from "../../background-agent-executor/background-agent-executor-slice";
import { selectExecutorState } from "../../background-agent-executor/background-agent-executor-selectors";
import {
  setSidebarCommitWhenReady,
  setSidebarCreatePRWhenReady,
  setSidebarMergeWhenReady,
  setPendingAutoAction,
  setCommitMessage,
  setPRTitle,
  setPRDescription,
} from "../../changes/changes-slice";
import {
  selectAcceptChangesState,
  selectSidebarCommitWhenReady,
  selectSidebarCreatePRWhenReady,
  selectSidebarMergeWhenReady,
} from "../../changes/changes-selectors";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { executorResultSaga } from "./executor-result-saga";

const emptyExecutorInstance = {
  status: "idle" as const,
  agentId: null,
  result: null,
  error: null,
  progress: 0,
  executionContext: null,
};

const defaultSidebarChangesProvides = [
  [matchers.select.selector(selectSidebarCommitWhenReady.select), false],
  [matchers.select.selector(selectSidebarCreatePRWhenReady.select), false],
  [matchers.select.selector(selectSidebarMergeWhenReady.select), false],
] as const;

describe("executorResultSaga", () => {
  it("watches setExecutorState and workspaceMounted", () => {
    const iterator = executorResultSaga();

    expect(iterator.next().value).toEqual(
      sagaEffects.takeEvery(setExecutorState, expect.any(Function)),
    );
    expect(iterator.next().value).toEqual(
      sagaEffects.takeEvery(workspaceMounted, expect.any(Function)),
    );
  });
});

describe("executor state change handling", () => {
  const wsId = "ws-1";

  it("sets commit message on commit executor success", async () => {
    await expectSaga(executorResultSaga)
      .provide([...defaultSidebarChangesProvides])
      .dispatch(setExecutorState(wsId, "commit", {
        status: "success",
        result: "feat: add new feature",
      }))
      .put(setCommitMessage(wsId, "feat: add new feature"))
      .silentRun(50);
  });

  it("sets PR title and description on pr executor success", async () => {
    await expectSaga(executorResultSaga)
      .provide([...defaultSidebarChangesProvides])
      .dispatch(setExecutorState(wsId, "pr", {
        status: "success",
        result: "# Fix login bug\n\nThis fixes the login flow.",
      }))
      .put(setPRTitle(wsId, "Fix login bug"))
      .put(setPRDescription(wsId, "This fixes the login flow."))
      .silentRun(50);
  });

  it("triggers auto-commit when commitWhenReady is true", async () => {
    await expectSaga(executorResultSaga)
      .provide([
        [matchers.select.selector(selectSidebarCommitWhenReady.select), true],
        [matchers.select.selector(selectSidebarCreatePRWhenReady.select), false],
        [matchers.select.selector(selectSidebarMergeWhenReady.select), false],
      ])
      .dispatch(setExecutorState(wsId, "commit", {
        status: "success",
        result: "feat: auto commit",
      }))
      .put(setCommitMessage(wsId, "feat: auto commit"))
      .put(setSidebarCommitWhenReady(wsId, false))
      .put(setPendingAutoAction(wsId, { action: "commit", workspaceId: wsId }))
      .silentRun(50);
  });

  it("clears commitWhenReady on commit executor error", async () => {
    await expectSaga(executorResultSaga)
      .dispatch(setExecutorState(wsId, "commit", { status: "error" }))
      .put(setSidebarCommitWhenReady(wsId, false))
      .silentRun(50);
  });

  it("clears createPRWhenReady on pr executor error", async () => {
    await expectSaga(executorResultSaga)
      .dispatch(setExecutorState(wsId, "pr", { status: "error" }))
      .put(setSidebarCreatePRWhenReady(wsId, false))
      .silentRun(50);
  });

  it("clears mergeWhenReady on commit-merge executor error", async () => {
    await expectSaga(executorResultSaga)
      .dispatch(setExecutorState(wsId, "commit-merge", { status: "error" }))
      .put(setSidebarMergeWhenReady(wsId, false))
      .silentRun(50);
  });

  it("triggers auto-PR with targetBranch when createPRWhenReady is true", async () => {
    await expectSaga(executorResultSaga)
      .provide([
        [matchers.select.selector(selectSidebarCommitWhenReady.select), false],
        [matchers.select.selector(selectSidebarCreatePRWhenReady.select), true],
        [matchers.select.selector(selectSidebarMergeWhenReady.select), false],
        [matchers.select.selector(selectExecutorState.select), {
          ...emptyExecutorInstance,
          executionContext: { targetBranch: "develop" },
        }],
      ])
      .dispatch(setExecutorState(wsId, "pr", {
        status: "success",
        result: "# Add feature X\n\nDetails about X.",
      }))
      .put(setPRTitle(wsId, "Add feature X"))
      .put(setPRDescription(wsId, "Details about X."))
      .put(setSidebarCreatePRWhenReady(wsId, false))
      .put(setPendingAutoAction(wsId, {
        action: "create-pr",
        workspaceId: wsId,
        targetBranch: "develop",
      }))
      .silentRun(50);
  });

  it("triggers auto-merge when mergeWhenReady is true on commit-merge success", async () => {
    await expectSaga(executorResultSaga)
      .provide([
        [matchers.select.selector(selectSidebarCommitWhenReady.select), false],
        [matchers.select.selector(selectSidebarCreatePRWhenReady.select), false],
        [matchers.select.selector(selectSidebarMergeWhenReady.select), true],
      ])
      .dispatch(setExecutorState(wsId, "commit-merge", {
        status: "success",
        result: "chore: merge feature",
      }))
      .put(setCommitMessage(wsId, "chore: merge feature"))
      .put(setSidebarMergeWhenReady(wsId, false))
      .put(setPendingAutoAction(wsId, { action: "merge", workspaceId: wsId }))
      .silentRun(50);
  });

});

describe("workspaceMounted handling", () => {
  const wsId = "ws-2";
  const emptyAcceptChanges = {
    commitMessage: "",
    prTitle: "",
    prDescription: "",
    isAutofillAndCommitting: false,
    isAutofillAndCreatingPR: false,
    pendingCommitAction: null,
    pendingPRContext: null,
    backgroundOperation: null,
  };

  it("restores deferred commit message on workspaceMounted", async () => {
    vi.mocked(hasDeferredResults).mockImplementation(
      (_ws, kind) => kind === "commit",
    );
    vi.mocked(getDeferredResults).mockImplementation(
      (_ws, kind) => (kind === "commit" ? ["deferred: restored message"] : []),
    );
    await expectSaga(executorResultSaga)
      .provide([
        [matchers.select.selector(selectAcceptChangesState.select), emptyAcceptChanges],
        ...defaultSidebarChangesProvides,
        [matchers.select.selector(selectExecutorState.select), emptyExecutorInstance],
      ])
      .dispatch(workspaceMounted(wsId))
      .put(setCommitMessage(wsId, "deferred: restored message"))
      .silentRun(50);
  });

  it("restores deferred PR result and triggers auto-PR when createPRWhenReady is true", async () => {
    vi.mocked(hasDeferredResults).mockImplementation(
      (_ws, kind) => kind === "pr",
    );
    vi.mocked(getDeferredResults).mockImplementation(
      (_ws, kind) =>
        kind === "pr"
          ? ["# Restored PR title\n\nRestored PR body."]
          : [],
    );
    await expectSaga(executorResultSaga)
      .provide([
        [matchers.select.selector(selectAcceptChangesState.select), emptyAcceptChanges],
        [matchers.select.selector(selectSidebarCommitWhenReady.select), false],
        [matchers.select.selector(selectSidebarCreatePRWhenReady.select), true],
        [matchers.select.selector(selectSidebarMergeWhenReady.select), false],
        [matchers.select.selector(selectExecutorState.select), emptyExecutorInstance],
      ])
      .dispatch(workspaceMounted(wsId))
      .put(setPRTitle(wsId, "Restored PR title"))
      .put(setPRDescription(wsId, "Restored PR body."))
      .put(setSidebarCreatePRWhenReady(wsId, false))
      .put(setPendingAutoAction(wsId, { action: "create-pr", workspaceId: wsId }))
      .silentRun(50);
  });
});