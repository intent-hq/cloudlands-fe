import { call, cancel, fork, takeEvery } from "typed-redux-saga";
import type { Task } from "redux-saga";
import {
  initPersistenceSaga,
  watchHeightChanges,
  watchRenameTerminal,
  watchRemoveTerminalCustomName,
  watchWorkspaceState,
} from "./persistence-saga";
import { watchTerminalCreated, watchTerminalDisposed } from "./ipc-saga";
import { watchSetWorkspace, watchOpenWithWorkspace } from "./workspace-init-saga";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";

const workspaceTerminalTasks = new Map<string, Task[]>();

function* handleWorkspaceMounted(action: ReturnType<typeof workspaceMounted>) {
  const [wsId] = action.payload;
  const terminalCreatedTask = yield* fork(watchTerminalCreated, wsId);
  workspaceTerminalTasks.set(wsId, [terminalCreatedTask]);
}

function* handleWorkspaceUnmounted(action: ReturnType<typeof workspaceUnmounted>) {
  const [wsId] = action.payload;
  const tasks = workspaceTerminalTasks.get(wsId);
  if (!tasks) return;
  for (const task of tasks) {
    yield* cancel(task);
  }
  workspaceTerminalTasks.delete(wsId);
}

/**
 * Root saga for terminal overlay state management.
 * Forks all sub-sagas for persistence, IPC, and workspace initialization.
 */
export function* terminalsSaga() {
  // Initialize from localStorage
  yield* call(initPersistenceSaga);

  // Fork persistence watchers
  yield* fork(watchHeightChanges);
  yield* fork(watchRenameTerminal);
  yield* fork(watchRemoveTerminalCustomName);
  yield* fork(watchWorkspaceState);

  // Fork IPC listener for terminal:disposed events (uses saga channel)
  yield* fork(watchTerminalDisposed);

  // Fork workspace init watchers
  yield* fork(watchSetWorkspace);
  yield* fork(watchOpenWithWorkspace);

  // Fork workspace lifecycle watchers (consolidated from workspace-terminals)
  yield* takeEvery(workspaceMounted, handleWorkspaceMounted);
  yield* takeEvery(workspaceUnmounted, handleWorkspaceUnmounted);
}

