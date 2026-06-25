/**
 * Single mock IPC router.
 *
 * Replaces the real renderer→main IPC boundary so `invoke()` calls and event
 * listeners resolve to in-memory mock data instead of hitting Electron. There is
 * one router for the whole process: callers register per-channel invoke handlers
 * and event listeners, and unknown channels resolve to a safe default value.
 *
 * Later waves register per-domain handlers; the router starts empty so every
 * channel resolves to the fallback until a handler is registered.
 */

/** Resolves an invoke for one channel. Receives the original `invoke()` args. */
export type MockIpcInvokeHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** Invoked with the payload whenever a mock event is emitted on a channel. */
export type MockIpcEventHandler = (payload: unknown) => void;

/** Disposer returned when adding an event listener. */
export type MockIpcUnsubscribe = () => void;

const invokeHandlers = new Map<string, MockIpcInvokeHandler>();
const eventHandlers = new Map<string, Set<MockIpcEventHandler>>();

/** Value returned by `mockInvoke()` for channels without a registered handler. */
let fallbackInvokeValue: unknown = undefined;

/** Register (or replace) the mock handler for a single invoke channel. */
export function registerMockIpcHandler(channel: string, handler: MockIpcInvokeHandler): void {
  invokeHandlers.set(channel, handler);
}

/** Remove a previously registered invoke handler. */
export function unregisterMockIpcHandler(channel: string): void {
  invokeHandlers.delete(channel);
}

/** Whether a handler is registered for the given invoke channel. */
export function hasMockIpcHandler(channel: string): boolean {
  return invokeHandlers.has(channel);
}

/** Override the safe-default value returned for unknown invoke channels. */
export function setMockIpcInvokeFallback(value: unknown): void {
  fallbackInvokeValue = value;
}

/**
 * Resolve an IPC invoke against the mock router.
 *
 * If a handler is registered for `channel` it is invoked with `args` and its
 * (possibly async) result is returned. Otherwise the configured safe default is
 * returned, so unknown channels never throw at the boundary.
 */
export async function mockInvoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = invokeHandlers.get(channel);
  if (handler) {
    return (await handler(...args)) as T;
  }
  return fallbackInvokeValue as T;
}

/** Subscribe to mock events on a channel. Returns a disposer. */
export function addMockIpcListener(channel: string, handler: MockIpcEventHandler): MockIpcUnsubscribe {
  let handlers = eventHandlers.get(channel);
  if (!handlers) {
    handlers = new Set();
    eventHandlers.set(channel, handlers);
  }
  handlers.add(handler);

  return () => {
    const current = eventHandlers.get(channel);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      eventHandlers.delete(channel);
    }
  };
}

/** Deliver a payload to every listener registered on a channel. */
export function emitMockIpcEvent(channel: string, payload: unknown): void {
  const handlers = eventHandlers.get(channel);
  if (!handlers) return;
  for (const handler of [...handlers]) {
    handler(payload);
  }
}

/** Number of listeners currently registered for a channel (test/debug aid). */
export function mockIpcListenerCount(channel: string): number {
  return eventHandlers.get(channel)?.size ?? 0;
}

/** Reset all router state (handlers, listeners, fallback). Primarily for tests. */
export function resetMockIpcRouter(): void {
  invokeHandlers.clear();
  eventHandlers.clear();
  fallbackInvokeValue = undefined;
}
