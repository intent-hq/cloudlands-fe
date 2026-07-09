/**
 * MockBackendTransport — scripted-daemon fixture for the renderer WSS seam.
 *
 * Drop-in replacement for `$lib/client/live/backend-transport` (all 5 exported
 * functions). Consumers `vi.mock` that module to point at
 * `mockBackendTransportModule` and drive scripted `backendRequest` responses
 * plus `events.event` / `subscription.push` notifications via the handle
 * returned by `installMockBackend()`. State is module-level so the hoisted
 * `vi.mock` factory and the test body see the same registry.
 *
 * See colocated README (`backend-transport.mock.README.md`) for the vi.mock
 * boilerplate consumers must place at the top of their test files.
 *
 * Envelope builders are anchored to PROTOCOL.md §6.3 (`events.event`), §6
 * (`subscription.push` snapshot/delta), and §9 (JSON-RPC error object).
 */

/** JSON-RPC notification shape observed by `onBackendNotification` handlers. */
export interface BackendNotification {
  method: string;
  params?: unknown;
}

/** Mirrors `BackendErrorPayload` from the real backend-transport module. */
export interface BackendErrorPayload {
  code: string;
  message: string;
  data?: unknown;
  rpcCode?: number;
}

/**
 * Error class re-implemented for the mock so consumers can inspect `.code`,
 * `.data`, `.rpcCode` and `error.name === "BackendError"` without depending
 * on the real transport module (which the mock replaces).
 */
export class BackendError extends Error {
  readonly code: string;
  readonly data: unknown;
  readonly rpcCode?: number;
  constructor(payload: BackendErrorPayload) {
    super(payload.message);
    this.name = "BackendError";
    this.code = payload.code;
    this.data = payload.data;
    this.rpcCode = payload.rpcCode;
  }
}

/** Scripted handler for a single JSON-RPC method. May be sync or async. */
export type RequestHandler = (params: unknown) => unknown | Promise<unknown>;

/** Scripted handler for `backendSubscribe`. May be sync or async. */
export type SubscribeHandler = (
  params: unknown,
) => { subscriptionId?: string } | Promise<{ subscriptionId?: string }>;

/** Recorded request / subscribe / unsubscribe call. */
export interface RecordedRequest {
  method: string;
  params: unknown;
}

interface MockState {
  requestHandlers: Map<string, RequestHandler>;
  subscribeHandler: SubscribeHandler | null;
  notificationHandlers: Set<(n: BackendNotification) => void>;
  liveStateCapability: boolean;
  autoSubscriptionSeq: number;
  requests: RecordedRequest[];
  subscribes: unknown[];
  unsubscribes: string[];
}

const state: MockState = {
  requestHandlers: new Map(),
  subscribeHandler: null,
  notificationHandlers: new Set(),
  liveStateCapability: false,
  autoSubscriptionSeq: 0,
  requests: [],
  subscribes: [],
  unsubscribes: [],
};

/** Reset all handlers, recorded calls, and cached capability. Call per test. */
export function resetMockBackend(): void {
  state.requestHandlers.clear();
  state.subscribeHandler = null;
  state.notificationHandlers.clear();
  state.liveStateCapability = false;
  state.autoSubscriptionSeq = 0;
  state.requests.length = 0;
  state.subscribes.length = 0;
  state.unsubscribes.length = 0;
}

async function mockBackendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
  state.requests.push({ method, params });
  const handler = state.requestHandlers.get(method);
  if (!handler) {
    throw new BackendError({
      code: "MOCK_UNHANDLED_METHOD",
      message: `MockBackendTransport: no onRequest() handler registered for method "${method}"`,
    });
  }
  try {
    const result = await handler(params);
    return result as T;
  } catch (err) {
    if (err instanceof BackendError) throw err;
    if (err instanceof Error) {
      throw new BackendError({ code: "MOCK_HANDLER_ERROR", message: err.message });
    }
    throw new BackendError({ code: "MOCK_HANDLER_ERROR", message: String(err) });
  }
}

