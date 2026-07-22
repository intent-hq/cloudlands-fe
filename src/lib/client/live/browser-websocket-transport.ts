/**
 * Browser WebSocket implementation of the `BackendTransport` interface.
 *
 * When the renderer runs in a plain browser (no Electron preload bridge) it
 * speaks JSON-RPC 2.0 directly to the intentd daemon over a `WebSocket`
 * (PROTOCOL.md §1–§4): one JSON-RPC object per text frame, bearer token via
 * the `?token=` query param baked into the configured URL. Semantics mirror
 * the main-process `JsonRpcClient`
 * (`src/features/backend/main/json-rpc-client.ts`): request/response
 * id-correlation, default + per-call request timeouts, automatic reconnect
 * with exponential backoff, a `reconnected` signal once a connection is
 * re-established after a drop (RESUB-1) so consumers replay their
 * `events.subscribe` calls, and notification fanout.
 *
 * The URL comes from the `VITE_INTENTD_WS_URL` build-time env var (a full
 * `ws(s)://` URL, optional `?token=`); `backend-transport-factory.ts` selects
 * this transport when `window.electronAPI` is absent and the URL is
 * configured. The WebSocket constructor is injectable (`webSocketFactory`) so
 * unit tests drive the transport with a fake socket.
 */
import {
  BackendError,
  type BackendErrorPayload,
  type BackendNotification,
  type BackendRequestOptions,
  type BackendTransport,
} from "./backend-transport-types";

/**
 * Resolve the configured browser WebSocket URL from the build-time env.
 * Returns `undefined` when unset, blank, or not a `ws://`/`wss://` URL so the
 * factory falls back to the Electron-IPC transport's degraded behavior.
 */
export function resolveBrowserWsUrl(
  raw: unknown = import.meta.env.VITE_INTENTD_WS_URL,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const url = raw.trim();
  if (!url) return undefined;
  if (!/^wss?:\/\//i.test(url)) {
    console.warn(
      "[browser-websocket-transport] Ignoring VITE_INTENTD_WS_URL: expected a ws:// or wss:// URL",
    );
    return undefined;
  }
  return url;
}

// --- JSON-RPC error mapping -------------------------------------------------
// Browser-safe port of `src/features/backend/main/json-rpc-errors.ts` (that
// module lives in a `main/` subtree the renderer must not import at runtime).
// Produces the same `BackendErrorPayload` shape the Electron bridge emits via
// `JsonRpcError.toErrorPayload()` so consumers see identical errors on both
// transports.

/** Raw JSON-RPC error object as received from the daemon. */
interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

/** Canonical string codes for the reserved JSON-RPC numeric range. */
const JSON_RPC_ERROR_CODES: Readonly<Record<number, string>> = {
  [-32700]: "PARSE_ERROR",
  [-32600]: "INVALID_REQUEST",
  [-32601]: "METHOD_NOT_FOUND",
  [-32602]: "INVALID_PARAMS",
  [-32603]: "INTERNAL_ERROR",
};

/** Map a numeric JSON-RPC code to a stable string code. */
function mapErrorCode(code: number): string {
  const known = JSON_RPC_ERROR_CODES[code];
  if (known) return known;
  // -32099..-32000 is the reserved implementation-defined server-error range.
  if (code <= -32000 && code >= -32099) return "SERVER_ERROR";
  return "UNKNOWN_ERROR";
}

