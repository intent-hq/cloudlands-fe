import {
  call,
  put,
  takeEvery,
} from "typed-redux-saga";
import {
  closeActiveTerminalRequested,
  removeTerminal,
} from "../terminals-slice";
import { selectActiveTerminalIdForWorkspace } from "../terminals-selectors";

async function loadTerminalManager() {
  const { terminalManager } = await import("$features/terminal/terminal-manager.svelte");
  return terminalManager;
}

/**
 * Watches for keyboard-triggered "close active terminal" requests
 * (e.g., Cmd+W when a terminal is focused). Component-driven tab
 * close (e.g., the X button) continues to use the local closeTerminal
 * helper in the overlay components.
 */
export function* watchCloseActiveTerminal() {
  yield* takeEvery(
    closeActiveTerminalRequested,
    function* ({ payload }: ReturnType<typeof closeActiveTerminalRequested>) {
      const [wsId] = payload;
      if (!wsId) return;
      const activeTerminalId = yield* selectActiveTerminalIdForWorkspace.effect(wsId);
      if (!activeTerminalId) return;
      yield* put(removeTerminal(wsId, activeTerminalId));
      const terminalManager = yield* call(loadTerminalManager);
      yield* call([terminalManager, terminalManager.disposeTerminal], activeTerminalId);
    },
  );
}

