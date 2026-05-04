import { call, put, select, takeEvery } from "typed-redux-saga";
import { terminalManager } from "$features/terminal/terminal-manager.svelte";
import {
  closeActiveTerminalRequested,
  removeTerminal,
} from "../terminals-slice";
import { selectActiveTerminalIdForWorkspace } from "../terminals-selectors";

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
      const activeTerminalId = yield* select(
        selectActiveTerminalIdForWorkspace.select,
        wsId,
      );
      if (!activeTerminalId) return;
      yield* put(removeTerminal(wsId, activeTerminalId));
      yield* call([terminalManager, terminalManager.disposeTerminal], activeTerminalId);
    },
  );
}