async function mockBackendSubscribe<T = { subscriptionId?: string }>(
  params: unknown,
): Promise<T> {
  state.subscribes.push(params);
  if (state.subscribeHandler) {
    return (await state.subscribeHandler(params)) as T;
  }
  state.autoSubscriptionSeq += 1;
  return { subscriptionId: `mock-sub-${state.autoSubscriptionSeq}` } as T;
}

async function mockBackendUnsubscribe(subscriptionId: string): Promise<void> {
  state.unsubscribes.push(subscriptionId);
}

function mockOnBackendNotification(handler: (n: BackendNotification) => void): () => void {
  state.notificationHandlers.add(handler);
  return () => {
    state.notificationHandlers.delete(handler);
  };
}

async function mockDetectLiveStateCapability(): Promise<boolean> {
  return state.liveStateCapability;
}

function mockIsBackendAvailable(): boolean {
  return true;
}

/**
 * The mock module — shape-compatible with `$lib/client/live/backend-transport`.
 * Consumers point `vi.mock(...)` at this object; the returned functions read /
 * write the module-level `state` so `installMockBackend()` can drive them.
 */
export const mockBackendTransportModule = {
  backendRequest: mockBackendRequest,
  backendSubscribe: mockBackendSubscribe,
  backendUnsubscribe: mockBackendUnsubscribe,
  onBackendNotification: mockOnBackendNotification,
  detectLiveStateCapability: mockDetectLiveStateCapability,
  isBackendAvailable: mockIsBackendAvailable,
  BackendError,
};

/** Parameters for `pushSubscriptionPush()` — matches PROTOCOL §6 frame shape. */
export interface SubscriptionPushFrame {
  subscriptionId: string;
  kind: "snapshot" | "delta";
  seq: number;
  snapshot?: unknown;
  delta?: { added?: unknown[]; updated?: unknown[]; removedIds?: string[] };
}

/** Extra fields the scripted event may carry beyond `type` + `data`. */
export interface EventEnvelopeOverrides {
  id?: string;
  workspaceId?: string;
  timestamp?: string;
  actor?: { type: string; id?: string; name?: string };
  subscriptionId?: string;
}

/**
 * Build a PROTOCOL §6.3 `events.event` JSON-RPC notification envelope.
 * Missing metadata is filled with deterministic-ish defaults for tests.
 */
