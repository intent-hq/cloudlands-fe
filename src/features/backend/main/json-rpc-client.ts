/**
 * Main-process JSON-RPC 2.0 client for the live intentd daemon.
 *
 * Speaks newline-delimited JSON-RPC over a duplex stream (UDS for local dev, a
 * TCP/TLS stub for remote). Owns request/response id-correlation, notification
 * dispatch, automatic reconnect with backoff, an optional liveness heartbeat,
 * and numeric → string error-code mapping (see ./json-rpc-errors).
 *
 * The transport is injectable via `socketFactory` so unit tests can drive it
 * with an in-memory fake socket and never touch the live socket.
 */
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { Logger } from '$shared/logger';
import { JsonRpcError, type JsonRpcErrorShape } from './json-rpc-errors';
import {
  type BackendConnectionConfig,
  createBackendSocket,
  describeBackendConfig,
  resolveBackendConfig,
} from './backend-connection';

const logger = new Logger('JsonRpcClient');

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

/**
 * Handler for a daemon-initiated (reverse) JSON-RPC request. Returns the
 * `result` payload directly; throw a {@link ReverseRpcHandlerError} to control
 * the numeric error code, or any other Error to surface as `-32603`.
 */
export type ReverseRequestHandler = (params: unknown) => Promise<unknown> | unknown;

/**
 * Throw this from a reverse-request handler to control the numeric JSON-RPC
 * error code sent back to the daemon (falls back to `-32603` otherwise).
 */
