import { put } from "typed-redux-saga";
import { takeEveryFromListenSync } from "$store/renderer/utils/ipc-channel";
import {
  pipWindowOpened,
  pipWindowClosed,
} from "../pip-slice";

/**
 * Watch for pip:opened IPC events and dispatch pipWindowOpened actions.
 */
export function* watchPipOpenedSaga() {
  yield* takeEveryFromListenSync<{
    workspaceId: string;
    tabId: string;
    windowId: number;
  }>("pip:opened", function* (data) {
      if (!data?.workspaceId || !data?.tabId || !data?.windowId) {
        return;
      }
      yield* put(
        pipWindowOpened({
          workspaceId: data.workspaceId,
          tabId: data.tabId,
          windowId: data.windowId,
        })
      );
    });
}

/**
 * Watch for pip:closed IPC events and dispatch pipWindowClosed actions.
 */
export function* watchPipClosedSaga() {
  yield* takeEveryFromListenSync<{
    workspaceId: string;
    tabId: string;
  }>("pip:closed", function* (data) {
      if (!data?.workspaceId || !data?.tabId) {
        return;
      }
      yield* put(
        pipWindowClosed({
          workspaceId: data.workspaceId,
          tabId: data.tabId,
        })
      );
    });
}
