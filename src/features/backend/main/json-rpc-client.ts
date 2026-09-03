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
  AuthRejectedError,
  type BackendConnectionConfig,
  createBackendSocket,
  describeBackendConfig,
  type ConnectedVia,
  type HostCertMismatch,
  type RaceConnectInfo,
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
  /** Consecutive failed liveness probes required before reconnecting. Defaults to 1. */
  healthCheckFailureThreshold?: number;
  /**
   * §5.17 stable client identity. When set, the client performs a
   * `client.hello` handshake with these params (the persisted clientId) on
   * EVERY successful (re)connect, BEFORE the connection is reported
   * `connected` — so queued scoped work (`drafts.*`, `events.subscribe`) never
   * runs against an anonymous identity. The same params are also merged into
   * any caller-issued `client.hello` (e.g. the renderer capability probe), so
   * a re-hello on the connection can never mint a fresh identity.
   */
  helloParams?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  /**
   * Observer for every `client.hello` result (handshake and caller-issued) —
   * used to persist a daemon-minted clientId when ours was omitted (§5.17).
   */
  onHelloResult?: (result: unknown) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_MS = 1_000;
// Reconnect backoff is capped at 5s so a stopped daemon is re-probed at least
// every 5s while disconnected — the renderer's daemon-loss UX (#439) relies on
// a prompt automatic reconnect once the daemon comes back. Retries continue
// indefinitely (there is no give-up).
const DEFAULT_MAX_RECONNECT_MS = 5_000;

/** §5.17 global handshake method — carries the stable client identity. */
const HELLO_METHOD = 'client.hello';

