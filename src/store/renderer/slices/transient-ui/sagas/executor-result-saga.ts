/**
 * Executor Result Saga
 *
 * Watches background agent executor state changes and handles:
 * 1. Form field updates (commitMessage, prTitle, prDescription) from executor results
 * 2. Auto-action triggers (commitWhenReady, createPRWhenReady, mergeWhenReady)
 * 3. PR executor reconnection on workspace mount
 *
 * Replaces the $effect blocks in SidebarChangesPanel.svelte that were doing
 * this orchestration reactively.
 */

import {
  call,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import { Logger } from "$lib/utils/logger";
import {
  reconnectAgent,
  setExecutorState,
} from "../../background-agent-executor/background-agent-executor-slice";
import { selectExecutorState } from "../../background-agent-executor/background-agent-executor-selectors";
import type { ExecutorStatus } from "../../background-agent-executor/background-agent-executor-types";
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

const logger = new Logger({ category: "ExecutorResultSaga" });

/**
 * Parse a PR description result into title and description.
 * The first line (stripped of leading #) is the title, the rest is the description.
 */
function parsePRResult(result: string): { title: string; description: string } {
  const lines = result.trim().split("\n");
  const title = lines[0]?.replace(/^#\s*/, "").trim() ?? "";
  const description = lines.slice(1).join("\n").trim();
  return { title, description };
}

/**
 * Handle executor state changes dispatched by the background agent executor saga.
 * When an executor succeeds, update form fields and check for auto-action triggers.
 */
function* handleExecutorStateChange(
  action: ReturnType<typeof setExecutorState>,
): SagaGenerator<void> {
  const [workspaceId, executorType, updates] = action.payload;

  const hasSuccessResult = updates.status === "success" && Boolean(updates.result);
  const hasError = updates.status === "error";

  // Only care about terminal states with results/errors.
  if (!hasSuccessResult && !hasError) {
    return;
  }

  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) {
    logger.warn("Skipping executor result for missing workspace", {
      workspaceId,
      executorType,
      status: updates.status,
    });
    return;
  }

  if (hasSuccessResult && updates.result) {
    yield* call(handleExecutorSuccess, workspaceId, executorType, updates.result);
  } else if (hasError) {
    yield* call(handleExecutorError, workspaceId, executorType);
  }
}

function* handleExecutorSuccess(
  workspaceId: string,
  executorType: string,
  result: string,
): SagaGenerator<void> {
  if (executorType === "commit") {
    yield* put(setCommitMessage(workspaceId, result));

    const commitWhenReady = yield* selectSidebarCommitWhenReady.effect(workspaceId);
    if (commitWhenReady) {
      yield* put(setSidebarCommitWhenReady(workspaceId, false));
      yield* put(setPendingAutoAction(workspaceId, {
        action: "commit",
        workspaceId,
      }));
    }
  } else if (executorType === "pr") {
    const { title, description } = parsePRResult(result);
    if (title) {
      yield* put(setPRTitle(workspaceId, title));
    }
    if (description) {
      yield* put(setPRDescription(workspaceId, description));
    }

    const createPRWhenReady = yield* selectSidebarCreatePRWhenReady.effect(workspaceId);
    if (createPRWhenReady) {
      yield* put(setSidebarCreatePRWhenReady(workspaceId, false));
      // Read the executor state to get the execution context (target branch)
      const execState = yield* selectExecutorState.effect(workspaceId, "pr");
      yield* put(setPendingAutoAction(workspaceId, {
        action: "create-pr",
        workspaceId,
        targetBranch: execState.executionContext?.targetBranch as string | undefined,
      }));
    }
  } else if (executorType === "commit-merge") {
    yield* put(setCommitMessage(workspaceId, result));

    const mergeWhenReady = yield* selectSidebarMergeWhenReady.effect(workspaceId);
    if (mergeWhenReady) {
      yield* put(setSidebarMergeWhenReady(workspaceId, false));
      yield* put(setPendingAutoAction(workspaceId, {
        action: "merge",
        workspaceId,
      }));
    }
  }
}

function* handleExecutorError(
  workspaceId: string,
  executorType: string,
): SagaGenerator<void> {
  if (executorType === "commit") {
    yield* put(setSidebarCommitWhenReady(workspaceId, false));
  } else if (executorType === "pr") {
    yield* put(setSidebarCreatePRWhenReady(workspaceId, false));
  } else if (executorType === "commit-merge") {
    yield* put(setSidebarMergeWhenReady(workspaceId, false));
  }
}

/**
 * Handle PR executor reconnection on workspace mount.
 * If a PR executor was running when the user navigated away, reconnect to it.
 */
function* handlePRExecutorReconnection(
  workspaceId: string,
): SagaGenerator<void> {
  const prExecState = yield* selectExecutorState.effect(workspaceId, "pr");
  const createPRWhenReady = yield* selectSidebarCreatePRWhenReady.effect(workspaceId);

  // Only reconnect if we have a persisted executor state with an agentId
  if (!prExecState.agentId) return;

  const { agentId, status: savedStatus, result } = prExecState;

  if (savedStatus === "running" || savedStatus === "initializing") {
    // Restore createPRWhenReady from persisted state
    if (createPRWhenReady) {
      // Already set in Redux — no-op needed, saga will handle it when executor completes
    }
    logger.info("[ExecutorResultSaga] Reconnecting to running PR executor", {
      agentId,
      savedStatus,
      createPRWhenReady,
    });
    yield* put(
      reconnectAgent(workspaceId, "pr", agentId, {
        status: savedStatus as ExecutorStatus,
        result,
      }),
    );
  } else if (savedStatus === "success" && result) {
    logger.info("[ExecutorResultSaga] Restoring completed PR executor result", {
      agentId,
      createPRWhenReady,
    });
    yield* put(
      reconnectAgent(workspaceId, "pr", agentId, {
        status: savedStatus as ExecutorStatus,
        result,
      }),
    );
  }
}

/**
 * Handle workspace mounted: reconnect PR executor.
 */
function* handleWorkspaceMountedForExecutors(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* call(handlePRExecutorReconnection, workspaceId);
}

// ── Root Saga ──

export function* executorResultSaga(): SagaGenerator<void> {
  yield* takeEvery(setExecutorState, handleExecutorStateChange);
  yield* takeEvery(workspaceMounted, handleWorkspaceMountedForExecutors);
}
