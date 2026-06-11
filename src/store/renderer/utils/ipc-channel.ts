import {
  END,
  eventChannel,
  buffers,
  type EventChannel,
  type Task,
} from "redux-saga";
import type { NotUndefined } from "@redux-saga/types";
import { listenSync } from "$lib/electron-bridge";
import type { WindowEventName } from "$lib/utils/window-events";
import type { ElectronEventName } from "$shared/ipc-registry";
import {
  cancel,
  fork,
  take,
} from "typed-redux-saga";

type WindowEventChannelOptions = {
  capture?: boolean;
  stopImmediatePropagation?: boolean;
};

export type IpcChannelBufferPolicy =
  | { kind: "lossless"; rationale: string }
  | { kind: "sliding"; limit: number; rationale: string }
  | { kind: "dropping"; limit: number; rationale: string }
  | { kind: "none"; rationale: string };

export type IpcChannelOptions = {
  bufferPolicy?: IpcChannelBufferPolicy;
};

export const DEFAULT_IPC_BUFFER_LIMIT = 1_000;
export const HIGH_VOLUME_IPC_BUFFER_LIMIT = 1_000;
export const LATEST_ONLY_IPC_BUFFER_LIMIT = 1;

const DEFAULT_BOUNDED_IPC_POLICY: IpcChannelBufferPolicy = {
  kind: "sliding",
  limit: DEFAULT_IPC_BUFFER_LIMIT,
  rationale:
    "Default renderer IPC policy: bounded sliding queue prevents pathological producer storms from retaining unbounded payloads.",
};

// Renderer IPC buffer policy inventory:
// - lossless: lifecycle, creation/deletion, backend handshakes, and request facts
//   without guaranteed snapshot repair; correctness wins over bounded memory.
// - latest-only: progress/status channels where stale intermediate payloads are
//   invalidated by newer payloads.
// - bounded queue: high-volume update streams with reducer coalescing, debounce,
//   or explicit reload/snapshot repair paths.
// - default bounded queue: low-volume renderer notifications/menu events. Callers
//   must opt into lossless when dropping any queued payload would break state.
const LOSSLESS_REQUIRED_IPC_EVENTS = new Set<ElectronEventName>([
  "agent:created",
  "agent:deleted",
  "agent:prepare-handler",
  "agent:queue:processing",
  "agent:queue:processing-cancelled",
  "agent:restored",
  "agent:stream-starting",
  "events:cleared",
  "note:created",
  "note:deleted",
  "note:updated",
  "permission:event",
  "script:error",
  "script:started",
  "script:stopped",
  "script:url-detected",
  "task:status-changed",
  "terminal:created",
  "terminal:disposed",
]);

const LATEST_ONLY_IPC_EVENTS = new Set<ElectronEventName>([
  "agent:idle",
  "agent:status-changed",
  "auto-update:progress",
  "auto-update:status-changed",
  "codex/managed-install/progress",
  "codex/managed-install/status",
  "window:zoom-changed",
]);

const HIGH_VOLUME_BOUNDED_IPC_EVENTS = new Set<ElectronEventName>([
  "events:new",
  "file-tracking:agent-file-changed",
  "file-tracking:changes-updated",
  "file:changed",
  "file:content-changed",
  "script:output",
  "watcher:file-changed",
  "workspace-changes",
  "workspace:background-enrichment-complete",
  "workspace:updated",
]);

export function resolveIpcChannelBufferPolicy(
  eventName: ElectronEventName,
  options: IpcChannelOptions = {},
): IpcChannelBufferPolicy {
  if (options.bufferPolicy) return options.bufferPolicy;

  if (LOSSLESS_REQUIRED_IPC_EVENTS.has(eventName)) {
    return {
      kind: "lossless",
      rationale:
        "Lossless-required lifecycle/request event; dropping can leave renderer state stale without a guaranteed later snapshot repair.",
    };
  }

  if (LATEST_ONLY_IPC_EVENTS.has(eventName)) {
    return {
      kind: "sliding",
      limit: LATEST_ONLY_IPC_BUFFER_LIMIT,
      rationale: "Latest-only status/progress event; stale intermediate payloads may be dropped safely.",
    };
  }

  if (HIGH_VOLUME_BOUNDED_IPC_EVENTS.has(eventName)) {
    return {
      kind: "sliding",
      limit: HIGH_VOLUME_IPC_BUFFER_LIMIT,
      rationale:
        "High-volume renderer update stream; reducers or follow-up loads coalesce state, so bound queued IPC payloads.",
    };
  }

  return DEFAULT_BOUNDED_IPC_POLICY;
}

