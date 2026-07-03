/**
 * Single mock IPC router.
 *
 * Replaces the real renderer→main IPC boundary so `invoke()` calls and event
 * listeners resolve to in-memory mock data instead of hitting Electron. There is
 * one router for the whole process: callers register per-channel invoke handlers
 * and event listeners.
 *
 * Invoking a channel with NO registered handler REJECTS with
 * `UnbridgedMockIpcChannelError`. It used to resolve `undefined`, which silently
 * corrupted callers (empty transcripts when `agent:backend:stream-message` was
 * unbridged, `setModel` crashes on `agent:set-model`, clipboard writes that
 * claimed success). Loud failure is structural: bridge the channel in a seeder
 * under `src/store/renderer/seeders/`, or — only when every caller legitimately
 * tolerates absence — add it to `UNBRIDGED_INVOKE_ALLOWLIST` with justification.
 *
 * Tests may still opt back into a blanket resolution for unknown channels via
 * `setMockIpcInvokeFallback()`.
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
/** Whether a blanket unknown-channel fallback was explicitly configured. */
let fallbackInvokeConfigured = false;

/**
 * Channels that may be invoked WITHOUT a registered handler and resolve to the
 * mapped value instead of rejecting. Every entry must justify why absence is
 * legitimately tolerated. Keep this list minimal — an unbridged channel is a
 * bug unless proven otherwise.
 */
export const UNBRIDGED_INVOKE_ALLOWLIST: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  // Fire-and-forget renderer log persistence sink. The renderer logger catches
  // flush failures and RE-QUEUES the batch for retry, so rejecting here would
  // grow the pending-log buffer unboundedly and spam console.error on every
  // flush. There is no daemon-side log sink yet (P3-1.5 retirement candidate);
  // resolving undefined keeps the logger's in-memory behavior harmless.
  ['log:persist-renderer-logs', undefined],
]);

/** Rejection raised when an invoke hits a channel with no registered handler. */
export class UnbridgedMockIpcChannelError extends Error {
  readonly channel: string;

  constructor(channel: string) {
    super(
      `No mock IPC handler registered for channel '${channel}'. This build routes legacy ` +
        `renderer→main IPC through the in-memory mock router; an unbridged channel used to resolve ` +
        `undefined and silently corrupt the caller. Bridge the channel to the daemon in a seeder ` +
        `under src/store/renderer/seeders/ (see agent-ipc-bridge-seeder.ts), or — only if every ` +
        `caller legitimately tolerates absence — add it to UNBRIDGED_INVOKE_ALLOWLIST in ` +
        `src/shared/ipc-mock-router.ts with a justification.`,
    );
    this.name = 'UnbridgedMockIpcChannelError';
    this.channel = channel;
  }
}

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

/** All channels with a registered invoke handler (reconciliation/test aid). */
export function getRegisteredMockIpcChannels(): string[] {
  return [...invokeHandlers.keys()].sort();
}

/**
 * Opt back into a blanket resolution for unknown invoke channels (tests only).
 * Once configured, every unknown channel resolves to `value` instead of
 * rejecting; `resetMockIpcRouter()` restores the loud-failure default.
 */
export function setMockIpcInvokeFallback(value: unknown): void {
  fallbackInvokeValue = value;
  fallbackInvokeConfigured = true;
}

/**
 * Resolve an IPC invoke against the mock router.
 *
 * If a handler is registered for `channel` it is invoked with `args` and its
 * (possibly async) result is returned. Unknown channels resolve to the
 * explicitly configured test fallback (if any) or an allowlisted absence value;
 * otherwise they REJECT with `UnbridgedMockIpcChannelError` so a missing bridge
 * is a visible failure instead of a silent undefined.
 */
export async function mockInvoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = invokeHandlers.get(channel);
  if (handler) {
    return (await handler(...args)) as T;
  }
  if (fallbackInvokeConfigured) {
    return fallbackInvokeValue as T;
  }
  if (UNBRIDGED_INVOKE_ALLOWLIST.has(channel)) {
    return UNBRIDGED_INVOKE_ALLOWLIST.get(channel) as T;
  }
  throw new UnbridgedMockIpcChannelError(channel);
}

/** Subscribe to mock events on a channel. Returns a disposer. */
export function addMockIpcListener(
  channel: string,
  handler: MockIpcEventHandler,
): MockIpcUnsubscribe {
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
  fallbackInvokeConfigured = false;
}
