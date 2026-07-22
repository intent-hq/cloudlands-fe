/**
 * Transport-agnostic contract for the renderer's live backend seam.
 *
 * A `BackendTransport` carries JSON-RPC traffic between the renderer and the
 * intentd daemon. The Electron implementation rides the `backend:*` IPC
 * channels through the main process (`electron-ipc-transport.ts`); future
 * implementations (e.g. a direct browser WebSocket) plug in behind the same
 * interface via `backend-transport-factory.ts`. Consumers should keep using
 * the module-level functions in `backend-transport.ts`, which delegate to the
 * factory-selected transport.
 */

/** Serializable error payload returned by the transport. */
export interface BackendErrorPayload {
  code: string;
  message: string;
  data?: unknown;
  /**
   * Raw numeric JSON-RPC code from the daemon, threaded through so the renderer
   * can detect the optimistic-concurrency conflict (`-32005`) precisely (§11.4-D).
   * Absent for non-JSON-RPC transport failures.
   */
  rpcCode?: number;
}

/** Error thrown when a backend request fails, preserving the daemon string code. */
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

/** Daemon JSON-RPC notification delivered to `onNotification` handlers. */
export interface BackendNotification {
  method: string;
  params?: unknown;
}

/** Per-call options for `BackendTransport.request`. */
export interface BackendRequestOptions {
  /**
   * Overrides the transport's default request timeout for a single call. Used
   * for long-running daemon operations (e.g. `git.pull`) whose own bound
   * exceeds the flat 30s default so the daemon's structured `{ok:false}`
   * result wins over a transport timeout.
   */
  timeoutMs?: number;
}

/**
 * Pluggable transport carrying the renderer's live JSON-RPC traffic to the
 * intentd daemon. Implementations must throw `BackendError` on request /
 * subscribe failures, keep `unsubscribe` best-effort (never throw on
 * teardown), and return no-op disposers from the listener registrations when
 * the underlying bridge is unavailable.
 */
export interface BackendTransport {
  /** Whether the live backend bridge is reachable in this environment. */
  isAvailable(): boolean;
  /** Forward a JSON-RPC request to the daemon. */
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions,
  ): Promise<T>;
  /** Subscribe to daemon events (`events.subscribe`). Returns its raw result. */
  subscribe<T = { subscriptionId?: string }>(params: unknown): Promise<T>;
  /** Unsubscribe from daemon events (`events.unsubscribe`). Best-effort. */
  unsubscribe(subscriptionId: string): Promise<void>;
  /** Listen for daemon notifications. Returns a disposer. */
  onNotification(handler: (notification: BackendNotification) => void): () => void;
  /**
   * Listen for backend reconnects — fired when the transport re-establishes
   * its connection to the daemon after a drop. Returns a disposer.
   */
  onReconnected(handler: () => void): () => void;
}
