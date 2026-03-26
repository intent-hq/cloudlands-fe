import { call, takeEvery } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { PIP_CHANNELS } from "$shared/ipc/channels";
import { openOrFocusPip, closePip, closeAllPipForWorkspace, closeAllPip, type PipWindowState, } from "../pip-slice";
import { selectPipState } from "../pip-selectors";
function* handleOpenOrFocusPip(action: ReturnType<typeof openOrFocusPip>) {
    const [workspaceId, tabId, tabType, panelId] = action.payload;
    try {
        const result: number = yield* call(invoke<number>, PIP_CHANNELS.OPEN, {
            workspaceId,
            tabId,
            tabType,
            panelId,
        });
    }
    catch (error) {
    }
}
function* handleClosePip(action: ReturnType<typeof closePip>) {
    const [workspaceId, tabId] = action.payload;
    try {
        yield* call(invoke, PIP_CHANNELS.CLOSE, { workspaceId, tabId });
    }
    catch (error) {
    }
}
function* handleCloseAllPipForWorkspace(action: ReturnType<typeof closeAllPipForWorkspace>) {
    const [workspaceId] = action.payload;
    try {
        yield* call(invoke, PIP_CHANNELS.CLOSE_ALL_FOR_WORKSPACE, { workspaceId });
    }
    catch (error) {
    }
}
function* handleCloseAllPip() {
    try {
        const pipState = yield* selectPipState.effect();
        const allWindows: PipWindowState[] = Object.values(pipState.openPipWindows);
        for (const win of allWindows) {
            yield* call(invoke, PIP_CHANNELS.CLOSE, {
                workspaceId: win.workspaceId,
                tabId: win.tabId,
            });
        }
    }
    catch (error) {
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
