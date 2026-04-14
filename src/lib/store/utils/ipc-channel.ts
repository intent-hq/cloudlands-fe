import { END, eventChannel, buffers, type EventChannel } from "redux-saga";
import type { NotUndefined } from "@redux-saga/types";
import { listenSync } from "$lib/electron-bridge";
import type { WindowEventName } from "$lib/utils/window-events";
import type { ElectronEventName } from "$shared/ipc-registry";
import { call, take } from "typed-redux-saga";

type WindowEventChannelOptions = {
  capture?: boolean;
  stopImmediatePropagation?: boolean;
};

export type { WindowEventName } from "$lib/utils/window-events";

export function createWindowEventChannel<T extends object>(
  eventName: WindowEventName,
  options: WindowEventChannelOptions = {},
): EventChannel<T> {
  return eventChannel<T>((emitter) => {
    if (typeof window === "undefined") {
      emitter(END as any);
      return () => {};
    }

    const handler = (event: Event) => {
      if (options.stopImmediatePropagation) {
        event.stopImmediatePropagation();
      }

      const customEvent = event as CustomEvent<T | undefined>;
      emitter((customEvent.detail === undefined ? event : customEvent.detail) as T);
    };

    if (options.capture) {
      window.addEventListener(eventName, handler, true);
    } else {
      window.addEventListener(eventName, handler);
    }

    return () => {
      if (options.capture) {
        window.removeEventListener(eventName, handler, true);
      } else {
        window.removeEventListener(eventName, handler);
      }
    };
  });
}

export function* takeEveryFromWindowEvent<T extends object>(
  eventName: WindowEventName,
  handler: (data: T) => Generator,
  options: WindowEventChannelOptions = {},
): Generator {
  const channel = createWindowEventChannel<T>(eventName, options);

  try {
    while (true) {
      const data: T = yield* take(channel);
      yield* call(handler, data);
    }
  } finally {
    channel.close();
  }
}

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
export function createListenSyncChannel<T extends NotUndefined>(eventName: ElectronEventName): EventChannel<T> {
  // Use an expanding buffer so IPC events arriving while the saga handler
  // is yielded (processing a previous event) are queued instead of dropped.
  // The default buffer is buffers.none() which silently drops events when
  // no take() is pending — causing lost updates (e.g. converted task content).
  return eventChannel<T>((emitter) => {
    if (typeof window === "undefined" || !window.electronAPI) {
      emitter(END as any);
      return () => {};
    }

    // listenSync wraps data in { payload: T }, so unwrap it
    const cleanup = listenSync<T>(eventName, (event) => {
      emitter(event.payload);
    });
    // Return the unsubscribe function — called when channel.close() is invoked
    // or when the saga using this channel is cancelled
    return cleanup;
  }, buffers.expanding<T>());
}

export function* takeEveryFromListenSync<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
): Generator {
  const channel = createListenSyncChannel<T>(eventName);

  try {
    while (true) {
      const data: T = yield* take(channel);
      yield* call(handler, data);
    }
  } finally {
    channel.close();
  }
}

export function createElectronChannel<T extends NotUndefined>(eventName: ElectronEventName): EventChannel<T> {
  return eventChannel<T>((emitter) => {
    if (typeof window === "undefined" || !window.electronAPI) {
      emitter(END as any);
      return () => {};
    }

    const listenerId = window.electronAPI.on(eventName, (data: T) => {
      emitter(data);
    });

    return () => {
      if (window.electronAPI) {
        window.electronAPI.offById(eventName, listenerId);
      }
    };
  });
}

export function* takeEveryFromElectronChannel<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
): Generator {
  const channel = createElectronChannel<T>(eventName);

  try {
    while (true) {
      const data: T = yield* take(channel);
      yield* call(handler, data);
    }
  } finally {
    channel.close();
  }
}

