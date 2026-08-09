import {
  END,
  eventChannel,
  buffers,
  type EventChannel,
  type Task,
} from "redux-saga";
import type { NotUndefined } from "@redux-saga/types";
import { cancel, fork, take } from "typed-redux-saga";

import { listenSync } from "$lib/electron-bridge";
import type { ElectronEventName } from "$shared/ipc-registry";
import type { WindowEventName } from "$lib/utils/window-events";

type WindowEventChannelOptions = {
  capture?: boolean;
  stopImmediatePropagation?: boolean;
};

export type IpcChannelBufferPolicy =
  | { kind: "lossless"; rationale: string }
  | { kind: "sliding"; limit: number; rationale: string }
  | { kind: "dropping"; limit: number; rationale: string }
  | { kind: "none"; rationale: string };

export type IpcChannelOptions = { bufferPolicy?: IpcChannelBufferPolicy };

export const DEFAULT_IPC_BUFFER_LIMIT = 1_000;
export const HIGH_VOLUME_IPC_BUFFER_LIMIT = 1_000;
export const LATEST_ONLY_IPC_BUFFER_LIMIT = 1;

const LOSSLESS_REQUIRED_IPC_EVENTS = new Set<string>([
  "agent:created",
  "agent:deleted",
  "agent:prepare-handler",
  "agent:queue:processing",
  "agent:queue:processing-cancelled",
  "agent:restored",
  "agent:stream-starting",
  "note:created",
  "note:deleted",
  "note:updated",
  "permission:event",
  "task:status-changed",
  "terminal:created",
  "terminal:disposed",
  "workspace:archived",
  "workspace:created",
  "workspace:deleted",
]);

const LATEST_ONLY_IPC_EVENTS = new Set<string>([
  "agent:idle",
  "agent:status-changed",
  "auto-update:progress",
  "auto-update:status-changed",
  "codex/managed-install/progress",
  "codex/managed-install/status",
  "window:zoom-changed",
]);

const HIGH_VOLUME_BOUNDED_IPC_EVENTS = new Set<string>([
  "events:new",
  "file-tracking:agent-file-changed",
  "file-tracking:changes-updated",
  "file:changed",
  "file:content-changed",
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
      rationale: "Lifecycle and request events must not be dropped.",
    };
  }
  if (LATEST_ONLY_IPC_EVENTS.has(eventName)) {
    return {
      kind: "sliding",
      limit: LATEST_ONLY_IPC_BUFFER_LIMIT,
      rationale: "Only the latest status or progress event is actionable.",
    };
  }
  if (HIGH_VOLUME_BOUNDED_IPC_EVENTS.has(eventName)) {
    return {
      kind: "sliding",
      limit: HIGH_VOLUME_IPC_BUFFER_LIMIT,
      rationale: "Bound high-volume updates while preserving recent state.",
    };
  }
  return {
    kind: "sliding",
    limit: DEFAULT_IPC_BUFFER_LIMIT,
    rationale: "Bound low-volume renderer notifications.",
  };
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

export function createWindowEventChannel<T extends object>(
  eventName: WindowEventName,
  options: WindowEventChannelOptions = {},
): EventChannel<T> {
  return eventChannel<T>((emitter) => {
    if (typeof window === "undefined") {
      emitter(END as never);
      return () => {};
    }
    const handler = (event: Event) => {
      if (options.stopImmediatePropagation) event.stopImmediatePropagation();
      const customEvent = event as CustomEvent<T | undefined>;
      emitter((customEvent.detail === undefined ? event : customEvent.detail) as T);
    };
    window.addEventListener(eventName, handler, options.capture ?? false);
    return () => window.removeEventListener(eventName, handler, options.capture ?? false);
  });
}

function* takeEveryFromWindowEventLoop<T extends object>(
  eventName: WindowEventName,
  handler: (data: T) => Generator,
  options: WindowEventChannelOptions,
): Generator {
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
  options: WindowEventChannelOptions,
): Generator {
  const channel = createWindowEventChannel<T>(eventName, options);
  let task: Task | null = null;
  try {
    while (true) {
      const data: T = yield* take(channel);
      if (data === (END as unknown as T)) break;
      if (task) yield* cancel(task);
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

export function createListenSyncChannel<T extends NotUndefined>(
  eventName: ElectronEventName,
  options: IpcChannelOptions = {},
): EventChannel<T> {
  return eventChannel<T>((emitter) => {
    if (typeof window === "undefined" || !window.electronAPI) {
      emitter(END as never);
      return () => {};
    }
    return listenSync<T>(eventName, (event) => emitter(event.payload));
  }, createIpcBuffer<T>(resolveIpcChannelBufferPolicy(eventName, options)));
}

function* takeEveryFromListenSyncLoop<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
  options: IpcChannelOptions,
): Generator {
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
  return eventChannel<T>((emitter) => {
    if (typeof window === "undefined" || !window.electronAPI) {
      emitter(END as never);
      return () => {};
    }
    const listenerId = window.electronAPI.on(eventName, (data: T) => emitter(data));
    return () => window.electronAPI.offById(eventName, listenerId);
  }, createIpcBuffer<T>(resolveIpcChannelBufferPolicy(eventName, options)));
}

function* takeEveryFromElectronChannelLoop<T extends NotUndefined>(
  eventName: ElectronEventName,
  handler: (data: T) => Generator,
  options: IpcChannelOptions,
): Generator {
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