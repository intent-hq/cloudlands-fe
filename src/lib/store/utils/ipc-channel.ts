import { eventChannel, type EventChannel } from "redux-saga";
import type { NotUndefined } from "@redux-saga/types";
import { listenSync } from "$lib/electron-bridge";

/**
 * Creates a redux-saga EventChannel from an Electron IPC event.
 *
 * This bridges Electron's IPC events into the saga world, allowing handlers
 * to use full saga effects (put, select, call, etc.) instead of raw dispatch.
 *
 * @example
 * function* watchTerminalDisposed() {
 *   const channel = createListenSyncChannel<TerminalDisposedEvent>('terminal:disposed');
 *   try {
 *     while (true) {
 *       const data: TerminalDisposedEvent = yield* take(channel);
 *       yield* put(removeTerminal(data.workspaceId, data.terminalId));
 *     }
 *   } finally {
 *     channel.close();
 *   }
 * }
 */
export function createListenSyncChannel<T extends NotUndefined>(eventName: string): EventChannel<T> {
  return eventChannel<T>((emitter) => {
    // listenSync wraps data in { payload: T }, so unwrap it
    const cleanup = listenSync<T>(eventName, (event) => {
      emitter(event.payload);
    });
    // Return the unsubscribe function — called when channel.close() is invoked
    // or when the saga using this channel is cancelled
    return cleanup;
  });
}

