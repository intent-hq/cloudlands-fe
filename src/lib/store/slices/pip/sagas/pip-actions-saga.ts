import { call, select, takeEvery } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { PIP_CHANNELS } from "$shared/ipc/channels";
import { createLogger } from "$lib/utils/client-logger";
import {
  openOrFocusPip,
  closePip,
  closeAllPipForWorkspace,
  closeAllPip,
  type PipState,
} from "../pip-slice";

const logger = createLogger("PipActionsSaga");

function* handleOpenOrFocusPip(action: ReturnType<typeof openOrFocusPip>) {
  const [workspaceId, tabId, tabType, panelId] = action.payload;
  try {
    const result: number = yield* call(invoke<number>, PIP_CHANNELS.OPEN, {
      workspaceId,
      tabId,
      tabType,
      panelId,
    });
    logger.debug("Opened/focused PiP window", { workspaceId, tabId, windowId: result });
  } catch (error) {
    logger.error("Failed to open/focus PiP window", { error });
  }
}

function* handleClosePip(action: ReturnType<typeof closePip>) {
  const [workspaceId, tabId] = action.payload;
  try {
    yield* call(invoke, PIP_CHANNELS.CLOSE, { workspaceId, tabId });
    logger.debug("Closed PiP window", { workspaceId, tabId });
  } catch (error) {
    logger.error("Failed to close PiP window", { error });
  }
}

function* handleCloseAllPipForWorkspace(
  action: ReturnType<typeof closeAllPipForWorkspace>
) {
  const [workspaceId] = action.payload;
  try {
    yield* call(invoke, PIP_CHANNELS.CLOSE_ALL_FOR_WORKSPACE, { workspaceId });
    logger.debug("Closed all PiP windows for workspace", { workspaceId });
  } catch (error) {
    logger.error("Failed to close all PiP windows for workspace", { error });
  }
}

function* handleCloseAllPip() {
  try {
    const pipState: PipState = yield* select((state: any) => state.pip);
    const allWindows = Object.values(pipState.openPipWindows);
    for (const win of allWindows) {
      yield* call(invoke, PIP_CHANNELS.CLOSE, {
        workspaceId: win.workspaceId,
        tabId: win.tabId,
      });
    }
    logger.debug("Closed all PiP windows");
  } catch (error) {
    logger.error("Failed to close all PiP windows", { error });
  }
}

/**
 * Root actions saga: watches for pip action dispatches and calls IPC.
 */
export function* pipActionsSaga() {
  yield* takeEvery(openOrFocusPip, handleOpenOrFocusPip);
  yield* takeEvery(closePip, handleClosePip);
  yield* takeEvery(closeAllPipForWorkspace, handleCloseAllPipForWorkspace);
  yield* takeEvery(closeAllPip, handleCloseAllPip);
}

