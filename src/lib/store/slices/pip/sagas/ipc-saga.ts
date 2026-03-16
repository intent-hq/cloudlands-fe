import { put, take } from "typed-redux-saga";
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";
import { createLogger } from "$lib/utils/client-logger";
import { pipWindowOpened, pipWindowClosed } from "../pip-slice";

const logger = createLogger("PipIpcSaga");

/**
 * Watch for pip:opened IPC events and dispatch pipWindowOpened actions.
 */
export function* watchPipOpenedSaga() {
  if (typeof window === "undefined") return;

  const channel = createListenSyncChannel<{
    workspaceId: string;
    tabId: string;
    windowId: number;
  }>("pip:opened");

  try {
    while (true) {
      const data = yield* take(channel);
      if (!data?.workspaceId || !data?.tabId || !data?.windowId) {
        logger.warn("Invalid pip:opened event data", data);
        continue;
      }
      logger.debug("PiP window opened", data);
      yield* put(
        pipWindowOpened({
          workspaceId: data.workspaceId,
          tabId: data.tabId,
          windowId: data.windowId,
        })
      );
    }
  } finally {
    channel.close();
  }
}

/**
 * Watch for pip:closed IPC events and dispatch pipWindowClosed actions.
 */
export function* watchPipClosedSaga() {
  if (typeof window === "undefined") return;

  const channel = createListenSyncChannel<{
    workspaceId: string;
    tabId: string;
  }>("pip:closed");

  try {
    while (true) {
      const data = yield* take(channel);
      if (!data?.workspaceId || !data?.tabId) {
        logger.warn("Invalid pip:closed event data", data);
        continue;
      }
      logger.debug("PiP window closed", data);
      yield* put(
        pipWindowClosed({
          workspaceId: data.workspaceId,
          tabId: data.tabId,
        })
      );
    }
  } finally {
    channel.close();
  }
}

/**
 * Root IPC saga: watches for pip:opened and pip:closed events.
 */
export function* ipcPipSaga() {
  // Both watchers run concurrently via fork in the root saga
  yield* watchPipOpenedSaga();
}

