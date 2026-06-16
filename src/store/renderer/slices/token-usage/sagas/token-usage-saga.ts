/**
 * Token Usage Saga (renderer)
 *
 * Fetches per-workspace token usage snapshots over IPC and mirrors
 * main-process pushes:
 * - `fetchWorkspaceTokenUsage` invokes `TOKEN_USAGE_CHANNELS.GET` with a
 *   single-in-flight guard per workspace (no fetch storms).
 * - Subscribes to `TOKEN_USAGE_CHANNELS.CHANGED` pushes via an eventChannel.
 * - Re-fetches the active workspace on a slow 5-minute interval; the main
 *   process enforces its own scan throttle, so polling only refreshes the
 *   renderer mirror.
 * - Prunes workspace state on `workspaceUnmounted` (main only prunes on
 *   workspace deletion).
 */

import {
  call,
  cancel,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import type { Task } from "redux-saga";
import { invoke, isElectron } from "$lib/electron-bridge";
import { TOKEN_USAGE_CHANNELS } from "$shared/ipc/channels";
import { takeEveryFromElectronChannel } from "../../../utils/ipc-channel";
import type { WorkspaceTokenUsageSnapshot } from "../../../../../features/token-usage/token-usage-types";
import {
  clearActiveWorkspace,
  setActiveWorkspaceId,
} from "../../workspace/workspace-slice";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  clearWorkspaceTokenUsage,
  fetchWorkspaceTokenUsage,
  tokenUsageFetchFailed,
  tokenUsageReceived,
} from "../token-usage-slice";

/** Slow refresh interval for the active workspace (5 minutes). */
export const TOKEN_USAGE_POLL_INTERVAL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

async function fetchTokenUsageFromIpc(
  wsId: string,
): Promise<WorkspaceTokenUsageSnapshot> {
  if (!isElectron()) {
    throw new Error("IPC not available");
  }
  const result = await invoke<{
    success: boolean;
    data?: WorkspaceTokenUsageSnapshot;
    error?: unknown;
  }>(TOKEN_USAGE_CHANNELS.GET, { workspaceId: wsId });
  if (!result || !result.success || !result.data) {
    const rawErr = result?.error;
    const errMsg =
      typeof rawErr === "string"
        ? rawErr
        : rawErr != null
          ? JSON.stringify(rawErr)
          : "Failed to fetch token usage";
    throw new Error(errMsg);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Saga handlers
// ---------------------------------------------------------------------------

export function* handleFetchWorkspaceTokenUsage(
  action: ReturnType<typeof fetchWorkspaceTokenUsage>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  try {
    const snapshot = yield* call(fetchTokenUsageFromIpc, wsId);
    yield* put(tokenUsageReceived(wsId, snapshot));
  } catch {
    yield* put(tokenUsageFetchFailed(wsId));
  }
}

export function* handleTokenUsageChanged(
  snapshot: WorkspaceTokenUsageSnapshot,
): SagaGenerator<void> {
  yield* put(tokenUsageReceived(snapshot.workspaceId, snapshot));
}

// ---------------------------------------------------------------------------
// Active-workspace polling (mirrors session-stats polling ownership)
// ---------------------------------------------------------------------------

export function* refreshActiveWorkspaceTokenUsage(
  unmountedWorkspaceIds: Set<string>,
): SagaGenerator<void> {
  const wsId: string | null = yield* selectActiveWorkspaceId.effect();
  if (!wsId || unmountedWorkspaceIds.has(wsId)) {
    return;
  }
  yield* put(fetchWorkspaceTokenUsage(wsId));
}

type PollingWakeAction =
  | ReturnType<typeof setActiveWorkspaceId>
  | ReturnType<typeof clearActiveWorkspace>
  | ReturnType<typeof workspaceMounted>
  | ReturnType<typeof workspaceUnmounted>;

function updateUnmountedPollingWorkspaces(
  action: PollingWakeAction,
  unmountedWorkspaceIds: Set<string>,
): boolean {
  const wsId = action.payload?.[0];

  if (action.type === workspaceUnmounted.type) {
    if (wsId) {
      unmountedWorkspaceIds.add(wsId);
    }
    return false;
  }

  if (action.type === workspaceMounted.type) {
    return wsId ? unmountedWorkspaceIds.delete(wsId) : false;
  }

  if (action.type === setActiveWorkspaceId.type && wsId) {
    unmountedWorkspaceIds.delete(wsId);
  }

  return true;
}

function* waitForNextPollingRefresh(
  unmountedWorkspaceIds: Set<string>,
): SagaGenerator<boolean> {
  const result: { wakeAction?: PollingWakeAction } = yield* race({
    interval: delay(TOKEN_USAGE_POLL_INTERVAL_MS),
    wakeAction: take([
      setActiveWorkspaceId,
      clearActiveWorkspace,
      workspaceMounted,
      workspaceUnmounted,
    ]),
  });

  return result.wakeAction
    ? updateUnmountedPollingWorkspaces(result.wakeAction, unmountedWorkspaceIds)
    : true;
}

/** One long-lived polling owner. It selects the active workspace internally. */
function* tokenUsagePollingLoop(): SagaGenerator<void> {
  const unmountedWorkspaceIds = new Set<string>();
  let shouldRefresh = true;

  while (true) {
    if (shouldRefresh) {
      yield* call(refreshActiveWorkspaceTokenUsage, unmountedWorkspaceIds);
    }

    shouldRefresh = yield* call(waitForNextPollingRefresh, unmountedWorkspaceIds);
  }
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* tokenUsageSaga(): SagaGenerator<void> {
  const fetchTasks: Record<string, Task> = {};

  // Single in-flight fetch per workspace: overlapping requests are dropped.
  yield* takeEvery(
    fetchWorkspaceTokenUsage,
    function* (action: ReturnType<typeof fetchWorkspaceTokenUsage>) {
      const [wsId] = action.payload;
      if (fetchTasks[wsId]) {
        return;
      }

      const task: Task = yield* fork(function* () {
        try {
          yield* call(handleFetchWorkspaceTokenUsage, action);
        } finally {
          if (fetchTasks[wsId] === task) {
            delete fetchTasks[wsId];
          }
        }
      });
      fetchTasks[wsId] = task;
    },
  );

  // Main-process pushes updated snapshots after each completed scan.
  yield* takeEveryFromElectronChannel<WorkspaceTokenUsageSnapshot>(
    TOKEN_USAGE_CHANNELS.CHANGED,
    handleTokenUsageChanged,
  );

  // Unmount: cancel any in-flight fetch and prune the workspace entry.
  yield* takeEvery(
    workspaceUnmounted,
    function* (action: ReturnType<typeof workspaceUnmounted>) {
      const [wsId] = action.payload;
      const task = fetchTasks[wsId];
      if (task) {
        delete fetchTasks[wsId];
        yield* cancel(task);
      }
      yield* put(clearWorkspaceTokenUsage(wsId));
    },
  );

  yield* fork(tokenUsagePollingLoop);
}