// The connect-time handshake holds the connection at `connecting` (queueing
// all scoped work behind it), so it gets a much tighter bound than ordinary
// requests: a daemon that accepted the socket but never answers the hello
// degrades to an anonymous connection after 5s instead of stalling every
// queued request for the full request timeout.
const HELLO_HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * Events: `notification` (JsonRpcNotification), `status` (ConnectionStatus),
 * `reconnected` (void — fires when a successful connect follows an earlier
 * connected state so consumers can replay `events.subscribe` calls and
 * refresh coarse state after a daemon restart), `error` (Error),
 * `heartbeat` (void), `cert-warning` ({@link HostCertMismatch} — a NON-FATAL
 * per-host pin mismatch observed by the multi-host connection race (#1746);
 * informative only, never treated as a connection failure).
 */
export class JsonRpcClient extends EventEmitter {
  private readonly config: BackendConnectionConfig;
  private readonly socketFactory: (config: BackendConnectionConfig) => Duplex;
  private readonly requestTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly healthCheck?: () => Promise<void>;
  private readonly healthCheckFailureThreshold: number;
  private readonly helloParams?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  private readonly onHelloResult?: (result: unknown) => void;

  private socket: Duplex | null = null;
  // How the current connection's winning candidate reached the daemon
  // (multi-host race only; null for a single-host dial and whenever no socket
  // is connected).
  private connectedVia: ConnectedVia | null = null;
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
  private heartbeatInFlight = false;
  private consecutiveHealthCheckFailures = 0;
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private readonly pending = new Map<number, PendingRequest>();
  /** Sticky flag so `reconnected` only fires on the 2nd (or later) successful connect. */
  private hasBeenConnected = false;
  /** Consecutive reconnect attempts since the last successful connect (#1750). */
  private reconnectAttempts = 0;
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
    const healthCheckFailureThreshold = options.healthCheckFailureThreshold;
    this.healthCheckFailureThreshold =
      typeof healthCheckFailureThreshold === 'number' &&
      Number.isFinite(healthCheckFailureThreshold) &&
      healthCheckFailureThreshold >= 1
        ? Math.floor(healthCheckFailureThreshold)
        : 1;
    this.helloParams = options.helloParams;
    this.onHelloResult = options.onHelloResult;
    this.currentReconnectDelay = this.reconnectDelayMs;
  }

  /** Current connection status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Number of reconnect attempts made since the last successful connect
   * (0 while connected / before the first retry). Surfaced to the renderer via
   * the backend:status broadcast so the daemon-loss UI can show retry progress
   * (#1750).
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /** Connection config (transport type and target). */
  getConfig(): BackendConnectionConfig {
    return this.config;
  }

  /**
   * Whether the current connection won through the tailcat tunnel or a direct
   * host dial. Only known for a multi-host race (the facade reports its
   * winner); `null` for a single-host dial and whenever not connected. Reset
   * on every (re)connect, since a reconnect can flip the winner.
   */
  getConnectedVia(): ConnectedVia | null {
    return this.connectedVia;
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
    const override = options?.timeoutMs;
    const timeoutMs =
      typeof override === 'number' && Number.isFinite(override) && override > 0
        ? override
        : this.requestTimeoutMs;
    // §5.17: a caller-issued `client.hello` (e.g. the renderer capability
    // probe) must present the SAME persisted identity as the connect-time
    // handshake — an anonymous re-hello would mint a fresh clientId and
    // orphan the previous identity's scoped state (`drafts.*`, §5.16).
    if (method === HELLO_METHOD && (this.helloParams || this.onHelloResult)) {
      return this.requestHello(params, timeoutMs) as Promise<T>;
    }
    if (this.status === 'connected') {
      return this.sendNow<T>(method, params, timeoutMs);
    }
    return this.ensureConnected().then(() => this.sendNow<T>(method, params, timeoutMs));
  }

  /**
   * Register the pending entry and write synchronously (the request id is
   * allocated here, in write order), so a response that arrives immediately
   * after the call is correlated correctly. Callers must ensure the socket is
   * usable: either `status === 'connected'` or the §5.17 handshake window.
   */
  private sendNow<T = unknown>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
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
    });
  }

  /** Caller-issued `client.hello`: merge in the persisted identity and observe the result. */
  private async requestHello(params: unknown, timeoutMs: number): Promise<unknown> {
    const merged = await this.mergedHelloParams(params);
    if (this.status !== 'connected') await this.ensureConnected();
    const result = await this.sendNow(HELLO_METHOD, merged, timeoutMs);
    this.onHelloResult?.(result);
    return result;
  }

  /** Caller-supplied hello fields survive; the persisted identity wins on `clientId`. */
  private async mergedHelloParams(callerParams?: unknown): Promise<Record<string, unknown>> {
    const base =
      callerParams && typeof callerParams === 'object' && !Array.isArray(callerParams)
        ? (callerParams as Record<string, unknown>)
        : {};
    const identity = this.helloParams ? await this.helloParams() : {};
    return { ...base, ...identity };
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
    const onConnect = (info?: RaceConnectInfo) => this.onConnected(info);
    socket.once('connect', onConnect);
    socket.once('secureConnect', onConnect);
    socket.on('data', (chunk: Buffer | string) => this.onData(chunk));
    // Non-fatal per-host pin mismatches from the multi-host connection race
    // (#1746): re-emit for observers (backend.ipc's renderer warnings) without
    // touching the connection lifecycle — the race itself decides fatality.
    socket.on('pin-mismatch', (info: HostCertMismatch) => this.emit('cert-warning', info));
    socket.once('error', (error: Error) => this.onConnectionFailure(error));
    socket.once('close', () => this.onConnectionFailure(new Error('Connection closed')));
    logger.info('Connecting to backend', { target: describeBackendConfig(this.config) });
  }

  private onConnected(info?: RaceConnectInfo): void {
    // Record the race winner BEFORE the status flips to `connected` so the
    // `status` broadcast already carries the right tunnel/direct marker.
    this.connectedVia = info?.via === 'tunnel' || info?.via === 'direct' ? info.via : null;
    // §5.17: when a hello provider is configured, present the persisted
    // identity as the FIRST frame on the fresh socket and hold the status at
    // `connecting` until the daemon answers — queued scoped work (`drafts.*`,
    // `events.subscribe`) and the `reconnected` replay signal must never run
    // against an anonymous connection.
    if (this.helloParams || this.onHelloResult) {
      void this.performHelloHandshake(this.socket);
      return;
    }
    this.finishConnect();
  }

  private async performHelloHandshake(socket: Duplex | null): Promise<void> {
    try {
      const params = await this.mergedHelloParams();
      if (this.disposed || this.socket !== socket) return;
      const result = await this.sendNow(
        HELLO_METHOD,
        params,
        Math.min(this.requestTimeoutMs, HELLO_HANDSHAKE_TIMEOUT_MS),
      );
      if (this.disposed || this.socket !== socket) return;
      this.onHelloResult?.(result);
    } catch (error) {
      // The socket died mid-handshake: onConnectionFailure already tore it
      // down and scheduled a reconnect — do not report this socket connected.
      if (this.disposed || this.socket !== socket) return;
      // Identity degrades, transport survives: the daemon treats a failed
      // hello as an anonymous connection, so scoped features (§5.16 drafts)
      // may not restore, but everything else keeps working.
      logger.warn('client.hello handshake failed; continuing without confirmed identity', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.finishConnect();
  }

  private finishConnect(): void {
    this.currentReconnectDelay = this.reconnectDelayMs;
    this.reconnectAttempts = 0;
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
    // A 401/403 auth rejection (PROTOCOL §2.1) is not transient: every retry
    // would re-present the same stale credential and fail identically, so the
    // automatic reconnect loop stops here. Recovery paths (re-pair, backend
    // switch) build a fresh client; a later request() still triggers a single
    // on-demand connect via ensureConnected().
    if (error instanceof AuthRejectedError) {
      logger.warn('Backend rejected authentication; automatic reconnect halted', {
        target: describeBackendConfig(this.config),
        statusCode: error.statusCode,
      });
      return;
    }
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
      this.dispatchInboundRequest(
        message.id as number | string,
        message.method as string,
        message.params,
      );
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
      // i18n-ignore (wire-protocol error)
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

  private sendReverseError(
    id: number | string,
    code: number,
    message: string,
    data?: unknown,
  ): void {
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
      if (!this.disposed) {
        // Count the retry BEFORE connecting so the 'connecting' status
        // broadcast carries the up-to-date attempt number (#1750).
        this.reconnectAttempts += 1;
        this.connect();
      }
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
    this.heartbeatInFlight = false;
    this.consecutiveHealthCheckFailures = 0;
    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeat');
      if (!this.healthCheck || this.heartbeatInFlight) return;

      const socket = this.socket;
      this.heartbeatInFlight = true;
      this.healthCheck()
        .then(() => {
          if (this.disposed || this.socket !== socket) return;
          this.consecutiveHealthCheckFailures = 0;
        })
        .catch((error) => {
          if (this.disposed || this.socket !== socket) return;
          this.consecutiveHealthCheckFailures += 1;
          const connectionError = error instanceof Error ? error : new Error(String(error));
          if (this.consecutiveHealthCheckFailures >= this.healthCheckFailureThreshold) {
            this.onConnectionFailure(connectionError);
            return;
          }
          logger.warn('Backend health check failed; waiting for confirmation before reconnecting', {
            failures: this.consecutiveHealthCheckFailures,
            threshold: this.healthCheckFailureThreshold,
            error: connectionError.message,
          });
        })
        .finally(() => {
          if (this.socket === socket) this.heartbeatInFlight = false;
        });
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
    this.connectedVia = null;
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