/** Extract a daemon-provided `data.code` string if present, else `undefined`. */
function explicitDataCode(data: unknown): string | undefined {
  if (data && typeof data === "object" && "code" in data) {
    const value = (data as { code?: unknown }).code;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** Build the serializable error payload for a JSON-RPC error response. */
function toBackendErrorPayload(error: JsonRpcErrorShape): BackendErrorPayload {
  const code = explicitDataCode(error.data) ?? mapErrorCode(error.code);
  // Ensure the resolved string code is always available on data.code; a
  // non-object daemon `data` is preserved as `data.detail` (parity with
  // JsonRpcError in the main process).
  const data =
    error.data && typeof error.data === "object"
      ? { ...(error.data as Record<string, unknown>), code }
      : typeof error.data === "string" && error.data.length > 0
        ? { code, detail: error.data }
        : { code };
  return { code, message: error.message, data, rpcCode: error.code };
}

/** Normalize any thrown value into a `BackendError` transport failure. */
function toTransportError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new BackendError({
    code: "TRANSPORT_ERROR",
    message,
    data: { code: "TRANSPORT_ERROR" },
  });
}

// --- WebSocket seam ---------------------------------------------------------

/**
 * Minimal surface of a browser `WebSocket` used by the transport. Injectable
 * via `webSocketFactory` so tests drive the transport with a fake socket.
 */
export interface BrowserWebSocketLike {
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BrowserWebSocketTransportOptions {
  /** Full `ws(s)://` daemon URL (bearer token via `?token=`, PROTOCOL §2.1). */
  url: string;
  /** WebSocket constructor seam for tests. Defaults to the global `WebSocket`. */
  webSocketFactory?: (url: string) => BrowserWebSocketLike;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_MS = 1_000;
const DEFAULT_MAX_RECONNECT_MS = 30_000;

/**
 * `BackendTransport` speaking JSON-RPC 2.0 over a browser WebSocket. One JSON
 * object per text frame (no newline framing — the WebSocket provides message
 * boundaries). Lifecycle mirrors the main-process `JsonRpcClient`: lazy
 * connect on first request, exponential-backoff reconnect, pending requests
 * failed fast on drop, `reconnected` fired on the 2nd+ successful connect.
 */
export class BrowserWebSocketTransport implements BackendTransport {
  private readonly url: string;
  private readonly webSocketFactory: (url: string) => BrowserWebSocketLike;
  private readonly requestTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;

  private socket: BrowserWebSocketLike | null = null;
  private connected = false;
  private connecting = false;
  private disposed = false;
  private requestId = 0;
  private currentReconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private readonly pending = new Map<number, PendingRequest>();
  /** Sticky flag so `reconnected` only fires on the 2nd (or later) successful connect. */
  private hasBeenConnected = false;
  private readonly notificationHandlers = new Set<(n: BackendNotification) => void>();
  private readonly reconnectedHandlers = new Set<() => void>();

  constructor(options: BrowserWebSocketTransportOptions) {
    this.url = options.url;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url) => new WebSocket(url) as unknown as BrowserWebSocketLike);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_MS;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_MS;
    this.currentReconnectDelay = this.reconnectDelayMs;
  }

  isAvailable(): boolean {
    return !this.disposed;
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions,
  ): Promise<T> {
    if (this.disposed) {
      return Promise.reject(
        new BackendError({ code: "UNAVAILABLE", message: "Backend transport disposed" }),
      );
    }
    const id = ++this.requestId;
    const override = options?.timeoutMs;
    const timeoutMs =
      typeof override === "number" && Number.isFinite(override) && override > 0
        ? override
        : this.requestTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      // The timeout clock starts at request() entry — not at send — so the
      // bound also covers time spent waiting for the WebSocket handshake
      // (e.g. a stalled connect attempt that never fires `close`).
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        this.pending.delete(id);
        reject(
          new BackendError({
            code: "TIMEOUT",
            message: `JSON-RPC request timed out: ${method}`,
            data: { code: "TIMEOUT" },
          }),
        );
      }, timeoutMs);
      // Register the pending entry and send synchronously once connected, so a
      // response arriving immediately after the frame is correlated correctly.
      const send = () => {
        if (timedOut) return;
        const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        this.pending.set(id, {
          method,
          timeout,
          resolve: (result) => resolve(result as T),
          reject,
        });
        try {
          this.socket?.send(payload);
        } catch (error) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(toTransportError(error));
        }
      };
      if (this.connected) {
        send();
      } else {
        this.ensureConnected().then(send, (error: unknown) => {
          clearTimeout(timeout);
          reject(toTransportError(error));
        });
      }
    });
  }

  async subscribe<T = { subscriptionId?: string }>(params: unknown): Promise<T> {
    return this.request<T>("events.subscribe", params);
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    try {
      await this.request("events.unsubscribe", { subscriptionId });
    } catch {
      // Unsubscribe is best-effort; ignore transport errors on teardown.
    }
  }

  onNotification(handler: (notification: BackendNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onReconnected(handler: () => void): () => void {
    this.reconnectedHandlers.add(handler);
    return () => this.reconnectedHandlers.delete(handler);
  }

  /** Tear down the transport: close the socket, clear timers, reject pending. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearReconnect();
    const error = new BackendError({ code: "UNAVAILABLE", message: "Backend transport disposed" });
    this.failPending(error);
    this.failWaiters(error);
    this.teardownSocket();
    this.notificationHandlers.clear();
    this.reconnectedHandlers.clear();
  }

  private ensureConnected(): Promise<void> {
    if (this.connected) return Promise.resolve();
    this.start();
    return new Promise<void>((resolve, reject) => {
      this.connectWaiters.push({ resolve, reject });
    });
  }

  /** Begin connecting (idempotent). */
  private start(): void {
    if (this.disposed || this.socket || this.connecting) return;
    // A scheduled reconnect owns the next attempt: new requests queue as
    // connect waiters instead of bypassing the exponential backoff.
    if (this.reconnectTimer) return;
    this.connect();
  }

  private connect(): void {
    this.clearReconnect();
    this.connecting = true;
    let socket: BrowserWebSocketLike;
    try {
      socket = this.webSocketFactory(this.url);
    } catch (error) {
      this.connecting = false;
      this.onConnectionFailure(toTransportError(error));
      return;
    }
    this.socket = socket;
    // Guard each callback so events from a torn-down socket cannot disturb a
    // newer connection attempt.
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.onConnected();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.onMessage(event.data);
    };
    // Browsers always follow `error` with a `close` event; handle the failure
    // there so it runs exactly once per drop.
    socket.onerror = null;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.connecting = false;
      this.onConnectionFailure(
        new BackendError({ code: "TRANSPORT_ERROR", message: "WebSocket connection closed" }),
      );
    };
  }

  private onConnected(): void {
    this.connecting = false;
    this.connected = true;
    this.currentReconnectDelay = this.reconnectDelayMs;
    const wasReconnect = this.hasBeenConnected;
    this.hasBeenConnected = true;
    this.flushWaiters();
    // Fire AFTER waiters so queued sends and the resubscribe replay observe a
    // connected transport; see RESUB-1.
    if (wasReconnect) {
      for (const handler of [...this.reconnectedHandlers]) handler();
    }
  }

  private onConnectionFailure(error: Error): void {
    if (this.disposed) return;
    this.connected = false;
    this.teardownSocket();
    this.failPending(error);
    // Reject in-flight connection waiters so pending request() calls fail fast
    // instead of hanging across reconnect attempts.
    this.failWaiters(error);
    this.scheduleReconnect();
  }

  private onMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let message: {
      id?: number | string | null;
      method?: string;
      result?: unknown;
      error?: JsonRpcErrorShape;
      params?: unknown;
    };
    try {
      message = JSON.parse(data) as typeof message;
    } catch {
      console.warn("[browser-websocket-transport] Dropping unparseable frame");
      return;
    }
    if (!message || typeof message !== "object") return;
    const hasMethod = typeof message.method === "string";
    const hasId = message.id != null;
    // Inbound (reverse) request: has BOTH `method` and `id` (§5.14). The
    // browser client registers no reverse handlers, so decline with -32601
    // rather than leaving the daemon's request hanging.
    if (hasMethod && hasId) {
      this.sendFrame({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Method not found: ${String(message.method)}` },
      });
      return;
    }
    // Response: correlate by numeric id against a pending outbound request.
    if (hasId) {
      const numericId = Number(message.id);
      const entry = this.pending.get(numericId);
      if (!entry) return;
      this.pending.delete(numericId);
      clearTimeout(entry.timeout);
      if (message.error) {
        entry.reject(new BackendError(toBackendErrorPayload(message.error)));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    // Notification: has a method and no id.
    if (hasMethod) {
      const notification: BackendNotification = {
        method: message.method as string,
        params: message.params,
      };
      for (const handler of [...this.notificationHandlers]) handler(notification);
    }
  }

  private sendFrame(frame: unknown): void {
    try {
      this.socket?.send(JSON.stringify(frame));
    } catch {
      // Best-effort; a dropped socket surfaces via its close handler.
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = this.currentReconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.currentReconnectDelay = Math.min(delay * 2, this.maxReconnectDelayMs);
      if (!this.disposed) this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownSocket(): void {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // ignore teardown errors
    }
  }

  private failPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private flushWaiters(): void {
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const waiter of waiters) waiter.resolve();
  }

  private failWaiters(error: Error): void {
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }
}

/** Create the browser WebSocket transport for the given daemon URL. */
export function createBrowserWebSocketTransport(
  options: BrowserWebSocketTransportOptions,
): BrowserWebSocketTransport {
  return new BrowserWebSocketTransport(options);
}