export class ReverseRpcHandlerError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ReverseRpcHandlerError';
    this.code = code;
    this.data = data;
  }
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface JsonRpcClientOptions {
  config?: BackendConnectionConfig;
  socketFactory?: (config: BackendConnectionConfig) => Duplex;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** Liveness heartbeat interval in ms. `0` disables the heartbeat. */
  heartbeatIntervalMs?: number;
  /** Optional async liveness probe invoked on each heartbeat tick. */
  healthCheck?: () => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_MS = 1_000;
const DEFAULT_MAX_RECONNECT_MS = 30_000;

/**
 * Events: `notification` (JsonRpcNotification), `status` (ConnectionStatus),
 * `reconnected` (void — fires when a successful connect follows an earlier
 * connected state so consumers can replay `events.subscribe` calls and
 * refresh coarse state after a daemon restart), `error` (Error),
 * `heartbeat` (void).
 */
export class JsonRpcClient extends EventEmitter {
  private readonly config: BackendConnectionConfig;
  private readonly socketFactory: (config: BackendConnectionConfig) => Duplex;
  private readonly requestTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly healthCheck?: () => Promise<void>;

  private socket: Duplex | null = null;
  // Decoded text awaiting a newline. Raw bytes are run through `decoder` first so
  // a multi-byte UTF-8 character split across two `data` events reassembles
  // correctly before we split on '\n'.
  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private requestId = 0;
  private status: ConnectionStatus = 'disconnected';
  private disposed = false;
  private currentReconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private readonly pending = new Map<number, PendingRequest>();
  /** Sticky flag so `reconnected` only fires on the 2nd (or later) successful connect. */
  private hasBeenConnected = false;
  /** Handlers for daemon-initiated (reverse) requests, keyed by method name. */
  private readonly reverseHandlers = new Map<string, ReverseRequestHandler>();

  constructor(options: JsonRpcClientOptions = {}) {
    super();
    this.config = options.config ?? resolveBackendConfig();
    this.socketFactory = options.socketFactory ?? createBackendSocket;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_MS;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 0;
    this.healthCheck = options.healthCheck;
    this.currentReconnectDelay = this.reconnectDelayMs;
  }

  /** Current connection status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Begin connecting (idempotent). */
  start(): void {
    if (this.disposed) return;
    if (this.socket || this.status === 'connecting') return;
    this.connect();
  }

  /** Tear down the client: close the socket, clear timers, reject pending. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.failPending(new Error('JSON-RPC client disposed'));
    this.failWaiters(new Error('JSON-RPC client disposed'));
    this.teardownSocket();
    this.setStatus('disconnected');
    this.removeAllListeners();
  }

  /**
   * Register a handler for a daemon-initiated (reverse) JSON-RPC request
   * (§5.14). Daemon-issued requests carry a `rev-<n>` string `id` and are
   * dispatched to the handler registered for their `method`; the returned value
   * is sent back as the JSON-RPC `result`. Throwing a
   * {@link ReverseRpcHandlerError} lets the handler pick the numeric error
   * code; any other Error surfaces as `-32603 INTERNAL_ERROR`. Idempotent:
   * re-registering the same method replaces the previous handler. Returns a
   * disposer for symmetric setup/teardown.
   */
  registerMethod(method: string, handler: ReverseRequestHandler): () => void {
    this.reverseHandlers.set(method, handler);
    return () => {
      // Only clear the slot if it still points at *this* handler — a later
      // re-registration must not be silently torn down by a stale disposer.
      if (this.reverseHandlers.get(method) === handler) {
        this.reverseHandlers.delete(method);
      }
    };
  }

  /** Remove a previously registered reverse-request handler (idempotent). */
  unregisterMethod(method: string): void {
    this.reverseHandlers.delete(method);
  }

  /**
   * Send a JSON-RPC request and resolve with its result (or reject on error).
   *
   * `options.timeoutMs` overrides the client's default `requestTimeoutMs` for a
   * single call — used for long-running daemon operations (e.g. `git.pull`)
   * whose own bound exceeds the flat client default, so the daemon's structured
   * `{ok:false}` result wins over a transport timeout. A non-finite or negative
   * override falls back to the default; `0` is not honoured (guard against a
   * ready-to-time-out timer).
   */
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('JSON-RPC client disposed'));
    const id = ++this.requestId;
    const override = options?.timeoutMs;
    const timeoutMs =
      typeof override === 'number' && Number.isFinite(override) && override > 0
        ? override
        : this.requestTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      // Register the pending entry and write synchronously once connected, so a
      // response that arrives immediately after the call is correlated correctly.
      const send = () => {
        const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
        const timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`JSON-RPC request timed out: ${method}`));
        }, timeoutMs);
        this.pending.set(id, {
          method,
          timeout,
          resolve: (result) => resolve(result as T),
          reject,
        });
        try {
          this.socket?.write(payload);
        } catch (error) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      if (this.status === 'connected') {
        send();
      } else {
        this.ensureConnected().then(send).catch(reject);
      }
    });
  }

  private ensureConnected(): Promise<void> {
    if (this.status === 'connected') return Promise.resolve();
    this.start();
    return new Promise<void>((resolve, reject) => {
      this.connectWaiters.push({ resolve, reject });
    });
  }

  private connect(): void {
    this.clearReconnect();
    this.setStatus('connecting');
    let socket: Duplex;
    try {
      socket = this.socketFactory(this.config);
    } catch (error) {
      this.onConnectionFailure(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.socket = socket;
    const onConnect = () => this.onConnected();
    socket.once('connect', onConnect);
    socket.once('secureConnect', onConnect);
    socket.on('data', (chunk: Buffer | string) => this.onData(chunk));
    socket.once('error', (error: Error) => this.onConnectionFailure(error));
    socket.once('close', () => this.onConnectionFailure(new Error('Connection closed')));
    logger.info('Connecting to backend', { target: describeBackendConfig(this.config) });
  }

  private onConnected(): void {
    this.currentReconnectDelay = this.reconnectDelayMs;
    const wasReconnect = this.hasBeenConnected;
    this.hasBeenConnected = true;
    this.setStatus('connected');
    this.flushWaiters();
    this.startHeartbeat();
    logger.info('Backend connected', {
      target: describeBackendConfig(this.config),
      reconnected: wasReconnect,
    });
    // Emit AFTER `status` so consumers observing `status → connected` see the
    // reconnect marker as a follow-up signal. Consumers replay subscriptions
    // and refresh coarse state in this handler; see RESUB-1.
    if (wasReconnect) this.emit('reconnected');
  }

  private onConnectionFailure(error: Error): void {
    if (this.disposed) return;
    this.emitError(error);
    this.stopHeartbeat();
    this.teardownSocket();
    this.failPending(error);
    // Reject in-flight connection waiters so pending request() calls fail fast
    // instead of hanging across reconnect attempts.
    this.failWaiters(error);
    this.setStatus('disconnected');
    this.scheduleReconnect();
  }

  private onData(chunk: Buffer | string): void {
    // Decode bytes through the StringDecoder so a multi-byte UTF-8 character
    // straddling two chunks is held back until its bytes are complete.
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.handleMessage(JSON.parse(trimmed));
      } catch (error) {
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleMessage(message: {
    id?: number | string | null;
    method?: string;
    result?: unknown;
    error?: JsonRpcErrorShape;
    params?: unknown;
  }): void {
    const hasMethod = typeof message.method === 'string';
    const hasId = message.id != null;
    // Inbound request: has BOTH `method` and `id` (daemon → client reverse RPC,
    // §5.14). The `id` is preserved verbatim (client-side ids are numeric while
    // daemon-issued reverse ids live in the `rev-<n>` string namespace); a
    // daemon-issued response could never carry `method`, so the two branches
    // do not overlap.
    if (hasMethod && hasId) {
      this.dispatchInboundRequest(message.id as number | string, message.method as string, message.params);
      return;
    }
    // Response: correlate by numeric id against a pending outbound request.
    if (hasId) {
      const numericId = Number(message.id);
      const entry = this.pending.get(numericId);
      if (entry) {
        this.pending.delete(numericId);
        clearTimeout(entry.timeout);
        if (message.error) {
          entry.reject(new JsonRpcError(message.error));
        } else {
          entry.resolve(message.result);
        }
        return;
      }
    }
    // Notification: has a method and no id.
    if (hasMethod && !hasId) {
      this.emit('notification', { method: message.method as string, params: message.params });
    }
  }

  private dispatchInboundRequest(id: number | string, method: string, params: unknown): void {
    const handler = this.reverseHandlers.get(method);
    if (!handler) {
      this.sendReverseError(id, -32601, `Method not found: ${method}`);
      return;
    }
    Promise.resolve()
      .then(() => handler(params))
      .then(
        (result) => this.sendReverseResult(id, result),
        (error: unknown) => {
          if (error instanceof ReverseRpcHandlerError) {
            this.sendReverseError(id, error.code, error.message, error.data);
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          this.sendReverseError(id, -32603, message);
        },
      );
  }

  private sendReverseResult(id: number | string, result: unknown): void {
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, result: result ?? null })}\n`;
    this.writeFrame(payload);
  }

  private sendReverseError(id: number | string, code: number, message: string, data?: unknown): void {
    const error: { code: number; message: string; data?: unknown } = { code, message };
    if (data !== undefined) error.data = data;
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`;
    this.writeFrame(payload);
  }

  private writeFrame(payload: string): void {
    try {
      this.socket?.write(payload);
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
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

  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeat');
      if (!this.healthCheck) return;
      this.healthCheck().catch((error) =>
        this.onConnectionFailure(error instanceof Error ? error : new Error(String(error))),
      );
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private teardownSocket(): void {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.buffer = '';
    // Drop any partially-decoded multi-byte sequence so a reconnect starts clean.
    this.decoder = new StringDecoder('utf8');
    socket.removeAllListeners();
    try {
      socket.destroy();
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

  /**
   * Emit an `error` event without tripping Node's special-case throw when no
   * listener is attached (production wiring attaches one; tests may not).
   */
  private emitError(error: Error): void {
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }
}
