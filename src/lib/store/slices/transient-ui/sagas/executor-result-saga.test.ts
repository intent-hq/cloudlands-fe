import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

import {
  reconnectAgent,
  setExecutorState,
} from "../../background-agent-executor/background-agent-executor-slice";
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
  selectSidebarCommitWhenReady,
  selectSidebarCreatePRWhenReady,
  selectSidebarMergeWhenReady,
} from "../../changes/changes-selectors";
import { selectWorkspaceById } from "../../workspace/workspace-selectors";
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

const workspacePresenceProvide = (workspaceId: string) => [
  matchers.select.selector(selectWorkspaceById.select),
  { id: workspaceId },
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

  it("sets commit message on commit executor success when workspace exists", async () => {
    await expectSaga(executorResultSaga)
      .provide([
        workspacePresenceProvide(wsId),
        ...defaultSidebarChangesProvides,
      ])
      .dispatch(setExecutorState(wsId, "commit", {
        status: "success",
        result: "feat: add new feature",
      }))
      .put(setCommitMessage(wsId, "feat: add new feature"))
      .silentRun(50);
  });

  it("sets PR title and description on pr executor success", async () => {
    await expectSaga(executorResultSaga)
      .provide([
        workspacePresenceProvide(wsId),
        ...defaultSidebarChangesProvides,
      ])
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
        workspacePresenceProvide(wsId),
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
      .provide([workspacePresenceProvide(wsId)])
      .dispatch(setExecutorState(wsId, "commit", { status: "error" }))
      .put(setSidebarCommitWhenReady(wsId, false))
      .silentRun(50);
  });

  it("clears createPRWhenReady on pr executor error", async () => {
    await expectSaga(executorResultSaga)
      .provide([workspacePresenceProvide(wsId)])
      .dispatch(setExecutorState(wsId, "pr", { status: "error" }))
      .put(setSidebarCreatePRWhenReady(wsId, false))
      .silentRun(50);
  });

  it("clears mergeWhenReady on commit-merge executor error", async () => {
    await expectSaga(executorResultSaga)
      .provide([workspacePresenceProvide(wsId)])
      .dispatch(setExecutorState(wsId, "commit-merge", { status: "error" }))
      .put(setSidebarMergeWhenReady(wsId, false))
      .silentRun(50);
  });

  it("triggers auto-PR with targetBranch when createPRWhenReady is true", async () => {
    await expectSaga(executorResultSaga)
      .provide([
        workspacePresenceProvide(wsId),
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
        workspacePresenceProvide(wsId),
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

  it("skips result application when workspace is missing from Redux", async () => {
    await expectSaga(executorResultSaga)
      .provide([
        [matchers.select.selector(selectWorkspaceById.select), undefined],
        ...defaultSidebarChangesProvides,
      ])
      .dispatch(setExecutorState(wsId, "commit", {
        status: "success",
        result: "feat: skipped orphan result",
      }))
      .not.put(setCommitMessage(wsId, "feat: skipped orphan result"))
      .silentRun(50);
  });

});

describe("workspaceMounted handling", () => {
  const wsId = "ws-2";

  it("reconnects a running PR executor on workspaceMounted", async () => {
    const runningPRExecutor = {
      ...emptyExecutorInstance,
      status: "running" as const,
      agentId: "agent-1",
    };

    await expectSaga(executorResultSaga)
      .provide([
        [matchers.select.selector(selectExecutorState.select), runningPRExecutor],
        [matchers.select.selector(selectSidebarCreatePRWhenReady.select), false],
      ])
      .dispatch(workspaceMounted(wsId))
      .put(reconnectAgent(wsId, "pr", "agent-1", {
        status: "running",
        result: null,
      }))
      .silentRun(50);
  });
});