function createIpcBuffer<T>(policy: IpcChannelBufferPolicy) {
  switch (policy.kind) {
    case "lossless":
      return buffers.expanding<T>();
    case "sliding":
      return buffers.sliding<T>(policy.limit);
    case "dropping":
      return buffers.dropping<T>(policy.limit);
    case "none":
      return buffers.none<T>();
  }
}

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

function* takeEveryFromWindowEventLoop<T extends object>(
  eventName: WindowEventName,
  handler: (data: T) => Generator,
  options: WindowEventChannelOptions = {},
): Generator<any, void, any> {
  const channel = createWindowEventChannel<T>(eventName, options);

  try {
    while (true) {
      const data: T = yield* take(channel);
      if (data === (END as unknown as T)) break;
      yield* fork(handler, data);
    }
  } finally {
    channel.close();
  }
}

function* takeLatestFromWindowEventLoop<T extends object>(
  eventName: WindowEventName,
  handler: (data: T) => Generator,
  options: WindowEventChannelOptions = {},
): Generator<any, void, any> {
  const channel = createWindowEventChannel<T>(eventName, options);
  let task = null as Task | null;

  try {
    while (true) {
      const data: T = yield* take(channel);
      if (data === (END as unknown as T)) break;
      if (task) {
        yield* cancel(task);
      }
      task = yield* fork(handler, data);
    }
  } finally {
    channel.close();
  }
}


export function* takeEveryFromWindowEvent<T extends object>(
  eventName: WindowEventName,
  handler: (data: T) => Generator,
  options: WindowEventChannelOptions = {},
): Generator<any, Task, any> {
  return yield* fork(takeEveryFromWindowEventLoop<T>, eventName, handler, options);
}

export function* takeLatestFromWindowEvent<T extends object>(
  eventName: WindowEventName,
  handler: (data: T) => Generator,
  options: WindowEventChannelOptions = {},
): Generator<any, Task, any> {
  return yield* fork(takeLatestFromWindowEventLoop<T>, eventName, handler, options);
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
export function createListenSyncChannel<T extends NotUndefined>(
  eventName: ElectronEventName,
  options: IpcChannelOptions = {},
): EventChannel<T> {
  const bufferPolicy = resolveIpcChannelBufferPolicy(eventName, options);

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
  }, createIpcBuffer<T>(bufferPolicy));
}

function* takeEveryFromListenSyncLoop<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
  options: IpcChannelOptions = {},
): Generator<any, void, any> {
  const channel = createListenSyncChannel<T>(eventName, options);

  try {
    while (true) {
      const data: T = yield* take(channel);
      if (data === (END as unknown as T)) break;
      yield* fork(handler, data);
    }
  } finally {
    channel.close();
  }
}

export function* takeEveryFromListenSync<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
  options: IpcChannelOptions = {},
): Generator<any, Task, any> {
  return yield* fork(takeEveryFromListenSyncLoop<T>, eventName, handler, options);
}

export function createElectronChannel<T extends NotUndefined>(
  eventName: ElectronEventName,
  options: IpcChannelOptions = {},
): EventChannel<T> {
  const bufferPolicy = resolveIpcChannelBufferPolicy(eventName, options);

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
  }, createIpcBuffer<T>(bufferPolicy));
}

function* takeEveryFromElectronChannelLoop<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
  options: IpcChannelOptions = {},
): Generator<any, void, any> {
  const channel = createElectronChannel<T>(eventName, options);

  try {
    while (true) {
      const data: T = yield* take(channel);
      if (data === (END as unknown as T)) break;
      yield* fork(handler, data);
    }
  } finally {
    channel.close();
  }
}

export function* takeEveryFromElectronChannel<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
  options: IpcChannelOptions = {},
): Generator<any, Task, any> {
  return yield* fork(takeEveryFromElectronChannelLoop<T>, eventName, handler, options);
}

