import { call, fork } from "typed-redux-saga";
import {
  initPersistenceSaga,
  watchHeightChanges,
  watchRenameTerminal,
  watchRemoveTerminalCustomName,
  watchWorkspaceState,
} from "./persistence-saga";
import { watchTerminalDisposed } from "./ipc-saga";
import { watchSetWorkspace, watchOpenWithWorkspace } from "./workspace-init-saga";

/**
 * Root saga for terminal overlay state management.
 * Forks all sub-sagas for persistence, IPC, and workspace initialization.
 */
export function* terminalOverlaySaga() {
  // Initialize from localStorage
  yield* call(initPersistenceSaga);

  // Fork persistence watchers
  yield* fork(watchHeightChanges);
  yield* fork(watchRenameTerminal);
  yield* fork(watchRemoveTerminalCustomName);
  yield* fork(watchWorkspaceState);

  // Fork IPC listener
  yield* fork(watchTerminalDisposed);

  // Fork workspace init watchers
  yield* fork(watchSetWorkspace);
  yield* fork(watchOpenWithWorkspace);
}