export function buildEventNotification(
  eventType: string,
  data: Record<string, unknown> = {},
  overrides: EventEnvelopeOverrides = {},
): BackendNotification {
  const event = {
    id: overrides.id ?? `evt-${eventType}-${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: overrides.workspaceId ?? "ws-mock",
    timestamp: overrides.timestamp ?? "2026-01-01T00:00:00.000Z",
    type: eventType,
    actor: overrides.actor ?? { type: "system" },
    data,
  };
  const params: Record<string, unknown> = { event };
  if (overrides.subscriptionId) params.subscriptionId = overrides.subscriptionId;
  return { method: "events.event", params };
}

/** Build a PROTOCOL §6 `subscription.push` seq-N snapshot envelope. */
export function buildSubscriptionPushSnapshot(args: {
  subscriptionId: string;
  seq?: number;
  snapshot: unknown;
}): BackendNotification {
  return {
    method: "subscription.push",
    params: {
      subscriptionId: args.subscriptionId,
      kind: "snapshot",
      seq: args.seq ?? 0,
      snapshot: args.snapshot,
    },
  };
}

/** Build a PROTOCOL §6 `subscription.push` delta envelope. */
export function buildSubscriptionPushDelta(args: {
  subscriptionId: string;
  seq: number;
  delta: { added?: unknown[]; updated?: unknown[]; removedIds?: string[] };
}): BackendNotification {
  return {
    method: "subscription.push",
    params: {
      subscriptionId: args.subscriptionId,
      kind: "delta",
      seq: args.seq,
      delta: args.delta,
    },
  };
}

/**
 * Build a `BackendErrorPayload` shaped per PROTOCOL §9 (JSON-RPC 2.0 error).
 * `code` is the string label (e.g. `"CONFLICT"`); `rpcCode` is the numeric
 * JSON-RPC code (e.g. `-32005` for the §9 conflict path).
 */
export function buildErrorPayload(
  code: string,
  message: string,
  opts: { data?: unknown; rpcCode?: number } = {},
): BackendErrorPayload {
  const payload: BackendErrorPayload = { code, message };
  if (opts.data !== undefined) payload.data = opts.data;
  if (opts.rpcCode !== undefined) payload.rpcCode = opts.rpcCode;
  return payload;
}

/** Scripting handle returned by `installMockBackend()`. */
export interface MockBackendHandle {
  onRequest(method: string, handler: RequestHandler): void;
  onSubscribe(handler: SubscribeHandler): void;
  pushEvent(
    eventOrNotification:
      | BackendNotification
      | { type: string; data?: Record<string, unknown> } & EventEnvelopeOverrides,
  ): void;
  pushSubscriptionPush(frame: SubscriptionPushFrame): void;
  setLiveStateCapability(enabled: boolean): void;
  readonly requests: ReadonlyArray<RecordedRequest>;
  readonly subscribes: ReadonlyArray<unknown>;
  readonly unsubscribes: ReadonlyArray<string>;
  readonly notificationHandlerCount: number;
  readonly builders: {
    buildEventNotification: typeof buildEventNotification;
    buildSubscriptionPushSnapshot: typeof buildSubscriptionPushSnapshot;
    buildSubscriptionPushDelta: typeof buildSubscriptionPushDelta;
    buildErrorPayload: typeof buildErrorPayload;
  };
}

function deliver(notification: BackendNotification): void {
  for (const handler of Array.from(state.notificationHandlers)) {
    handler(notification);
  }
}

function isNotificationEnvelope(value: unknown): value is BackendNotification {
  return (
    typeof value === "object" &&
    value !== null &&
    "method" in value &&
    typeof (value as { method: unknown }).method === "string"
  );
}

/**
 * Reset the fixture state and return a scripting handle. Typical usage:
 *
 * ```ts
 * vi.mock("$lib/client/live/backend-transport", async () =>
 *   (await import("<path>/backend-transport.mock")).mockBackendTransportModule,
 * );
 * import { installMockBackend } from "<path>/backend-transport.mock";
 * let backend: MockBackendHandle;
 * beforeEach(() => { backend = installMockBackend(); });
 * ```
 */
export function installMockBackend(): MockBackendHandle {
  resetMockBackend();
  return {
    onRequest(method, handler) {
      state.requestHandlers.set(method, handler);
    },
    onSubscribe(handler) {
      state.subscribeHandler = handler;
    },
    pushEvent(input) {
      if (isNotificationEnvelope(input)) {
        deliver(input);
        return;
      }
      const { type, data, ...overrides } = input;
      deliver(buildEventNotification(type, data ?? {}, overrides));
    },
    pushSubscriptionPush(frame) {
      deliver(
        frame.kind === "snapshot"
          ? buildSubscriptionPushSnapshot({
              subscriptionId: frame.subscriptionId,
              seq: frame.seq,
              snapshot: frame.snapshot,
            })
          : buildSubscriptionPushDelta({
              subscriptionId: frame.subscriptionId,
              seq: frame.seq,
              delta: frame.delta ?? {},
            }),
      );
    },
    setLiveStateCapability(enabled) {
      state.liveStateCapability = enabled;
    },
    get requests() {
      return state.requests;
    },
    get subscribes() {
      return state.subscribes;
    },
    get unsubscribes() {
      return state.unsubscribes;
    },
    get notificationHandlerCount() {
      return state.notificationHandlers.size;
    },
    builders: {
      buildEventNotification,
      buildSubscriptionPushSnapshot,
      buildSubscriptionPushDelta,
      buildErrorPayload,
    },
  };
}
