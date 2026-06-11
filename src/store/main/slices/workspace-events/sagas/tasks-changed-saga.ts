/**
 * Tasks-changed notification saga.
 *
 * Watches accepted workspace events that may affect a workspace's task set or
 * task statuses and emits a payload-light 'workspace:tasks-changed' IPC event
 * so renderers can re-fetch tasks on demand (WORKSPACE_CHANNELS.GET_TASKS).
 *
 * Notifications are debounced per workspace (trailing edge) to coalesce event
 * storms such as rapid note updates during editing.
 *
 * Uses dynamic imports to keep Electron deps out of test bundles.
 */

import {
  call,
  cancelled,
  takeEvery,
} from "typed-redux-saga";
import { workspaceEventAccepted } from "../workspace-events-slice";

/** Event types that may change the workspace task set or task statuses. */
const TASK_AFFECTING_EVENT_TYPES = new Set([
  "task:status-changed",
  "note:created",
  "note:updated",
  "note:deleted",
]);

/** Trailing debounce window per workspace. */
export const TASKS_CHANGED_DEBOUNCE_MS = 250;

// Per-workspace pending debounce timers
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Clear all pending debounce timers (saga cancellation / tests). */
export function clearPendingTasksChangedTimers(): void {
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
}

/**
 * Broadcast 'workspace:tasks-changed' to renderer windows viewing the workspace.
 */
export async function broadcastTasksChanged(workspaceId: string): Promise<void> {
  // Dynamic import to avoid Electron deps in test bundles
  const { sendToWorkspaceWindows } = await import(
    "../../../../../features/system/main/system.ipc"
  );
  sendToWorkspaceWindows(workspaceId, "workspace:tasks-changed", { workspaceId });
}

/**
 * Schedule a debounced tasks-changed broadcast for a workspace.
 * Subsequent calls within the window reset the trailing timer.
 */
export function scheduleTasksChangedBroadcast(workspaceId: string): void {
  const existing = pendingTimers.get(workspaceId);
  if (existing) {
    clearTimeout(existing);
  }
  pendingTimers.set(
    workspaceId,
    setTimeout(() => {
      pendingTimers.delete(workspaceId);
      void broadcastTasksChanged(workspaceId).catch(() => {
        // Broadcast failures are non-fatal; renderers re-fetch on next change
      });
    }, TASKS_CHANGED_DEBOUNCE_MS),
  );
}

export function* handleTasksChangedEvent(
  action: ReturnType<typeof workspaceEventAccepted>,
) {
  const [event] = action.payload;
  if (!event.workspaceId || !TASK_AFFECTING_EVENT_TYPES.has(event.type)) {
    return;
  }
  yield* call(scheduleTasksChangedBroadcast, event.workspaceId);
}

export function* workspaceTasksChangedSaga() {
  try {
    yield* takeEvery(workspaceEventAccepted, handleTasksChangedEvent);
  } finally {
    if (yield* cancelled()) {
      clearPendingTasksChangedTimers();
    }
  }
}

