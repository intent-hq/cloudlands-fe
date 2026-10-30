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
import { parseProtocolVersion, type ProtocolVersion } from '$shared/protocol-version';
import {
  classifyStartupReply,
  clampStartupRetryMs,
  type DaemonStartupState,
  parseStartupSnapshot,
  STARTUP_STATUS_METHOD,
  type StartupReply,
  type StartupSnapshot,
  startupErrorShape,
} from '$shared/daemon-startup';
import { assertScopedFileReadSupport } from '$shared/root-file-read-support';
import { Logger } from '$shared/logger';
import type { RpcTrafficMessage, RpcTrafficObserver } from './rpc-traffic';
import { JsonRpcError, type JsonRpcErrorShape } from './json-rpc-errors';
import {
  AuthRejectedError,
  type BackendConnectionConfig,
  ConnectionLimitError,
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

export interface RepositoryConnection {
  readonly incarnation: object;
  readonly identity: object;
  readonly repositoryContext: boolean;
  readonly reviewMonitoring?: number;
  readonly repositoryResourceRead?: boolean;
  readonly gitlabCheckout?: boolean;
  readonly gitlabCheckoutOwnerAvatar?: boolean;
  readonly gitlabCheckoutRepoConfig?: boolean;
  readonly repositorySelection: boolean;
  readonly nativeReview: boolean;
  readonly nativeReviewCompanion: boolean;
}

/** Main-private physical evidence, never sent to the renderer. */
export type RepositoryConnectionEvent =
  | { type: 'opened'; incarnation: object }
  | { type: 'closed'; incarnation: object }
  | { type: 'identity-retired'; connection: RepositoryConnection }
  | { type: 'notification'; incarnation: object; notification: JsonRpcNotification };

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
  /** Main-private opt-in ownership. No wire or renderer authority is conveyed. */
  lifecycle?: Readonly<{ scope: symbol; generation: number }>;
  config?: BackendConnectionConfig;
  socketFactory?: (config: BackendConnectionConfig) => Duplex;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** Liveness heartbeat interval in ms. `0` disables the heartbeat. */
  heartbeatIntervalMs?: number;
  /** Optional async liveness probe invoked on each heartbeat tick. */
  healthCheck?: (parent?: object) => Promise<void>;
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
  onHelloResult?: (result: unknown, parent?: object) => void;
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
// all scoped work behind it), so its first attempt gets a much tighter bound
// than ordinary requests: queued work fails after 5s instead of stalling for
// the full request timeout. Later attempts escalate (see below).
const HELLO_HANDSHAKE_TIMEOUT_MS = 5_000;

// An unanswered hello (lost reply, transient stall) is retried on a fresh
// socket: staying connected without a handshake leaves every hello-gated
// feature dead for the socket's lifetime (intent-hq/intent#7868). Each
// consecutive connect-time timeout doubles the bound up to this ceiling, so a
// slow daemon or high-latency tunnel converges instead of churning at 5s.
const MAX_HELLO_HANDSHAKE_TIMEOUT_MS = 30_000;

// A corrupted inbound line reconnects (its reply is lost), but a daemon that
// corrupts frames deterministically would turn that into a reconnect storm
// failing all in-flight work every cycle. Past this many reconnects within the
// window, further corrupted lines are skipped (the pre-#7868 behavior) until
// the burst ages out; a lost hello reply is still recovered by its timeout.
const MAX_MALFORMED_FRAME_RECONNECTS = 3;
const MALFORMED_FRAME_WINDOW_MS = 60_000;

// A starting daemon answers only `system.startupStatus`, one poll at a time;
// an unanswered poll falls back to a fresh socket and a new hello.
const STARTUP_POLL_TIMEOUT_MS = 5_000;

/**
 * A request that got no reply within its bound. `name` and `message` stay the
 * plain-Error ones callers and IPC error payloads already see.
 */
class RequestTimeoutError extends Error {
  constructor(readonly method: string) {
    super(`JSON-RPC request timed out: ${method}`);
  }
}

function isHelloTimeout(error: unknown): error is RequestTimeoutError {
  return error instanceof RequestTimeoutError && error.method === HELLO_METHOD;
}

type RetirementFailure = {
  owner: object | null;
  kind: 'original' | 'transport' | 'forced' | 'late' | 'unknown' | 'close';
  error: unknown;
};
type RetirementIdentity = Readonly<{ scope: symbol; instance: symbol; generation: number }>;
export interface JsonRpcRetirementResult {
  identity: RetirementIdentity;
  ownersJoined: boolean;
  admissionSealed: boolean;
  outcome: 'clean' | 'original-failure' | 'forced' | 'ownership-fault';
  closes: readonly { incarnation: object; destroyRequested: boolean; closeObserved: boolean }[];
  failures: readonly RetirementFailure[];
}
export interface JsonRpcRetirement {
  readonly identity: RetirementIdentity;
  subscribeChanged(wake: () => void): () => void;
  isDrained(): boolean;
  excludedOwners(): readonly string[];
  failures(): readonly RetirementFailure[];
  seal(): { finish(): Promise<JsonRpcRetirementResult> };
}

/**
 * Request methods whose params never reach traffic observers (Dev Console
 * capture): desktop authority and input, and `secret.provide` (PROTOCOL
 * §5.56), whose `value` is a user secret.
 */
const REDACTED_TRAFFIC_METHODS: ReadonlySet<string> = new Set([
  'desktop.control',
  'desktop.revoke',
  'secret.provide',
]);

/**
 * Events: `notification` (JsonRpcNotification), `status` (ConnectionStatus),
 * `reconnected` (void — fires when a successful connect follows an earlier
 * connected state, failed dial or daemon startup wait so consumers can retry
 * startup work, replay `events.subscribe`, and refresh state after a daemon
 * restart), `startup` ({@link DaemonStartupState} | null — the daemon is
 * starting, failed to start, or became ready; see {@link getStartupState}),
 * `error` (Error),
 * `heartbeat` (void), `cert-warning` ({@link HostCertMismatch} — a NON-FATAL
 * per-host pin mismatch observed by the multi-host connection race (#1746);
 * informative only, never treated as a connection failure).
 */
export class JsonRpcClient extends EventEmitter {
  private connectionOwner?: object;
  private readonly lifecycle?: {
    identity: RetirementIdentity;
    stopping: boolean;
    independentClosed: boolean;
    producers: WeakSet<object>;
    sealed: boolean;
    finishing: boolean;
    active: Set<object>;
    listeners: Set<() => void>;
    failures: RetirementFailure[];
    exclusions: Set<string>;
    closes: Map<Duplex, { incarnation: object; destroyRequested: boolean; closeObserved: boolean }>;
    ticket?: JsonRpcRetirement;
    finish?: Promise<JsonRpcRetirementResult>;
  };

  private readonly config: BackendConnectionConfig;
  private readonly socketFactory: (config: BackendConnectionConfig) => Duplex;
  private readonly requestTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly healthCheck?: (parent?: object) => Promise<void>;
  private readonly healthCheckFailureThreshold: number;
  private readonly helloParams?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  private readonly onHelloResult?: (result: unknown, parent?: object) => void;

  private socket: Duplex | null = null;
  /** This socket's `client.hello` version, parsed once when the hello answers. */
  private protocolVersion: ProtocolVersion | null = null;
  private helloSnapshot: unknown;
  private helloRevision = 0;
  private renegotiatingHello = false;
  private socketIncarnation: object | null = null;
  private repositoryConnection: RepositoryConnection | null = null;
  private acknowledgedHelloIdentity: Readonly<{
    clientId: string;
    connectionRole: unknown;
  }> | null = null;
  private readonly repositoryObservers = new Set<(event: RepositoryConnectionEvent) => void>();
  private helloAttempt: object | null = null;
  private acknowledgedHello: unknown = null;
  private nodeCapabilities: Readonly<Record<string, number>> | null = null;
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
  private reverseSequence = 0;
  private connectionGeneration = 0;
  private readonly trafficObservers = new Set<RpcTrafficObserver>();
  private status: ConnectionStatus = 'disconnected';
  private disposed = false;
  private currentReconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInFlight = false;
  private consecutiveHealthCheckFailures = 0;
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private readonly pending = new Map<number, PendingRequest>();
  /** A successful connection or failed dial requires recovery on the next connect. */
  private hasBeenConnected = false;
  private hasConnectionFailed = false;
  /** Consecutive reconnect attempts since the last successful connect (#1750). */
  private reconnectAttempts = 0;
  /** Hellos in a row that got no reply; drives the escalating hello bound (#7868). */
  private helloTimeoutStreak = 0;
  /** Reconnects caused by corrupted inbound lines within the current window (#7868). */
  private malformedFrameReconnects = 0;
  private malformedFrameWindowStart = 0;
  /** The last connect attempt was refused by the guest connection cap (HTTP 503). */
  private connectionLimited = false;
  /** The daemon-requested wait before the next attempt while `connectionLimited`. */
  private connectionLimitRetryAfterMs: number | null = null;
  /** Handlers for daemon-initiated (reverse) requests, keyed by method name. */
  private readonly reverseHandlers = new Map<string, ReverseRequestHandler>();
  /** The daemon is starting or failed to start (docs/protocol/startup-readiness.md). */
  private startupState: DaemonStartupState | null = null;
  /** The socket whose hello was answered with daemon-not-ready, while it is polled. */
  private startupIncarnation: object | null = null;
  private startupPollTimer: ReturnType<typeof setTimeout> | null = null;
  private startupPollGeneration = 0;

  constructor(options: JsonRpcClientOptions = {}) {
    super();
    if (options.lifecycle) {
      this.lifecycle = {
        identity: Object.freeze({ ...options.lifecycle, instance: Symbol('JsonRpcClient') }),
        stopping: false,
        independentClosed: false,
        producers: new WeakSet(),
        sealed: false,
        finishing: false,
        active: new Set(),
        listeners: new Set(),
        failures: [],
        exclusions: new Set(),
        closes: new Map(),
      };
    }
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

  /** Read connection metadata without renegotiating identity or desktop authority. */
  readHelloSnapshot(): Promise<unknown> {
    const refused = this.refuseIndependent();
    if (refused) return Promise.reject(refused);
    return this.own('hello-snapshot', async () => {
      if (this.disposed) throw new Error('JSON-RPC client disposed');
      await this.ensureConnected();
      if (this.status !== 'connected' || this.helloSnapshot === undefined)
        throw new Error('Current backend handshake is unavailable');
      return structuredClone(this.helloSnapshot);
    });
  }

  /** Stop autonomous producers now; sealing is a separate synchronous admission boundary. */
  beginRetirement(): JsonRpcRetirement {
    const owned = this.lifecycle;
    if (!owned) throw new Error('Client lifecycle was not enrolled');
    if (owned.ticket) return owned.ticket;
    owned.stopping = true;
    this.clearReconnect();
    this.stopHeartbeat();
    // A starting daemon may take minutes: stop waiting for it now, whether a
    // status poll is pending or the ready handoff's fresh dial is scheduled.
    if (
      this.startupState?.state === 'starting' &&
      (this.startupIncarnation !== null || !this.socket)
    )
      this.abandonStartup();
    const drained = () =>
      owned.active.size === 0 &&
      this.pending.size === 0 &&
      this.connectWaiters.length === 0 &&
      this.status !== 'connecting';
    const sealed = { finish: () => this.finishRetirement() };
    owned.ticket = Object.freeze({
      identity: owned.identity,
      subscribeChanged: (wake: () => void) => {
        owned.listeners.add(wake);
        return () => {
          owned.listeners.delete(wake);
        };
      },
      isDrained: drained,
      excludedOwners: () => [...owned.exclusions],
      failures: () => [...owned.failures],
      seal: () => {
        if (owned.sealed) return sealed;
        if (!drained()) throw new Error('Original client owners have not joined');
        // Pure state change: a pool seals ALL members before the first destroy callback.
        owned.sealed = true;
        return sealed;
      },
    });
    return owned.ticket;
  }

  /** Main-private original continuation. It conveys no connection or command authority. */
  beginOriginalProducer(parent?: object): object | undefined {
    const owned = this.lifecycle;
    if (!owned) return undefined;
    if (owned.sealed || (parent ? !owned.active.has(parent) : owned.independentClosed)) {
      const error = new Error('Original producer admission is closed');
      owned.failures.push({ owner: parent ?? null, kind: 'late', error });
      this.lifecycleChanged();
      throw error;
    }
    const producer = Object.freeze({});
    owned.producers.add(producer);
    owned.active.add(producer);
    return producer;
  }

  /** End only the captured producer, after its original continuation and cleanup. */
  finishOriginalProducer(producer: object | undefined): void {
    if (!producer || !this.lifecycle) return;
    const owned = this.lifecycle;
    if (!owned.producers.has(producer) || !owned.active.delete(producer)) {
      const error = new Error('Original producer is foreign or already finished');
      owned.failures.push({ owner: producer, kind: 'late', error });
    }
    this.lifecycleChanged();
  }

  /** Explicit member retirement closes independent admission before joining descendants. */
  beginMemberRetirement(): JsonRpcRetirement {
    if (!this.lifecycle) throw new Error('Client lifecycle was not enrolled');
    this.lifecycle.independentClosed = true;
    return this.beginRetirement();
  }

  private refuseIndependent(parent?: object): Error | undefined {
    const owned = this.lifecycle;
    if (!owned || (!parent && !owned.independentClosed)) return this.refuseSealed();
    if (!owned.sealed && parent && owned.producers.has(parent) && owned.active.has(parent))
      return undefined;
    const error = new Error('Request lacks a live original client producer');
    owned.failures.push({ owner: parent ?? null, kind: 'late', error });
    this.lifecycleChanged();
    return error;
  }

  private originalCallback<T>(parent: object | undefined, invoke: (producer?: object) => T): T {
    const producer = this.beginOriginalProducer(parent);
    if (producer === undefined) return invoke();
    let result: T;
    try {
      result = invoke(producer);
    } catch (error) {
      this.finishOriginalProducer(producer);
      throw error;
    }
    if (result instanceof Promise)
      void result.then(
        () => this.finishOriginalProducer(producer),
        () => this.finishOriginalProducer(producer),
      );
    else this.finishOriginalProducer(producer);
    return result;
  }

  private lifecycleChanged(): void {
    const owned = this.lifecycle;
    if (!owned) return;
    for (const wake of [...owned.listeners]) {
      try {
        wake();
      } catch (error) {
        owned.failures.push({ owner: null, kind: 'unknown', error });
      }
    }
  }

  /** Observe the original result, never substitute a chained Promise for its caller. */
  private own<T>(kind: string, invoke: () => T): T {
    const owned = this.lifecycle;
    if (!owned) return invoke();
    const owner = Object.freeze({ kind });
    owned.active.add(owner);
    const done = (error?: { value: unknown }) => {
      if (error) owned.failures.push({ owner, kind: 'original', error: error.value });
      owned.active.delete(owner);
      this.lifecycleChanged();
    };
    let result: T;
    try {
      result = invoke();
    } catch (error) {
      done({ value: error });
      throw error;
    }
    if (result instanceof Promise) {
      void result.then(
        () => done(),
        (error: unknown) => done({ value: error }),
      );
    } else done();
    return result;
  }

  private refuseSealed(): Error | undefined {
    if (!this.lifecycle?.sealed) return undefined;
    const error = new Error('Request after client admission sealed');
    this.lifecycle.failures.push({ owner: null, kind: 'late', error });
    this.lifecycleChanged();
    return error;
  }

  private finishRetirement(): Promise<JsonRpcRetirementResult> {
    const owned = this.lifecycle!;
    if (owned.finish) return owned.finish;
    if (!owned.sealed) throw new Error('Client admission is not sealed');
    let resolve!: (result: JsonRpcRetirementResult) => void;
    owned.finish = new Promise((complete) => {
      resolve = complete;
    });
    let teardownReturned = false;
    const complete = () => {
      if (
        !teardownReturned ||
        owned.active.size ||
        this.pending.size ||
        this.connectWaiters.length ||
        [...owned.closes.values()].some((row) => !row.closeObserved)
      )
        return;
      owned.listeners.delete(complete);
      const failures = [...owned.failures];
      resolve(
        Object.freeze({
          identity: owned.identity,
          ownersJoined: true,
          admissionSealed: owned.sealed,
          outcome: failures.some((f) => f.kind === 'forced')
            ? 'forced'
            : failures.some((f) => ['late', 'unknown', 'close'].includes(f.kind))
              ? 'ownership-fault'
              : failures.length
                ? 'original-failure'
                : 'clean',
          closes: [...owned.closes.values()].map((row) => Object.freeze({ ...row })),
          failures,
        }),
      );
    };
    owned.listeners.add(complete);
    owned.finishing = true;
    try {
      this.dispose();
    } catch (error) {
      owned.failures.push({ owner: null, kind: 'close', error });
    } finally {
      owned.finishing = false;
      teardownReturned = true;
    }
    complete();
    return owned.finish;
  }

  /** Current connection status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * The daemon's startup posture: `starting` while it answers with
   * daemon-not-ready (status stays `connecting` and ordinary requests are
   * refused locally), `failed` after daemon-startup-failed (status is
   * `disconnected` and reconnects continue), `null` once a hello succeeds.
   */
  getStartupState(): DaemonStartupState | null {
    return this.startupState;
  }

  /** Main-private current socket AND positively acknowledged hello lifetime. */
  getRepositoryConnection(): RepositoryConnection | null {
    return !this.disposed && this.status === 'connected' && this.socket && !this.socket.destroyed
      ? this.repositoryConnection
      : null;
  }

  /** Main-private acknowledgement metadata; IDs here are not authorization. */
  getAcknowledgedHelloIdentity(
    captured: object,
  ): Readonly<{ clientId: string; connectionRole: unknown }> | null {
    return captured === this.getRepositoryConnection() ? this.acknowledgedHelloIdentity : null;
  }

  /** Read the existing handshake without changing the current connection's identity. */
  getAcknowledgedHello(): unknown {
    return this.getRepositoryConnection() ? structuredClone(this.acknowledgedHello) : null;
  }

  /** Observe only the current acknowledged identity; never send or renew hello. */
  getNodeCapabilities(): Readonly<Record<string, number>> | null {
    return this.getRepositoryConnection() ? this.nodeCapabilities : null;
  }

  /** Subscribe before start: no replay can establish a missed physical feed. */
  onRepositoryConnectionEvent(listener: (event: RepositoryConnectionEvent) => void): () => void {
    this.repositoryObservers.add(listener);
    return () => this.repositoryObservers.delete(listener);
  }

  private emitRepositoryEvent(event: RepositoryConnectionEvent): void {
    for (const listener of this.repositoryObservers) listener(event);
  }

  private retireRepositoryIdentity(): void {
    const connection = this.repositoryConnection;
    this.repositoryConnection = null;
    this.acknowledgedHelloIdentity = null;
    this.acknowledgedHello = null;
    this.nodeCapabilities = null;
    if (connection) this.emitRepositoryEvent({ type: 'identity-retired', connection });
  }

  private retireRepositorySocket(): void {
    const incarnation = this.socketIncarnation;
    this.socketIncarnation = null;
    this.retireRepositoryIdentity();
    this.helloAttempt = null;
    if (incarnation) this.emitRepositoryEvent({ type: 'closed', incarnation });
  }

  /** Send now on exactly the captured connection; never reconnect, queue or rebind. */
  requestOnCapturedConnection<T = unknown>(
    captured: object,
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
    parent?: object,
  ): Promise<T> {
    const refused = this.refuseIndependent(parent);
    if (refused) return Promise.reject(refused);
    return this.own('captured-request', () =>
      this.requestOnCapturedConnectionOriginal<T>(captured, method, params, options),
    );
  }

  private requestOnCapturedConnectionOriginal<T = unknown>(
    connection: object,
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    if (!connection || connection !== this.getRepositoryConnection() || method === HELLO_METHOD) {
      return Promise.reject(new Error('Captured repository connection is unavailable'));
    }
    const override = options?.timeoutMs;
    const timeout =
      typeof override === 'number' && Number.isFinite(override) && override > 0
        ? override
        : this.requestTimeoutMs;
    return this.sendNow<T>(method, params, timeout);
  }

  private beginHello(): object {
    this.helloSnapshot = undefined;
    this.helloRevision++;
    this.retireRepositoryIdentity();
    this.helloAttempt = Object.freeze({});
    return this.helloAttempt;
  }

  private confirmHello(attempt: object, result: unknown): void {
    if (this.helloAttempt !== attempt || !this.socketIncarnation || this.disposed) return;
    if (
      !result ||
      typeof result !== 'object' ||
      !('clientId' in result) ||
      typeof result.clientId !== 'string' ||
      result.clientId.length === 0
    )
      return;
    const capabilities = (result as { server?: { capabilities?: Record<string, unknown> } }).server
      ?.capabilities;
    this.acknowledgedHello = structuredClone(result);
    this.nodeCapabilities = Object.freeze({
      agentNodes: capabilities?.agentNodes === 1 ? 1 : 0,
      localNodeIsolation: capabilities?.localNodeIsolation === 1 ? 1 : 0,
      agentPlatformRouting: capabilities?.agentPlatformRouting === 1 ? 1 : 0,
      workspaceMembershipEvents: capabilities?.workspaceMembershipEvents === 1 ? 1 : 0,
      // Truncated note reads (§5.2): gates maxContentBytes / baseContentBytes.
      noteTruncatedRead: capabilities?.noteTruncatedRead === 1 ? 1 : 0,
    });
    this.acknowledgedHelloIdentity = Object.freeze({
      clientId: result.clientId,
      connectionRole: (result as { connectionRole?: unknown }).connectionRole,
    });
    this.repositoryConnection = Object.freeze({
      incarnation: this.socketIncarnation,
      identity: Object.freeze({}),
      reviewMonitoring:
        typeof capabilities?.reviewMonitoring === 'number' &&
        Number.isSafeInteger(capabilities.reviewMonitoring) &&
        capabilities.reviewMonitoring >= 1
          ? capabilities.reviewMonitoring
          : undefined,
      repositorySelection:
        (result as { server?: { capabilities?: { repositorySelection?: unknown } } }).server
          ?.capabilities?.repositorySelection === 1,
      nativeReview:
        (result as { server?: { capabilities?: { nativeReview?: unknown } } }).server?.capabilities
          ?.nativeReview === 1,
      nativeReviewCompanion:
        (result as { server?: { capabilities?: { nativeReviewCompanion?: unknown } } }).server
          ?.capabilities?.nativeReviewCompanion === 1,
      repositoryResourceRead:
        (result as { server?: { capabilities?: { repositoryResourceRead?: unknown } } }).server
          ?.capabilities?.repositoryResourceRead === 1,
      gitlabCheckout:
        (result as { server?: { capabilities?: { gitlabCheckout?: unknown } } }).server
          ?.capabilities?.gitlabCheckout === 1,
      gitlabCheckoutRepoConfig:
        (result as { server?: { capabilities?: { gitlabCheckoutRepoConfig?: unknown } } }).server
          ?.capabilities?.gitlabCheckoutRepoConfig === 1,
      gitlabCheckoutOwnerAvatar:
        (result as { server?: { capabilities?: { gitlabCheckoutOwnerAvatar?: unknown } } }).server
          ?.capabilities?.gitlabCheckoutOwnerAvatar === 1,
      repositoryContext:
        (result as { server?: { capabilities?: { repositoryContext?: unknown } } }).server
          ?.capabilities?.repositoryContext === 1,
    });
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

  /**
   * True while the most recent connect attempt was refused with HTTP 503 by
   * the daemon's guest connection cap (intent-hq/intentd#1917); cleared by
   * the next successful connect or a failure of any other kind. Surfaced to
   * the renderer via the backend:status broadcast so the daemon-loss UI can
   * name the cap instead of the generic reconnect copy.
   */
  isConnectionLimited(): boolean {
    return this.connectionLimited;
  }

  /**
   * The wait the refusing daemon asked for (its `Retry-After`, clamped, or
   * the default cadence) while {@link isConnectionLimited}; `null` otherwise.
   * The slow retry is scheduled on exactly this value, so the renderer can
   * show the actual wait.
   */
  getConnectionLimitRetryAfterMs(): number | null {
    return this.connectionLimited ? this.connectionLimitRetryAfterMs : null;
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

  /**
   * Begin connecting (idempotent). While the connection-limit cooldown is
   * armed this is a no-op: the scheduled slow retry is the only path that
   * re-presents the refused upgrade, so on-demand starts (and the requests
   * that trigger them) cannot collapse the slow cadence back into a loop.
   */
  start(): void {
    if (this.refuseSealed()) return;
    if (this.lifecycle?.stopping) return;
    if (this.disposed) return;
    if (this.socket || this.status === 'connecting' || this.reconnectTimer) return;
    if (this.isInConnectionLimitCooldown()) return;
    this.connect();
  }

  private isInConnectionLimitCooldown(): boolean {
    return this.connectionLimited && this.reconnectTimer !== null;
  }

  /** Observe only while a diagnostic session is open. Inactive capture never inspects payloads. */
  observeTraffic(observer: RpcTrafficObserver): () => void {
    if (this.disposed) return () => {};
    this.trafficObservers.add(observer);
    return () => {
      this.trafficObservers.delete(observer);
    };
  }

  private observeFrame(build: () => RpcTrafficMessage): void {
    if (this.trafficObservers.size === 0) return;
    try {
      const event = { ...build(), connectionGeneration: this.connectionGeneration };
      // Desktop authority, user input and secret values must never reach
      // diagnostic observers, which may persist or forward their traffic
      // payloads to renderers.
      if (event.type === 'request' && REDACTED_TRAFFIC_METHODS.has(event.method))
        event.payload = { redacted: true };
      for (const observer of this.trafficObservers) {
        try {
          void observer(event)?.catch(() => {});
        } catch {
          /* Diagnostics must never affect transport behavior. */
        }
      }
    } catch {
      /* Diagnostic parsing must not fail a live request. */
    }
  }

  /** Tear down the client: close the socket, clear timers, reject pending. */
  dispose(): void {
    if (this.disposed) return;
    if (this.lifecycle && !this.lifecycle.finishing) {
      this.lifecycle.stopping = true;
      this.lifecycle.failures.push({
        owner: null,
        kind: 'forced',
        error: new Error('Legacy disposal'),
      });
    }
    this.disposed = true;
    this.observeFrame(() => ({ type: 'disconnected' }));
    this.trafficObservers.clear();
    this.clearReconnect();
    this.stopHeartbeat();
    this.failPending(new Error('JSON-RPC client disposed'));
    this.failWaiters(new Error('JSON-RPC client disposed'));
    this.teardownSocket();
    this.repositoryObservers.clear();
    this.setStatus('disconnected');
    this.removeAllListeners();
    this.finishConnectionOwner();
    this.lifecycleChanged();
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
    parent?: object,
  ): Promise<T> {
    if (method === 'host.execStream' || method.startsWith('host.execStream.'))
      this.lifecycle?.exclusions.add('host-exec');
    const refused = this.refuseIndependent(parent);
    if (refused) return Promise.reject(refused);
    return this.originalCallback(parent, (producer) =>
      this.own('request', () => this.requestOriginal<T>(method, params, options, producer)),
    );
  }

  private requestOriginal<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
    parent?: object,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('JSON-RPC client disposed'));
    // A starting daemon rejects every ordinary request; refuse it here with the
    // same structured error instead of queueing it for minutes. Callers recover
    // on `reconnected`, which fires once the daemon is ready.
    if (this.startupState)
      return Promise.reject(new JsonRpcError(startupErrorShape(this.startupState)));
    if (
      [
        'sourceControl.authStatus',
        'sourceControl.connect',
        'sourceControl.cancelAuth',
        'sourceControl.revoke',
        'sourceControl.getUser',
      ].includes(method) &&
      params !== null &&
      typeof params === 'object' &&
      (params as { provider?: unknown }).provider === 'gitlab' &&
      Object.prototype.hasOwnProperty.call(params, 'instanceBaseUrl')
    ) {
      const connection = this.getRepositoryConnection();
      if (connection?.gitlabCheckout !== true) {
        return Promise.reject(
          Object.assign(new Error('GITLAB_INSTANCE_SETUP_UNSUPPORTED'), {
            code: 'gitlab-instance-unsupported',
          }),
        );
      }
      // New full-root operands must never be ignored by an older parser or
      // migrate onto a replacement socket after capability admission.
      return this.requestOnCapturedConnectionOriginal<T>(connection, method, params, options).then(
        (result) => {
          if (connection !== this.getRepositoryConnection()) {
            throw new Error('GITLAB_INSTANCE_SETUP_RETIRED');
          }
          return result;
        },
      );
    }
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
      return this.requestHello(params, timeoutMs, parent) as Promise<T>;
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
    const socket = this.socket;
    const helloRevision = method === HELLO_METHOD ? ++this.helloRevision : undefined;
    if (method === HELLO_METHOD) this.helloSnapshot = undefined;
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      assertScopedFileReadSupport(method, params, this.protocolVersion);
      const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
      this.observeOutboundRequest(id, method, payload);
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.observeFrame(() => ({
          type: 'response',
          key: `out:${id}`,
          status: 'timeout',
          payload: undefined,
        }));
        reject(new RequestTimeoutError(method));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        timeout,
        resolve: (result) => {
          if (method === HELLO_METHOD && this.socket === socket) {
            this.protocolVersion = parseProtocolVersion(
              (result as { protocolVersion?: unknown } | null)?.protocolVersion,
            );
            if (helloRevision === this.helloRevision) this.helloSnapshot = structuredClone(result);
          }
          resolve(result as T);
        },
        reject,
      });
      try {
        socket?.write(payload);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        this.observeFrame(() => ({
          type: 'response',
          key: `out:${id}`,
          status: 'send-error',
          payload: { message: error instanceof Error ? error.message : String(error) },
        }));
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private observeOutboundRequest(id: number, method: string, frame: string): void {
    // Keep the frame out of sendNow's shared closure context: its timeout and
    // pending callbacks outlive the write even when no observer is installed.
    this.observeFrame(() => ({
      type: 'request',
      key: `out:${id}`,
      direction: 'outbound',
      requestId: id,
      method,
      payload: JSON.parse(frame).params,
    }));
  }

  /** Caller-issued `client.hello`: merge in the persisted identity and observe the result. */
  private async requestHello(
    params: unknown,
    timeoutMs: number,
    parent?: object,
  ): Promise<unknown> {
    let attempt: object | undefined;
    let incarnation = this.socketIncarnation;
    const beginRenegotiation = () => {
      attempt = this.beginHello();
      incarnation = this.socketIncarnation;
      this.renegotiatingHello = true;
      this.stopHeartbeat();
      // Desktop execution and pending consent lose authority immediately, even
      // while the identity provider is still resolving. Concurrent hellos may
      // join this physical socket, but only the winning attempt restores it.
      this.setStatus('connecting');
    };
    if (this.status === 'connected' || this.renegotiatingHello) beginRenegotiation();
    let unanswered: RequestTimeoutError | undefined;
    try {
      const merged = await this.mergedHelloParams(params);
      if (this.disposed) throw new Error('JSON-RPC client disposed');
      if (!this.renegotiatingHello || incarnation !== this.socketIncarnation)
        await this.ensureConnected();
      if (this.disposed) throw new Error('JSON-RPC client disposed');
      beginRenegotiation();
      const result = await this.sendNow(HELLO_METHOD, merged, timeoutMs).catch((error) => {
        if (isHelloTimeout(error)) unanswered = error;
        throw error;
      });
      if (this.socketIncarnation !== incarnation || this.helloAttempt !== attempt || this.disposed)
        return result;
      this.own('hello-result', () =>
        this.originalCallback(parent, (parent) =>
          parent === undefined
            ? this.onHelloResult?.(result)
            : this.onHelloResult?.(result, parent),
        ),
      );
      this.confirmHello(attempt!, result);
      return result;
    } finally {
      if (
        attempt &&
        this.socketIncarnation === incarnation &&
        this.helloAttempt === attempt &&
        !this.disposed
      ) {
        this.renegotiatingHello = false;
        if (unanswered) {
          // beginHello already retired the previous identity; finishing here
          // would leave this socket without a handshake for good
          // (intent-hq/intent#7868). Reconnect so the connect-time handshake
          // restores it and consumers re-register on `reconnected`.
          // The daemon just failed to answer a hello, so the next connect-time
          // attempt starts from the escalated bound.
          this.helloTimeoutStreak += 1;
          logger.warn('client.hello re-handshake timed out; reconnecting', {
            nextBoundMs: this.handshakeTimeoutMs(),
          });
          this.onConnectionFailure(unanswered);
        } else {
          this.finishConnect();
          if (this.getRepositoryConnection()) this.emit('identity-confirmed');
        }
      }
    }
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
    // Fail fast with the cap refusal instead of parking the request behind
    // the slow retry (or re-dialing ahead of it).
    if (this.isInConnectionLimitCooldown()) {
      return Promise.reject(
        new ConnectionLimitError(this.connectionLimitRetryAfterMs ?? undefined),
      );
    }
    if (this.lifecycle?.stopping && this.status !== 'connecting')
      return Promise.reject(new Error('Original transport unavailable during retirement'));
    this.start();
    return new Promise<void>((resolve, reject) => {
      this.connectWaiters.push({ resolve, reject });
    });
  }

  private connect(): void {
    if (this.lifecycle?.stopping) return;
    if (this.lifecycle) {
      this.connectionOwner = Object.freeze({ kind: 'connect' });
      this.lifecycle.active.add(this.connectionOwner);
    }
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
    this.connectionGeneration++;
    const incarnation = Object.freeze({});
    this.socketIncarnation = incarnation;
    if (this.lifecycle) {
      const row = { incarnation, destroyRequested: false, closeObserved: false };
      this.lifecycle.closes.set(socket, row);
      socket.once('close', () => {
        row.closeObserved = true;
        // The original failure handler owns an unsolicited close. It must
        // record that failure before this event can advertise readiness.
        if (row.destroyRequested) this.lifecycleChanged();
      });
    }
    this.repositoryConnection = null;
    this.emitRepositoryEvent({ type: 'opened', incarnation });
    const current = () => this.socket === socket && this.socketIncarnation === incarnation;
    const onConnect = (info?: RaceConnectInfo) => {
      if (current()) this.onConnected(info);
    };
    socket.once('connect', onConnect);
    socket.once('secureConnect', onConnect);
    socket.on('data', (chunk: Buffer | string) => this.onData(chunk, incarnation));
    // Non-fatal per-host pin mismatches from the multi-host connection race
    // (#1746): re-emit for observers (backend.ipc's renderer warnings) without
    // touching the connection lifecycle — the race itself decides fatality.
    socket.on('pin-mismatch', (info: HostCertMismatch) => {
      if (current()) this.emit('cert-warning', info);
    });
    socket.once('error', (error: Error) => {
      if (current()) this.onConnectionFailure(error);
    });
    socket.once('close', () => {
      if (current()) this.onConnectionFailure(new Error('Connection closed'));
    });
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
      void this.own('handshake', () => this.performHelloHandshake(this.socket));
      return;
    }
    this.finishConnect();
  }

  private async performHelloHandshake(socket: Duplex | null): Promise<void> {
    const attempt = this.beginHello();
    try {
      const params = await this.mergedHelloParams();
      if (this.disposed || this.socket !== socket) return;
      const result = await this.sendNow(HELLO_METHOD, params, this.handshakeTimeoutMs());
      if (this.disposed || this.socket !== socket || this.helloAttempt !== attempt) return;
      this.helloTimeoutStreak = 0;
      this.own('hello-result', () =>
        this.originalCallback(this.connectionOwner, (parent) =>
          parent === undefined
            ? this.onHelloResult?.(result)
            : this.onHelloResult?.(result, parent),
        ),
      );
      this.confirmHello(attempt, result);
    } catch (error) {
      if (!this.disposed && this.socket === socket && this.helloAttempt === attempt) {
        const startup = classifyStartupReply(error);
        if (startup) {
          this.helloTimeoutStreak = 0;
          this.enterStartup(startup);
          return;
        }
      }
      // No reply at all (e.g. the reply was lost): the rest of the app gates on
      // the handshake result and only re-registers on a reconnect, so an
      // anonymous socket would stay degraded for its whole lifetime
      // (intent-hq/intent#7868). Retry on a fresh socket with a longer bound.
      // onConnectionFailure records this failure (as `transport`) itself.
      if (!this.disposed && this.socket === socket && isHelloTimeout(error)) {
        this.helloTimeoutStreak += 1;
        logger.warn('client.hello handshake timed out; reconnecting', {
          consecutiveTimeouts: this.helloTimeoutStreak,
          nextBoundMs: this.handshakeTimeoutMs(),
        });
        this.onConnectionFailure(error);
        return;
      }
      this.lifecycle?.failures.push({
        owner: this.connectionOwner ?? null,
        kind: 'original',
        error,
      });
      // The socket died mid-handshake: onConnectionFailure already tore it
      // down and scheduled a reconnect — do not report this socket connected.
      if (this.disposed || this.socket !== socket) return;
      // Identity degrades, transport survives: the daemon treats a failed
      // hello as an anonymous connection, so scoped features (§5.16 drafts)
      // may not restore, but everything else keeps working. Only a daemon error
      // reply (e.g. method missing from a legacy daemon) lands here: it is
      // definitive, so retrying would not help.
      this.helloTimeoutStreak = 0;
      logger.warn('client.hello handshake failed; continuing without confirmed identity', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.finishConnect();
  }

  /**
   * The connect-time hello bound: 5s, doubling per consecutive timeout up to
   * 30s, and never longer than an ordinary request may wait.
   */
  private handshakeTimeoutMs(): number {
    let bound = HELLO_HANDSHAKE_TIMEOUT_MS;
    for (let i = 0; i < this.helloTimeoutStreak && bound < MAX_HELLO_HANDSHAKE_TIMEOUT_MS; i++)
      bound *= 2;
    return Math.min(this.requestTimeoutMs, bound, MAX_HELLO_HANDSHAKE_TIMEOUT_MS);
  }

  private finishConnect(): void {
    this.stopStartupPoll();
    this.startupIncarnation = null;
    if (this.startupState) this.updateStartup(null);
    this.currentReconnectDelay = this.reconnectDelayMs;
    this.reconnectAttempts = 0;
    this.connectionLimited = false;
    const wasReconnect = this.hasBeenConnected || this.hasConnectionFailed;
    this.hasBeenConnected = true;
    this.hasConnectionFailed = false;
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
    this.finishConnectionOwner();
  }

  private finishConnectionOwner(): void {
    if (this.connectionOwner) this.lifecycle?.active.delete(this.connectionOwner);
    this.connectionOwner = undefined;
    this.lifecycleChanged();
  }

  private onConnectionFailure(error: Error): void {
    if (this.disposed) return;
    // A starting daemon closes its bootstrap sockets once it is ready: reopen
    // one fresh connection and hello again, still `connecting`.
    if (this.startupIncarnation !== null && this.startupIncarnation === this.socketIncarnation) {
      logger.info('Starting backend closed the connection; reconnecting', {
        target: describeBackendConfig(this.config),
        reason: error.message,
      });
      this.startupHandoff();
      return;
    }
    // Any other drop ends the wait: the daemon is gone, not starting. A
    // startup failure stays latched until a new attempt or a connect.
    if (this.startupState?.state === 'starting') this.updateStartup(null);
    this.lifecycle?.failures.push({
      owner: this.connectionOwner ?? null,
      kind: 'transport',
      error,
    });
    this.retireRepositorySocket();
    this.hasConnectionFailed = true;
    // Only back-to-back unanswered hellos escalate the hello bound; any other
    // drop (daemon restart, dial failure) starts the count over.
    if (!isHelloTimeout(error)) this.helloTimeoutStreak = 0;
    this.observeFrame(() => ({ type: 'disconnected' }));
    this.emitError(error);
    this.stopHeartbeat();
    this.teardownSocket();
    this.failPending(error);
    // Reject in-flight connection waiters so pending request() calls fail fast
    // instead of hanging across reconnect attempts.
    this.failWaiters(error);
    // Decided BEFORE the status broadcast so the `disconnected` push already
    // carries the cap posture.
    this.connectionLimited = error instanceof ConnectionLimitError;
    this.connectionLimitRetryAfterMs =
      error instanceof ConnectionLimitError ? error.retryAfterMs : null;
    this.setStatus('disconnected');
    // A 401/403 auth rejection (PROTOCOL §2.1) is not transient: every retry
    // would re-present the same stale credential and fail identically, so the
    // automatic reconnect loop stops here. Recovery paths (re-pair, backend
    // switch) build a fresh client; a later request() still triggers a single
    // on-demand connect via ensureConnected().
    if (error instanceof AuthRejectedError) {
      this.finishConnectionOwner();
      logger.warn('Backend rejected authentication; automatic reconnect halted', {
        target: describeBackendConfig(this.config),
        statusCode: error.statusCode,
      });
      return;
    }
    if (error instanceof ConnectionLimitError) {
      // Keep retrying (a seat may free), but on the slow bounded cadence the
      // daemon asked for: the ordinary backoff would re-present the same
      // refused upgrade every 5s.
      logger.warn('Backend refused the connection: guest connection limit reached', {
        target: describeBackendConfig(this.config),
        retryInMs: error.retryAfterMs,
      });
      this.currentReconnectDelay = Math.max(this.currentReconnectDelay, error.retryAfterMs);
    }
    this.scheduleReconnect();
    this.finishConnectionOwner();
  }

  private onData(chunk: Buffer | string, incarnation: object): void {
    if (this.socketIncarnation !== incarnation || this.disposed) return;
    // Decode bytes through the StringDecoder so a multi-byte UTF-8 character
    // straddling two chunks is held back until its bytes are complete.
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (this.socketIncarnation !== incarnation || this.disposed) return;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: unknown;
      let malformed: string | undefined;
      try {
        message = JSON.parse(trimmed);
        // No batches on this wire: anything but a plain object is corruption.
        if (message === null || typeof message !== 'object' || Array.isArray(message))
          malformed = 'not a JSON-RPC message object';
      } catch (error) {
        malformed = error instanceof Error ? error.message : String(error);
      }
      if (malformed !== undefined) {
        // A corrupted line means any reply inside it is lost: its caller would
        // wait out the full timeout, and a lost hello reply strands the socket
        // without a handshake (intent-hq/intent#7868). Reconnect so pending
        // work fails now and consumers re-register on `reconnected`.
        if (this.admitMalformedFrameReconnect()) {
          logger.warn('Malformed JSON-RPC frame from backend; reconnecting', {
            bytes: trimmed.length,
            error: malformed,
          });
          this.onConnectionFailure(
            new Error(`Malformed JSON-RPC frame from backend: ${malformed}`),
          );
          return;
        }
        logger.warn('Malformed JSON-RPC frame from backend; skipping (reconnect budget spent)', {
          bytes: trimmed.length,
          error: malformed,
        });
        this.emitError(new Error(`Malformed JSON-RPC frame from backend: ${malformed}`));
        continue;
      }
      try {
        this.handleMessage(message as Parameters<JsonRpcClient['handleMessage']>[0], incarnation);
      } catch (error) {
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /** Whether a corrupted line may reconnect, within the per-window budget. */
  private admitMalformedFrameReconnect(): boolean {
    const now = Date.now();
    if (now - this.malformedFrameWindowStart >= MALFORMED_FRAME_WINDOW_MS) {
      this.malformedFrameWindowStart = now;
      this.malformedFrameReconnects = 0;
    }
    if (this.malformedFrameReconnects >= MAX_MALFORMED_FRAME_RECONNECTS) return false;
    this.malformedFrameReconnects += 1;
    return true;
  }

  private handleMessage(
    message: {
      id?: number | string | null;
      method?: string;
      result?: unknown;
      error?: JsonRpcErrorShape;
      params?: unknown;
    },
    incarnation: object,
  ): void {
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
        this.observeFrame(() => ({
          type: 'response',
          key: `out:${numericId}`,
          status: message.error ? 'error' : 'success',
          payload: message.error ?? message.result,
        }));
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
      this.observeFrame(() => ({
        type: 'notification',
        direction: 'inbound',
        method: message.method as string,
        payload: message.params,
      }));
      const notification = { method: message.method as string, params: message.params };
      this.emitRepositoryEvent({ type: 'notification', incarnation, notification });
      if (this.socketIncarnation === incarnation && !this.disposed)
        this.emit('notification', notification);
    }
  }

  private dispatchInboundRequest(id: number | string, method: string, params: unknown): void {
    const key = `in:${++this.reverseSequence}`;
    this.observeFrame(() => ({
      type: 'request',
      key,
      direction: 'inbound',
      requestId: id,
      method,
      payload: params,
    }));
    const handler = this.reverseHandlers.get(method);
    if (!handler) {
      // i18n-ignore (wire-protocol error)
      this.sendReverseError(key, id, -32601, `Method not found: ${method}`);
      return;
    }
    this.lifecycle?.exclusions.add('reverse-handler');
    if (this.refuseSealed()) return;
    void this.own('reverse-handler', () =>
      Promise.resolve()
        .then(() => handler(params))
        .then(
          (result) => this.sendReverseResult(key, id, result),
          (error: unknown) => {
            this.lifecycle?.failures.push({ owner: null, kind: 'original', error });
            if (error instanceof ReverseRpcHandlerError) {
              this.sendReverseError(key, id, error.code, error.message, error.data);
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.sendReverseError(key, id, -32603, message);
          },
        ),
    );
  }

  private sendReverseResult(key: string, id: number | string, result: unknown): void {
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, result: result ?? null })}\n`;
    this.writeReverseFrame(key, payload, 'success');
  }

  private sendReverseError(
    key: string,
    id: number | string,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    const error: { code: number; message: string; data?: unknown } = { code, message };
    if (data !== undefined) error.data = data;
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`;
    this.writeReverseFrame(key, payload, 'error');
  }

  private writeReverseFrame(key: string, payload: string, status: 'success' | 'error'): void {
    try {
      this.socket?.write(payload);
      this.observeFrame(() => ({
        type: 'response',
        key,
        status,
        payload: status === 'error' ? JSON.parse(payload).error : JSON.parse(payload).result,
      }));
    } catch (error) {
      this.observeFrame(() => ({
        type: 'response',
        key,
        status: 'send-error',
        payload: { message: error instanceof Error ? error.message : String(error) },
      }));
      this.lifecycle?.failures.push({ owner: null, kind: 'transport', error });
      this.emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private scheduleReconnect(): void {
    if (this.lifecycle?.stopping || this.disposed || this.reconnectTimer) return;
    const delay = this.currentReconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.currentReconnectDelay = Math.min(delay * 2, this.maxReconnectDelayMs);
      if (!this.disposed && !this.lifecycle?.stopping) {
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
    if (this.lifecycle?.stopping || this.heartbeatIntervalMs <= 0) return;
    this.stopHeartbeat();
    this.heartbeatInFlight = false;
    this.consecutiveHealthCheckFailures = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.lifecycle?.stopping) return;
      this.emit('heartbeat');
      if (!this.healthCheck || this.heartbeatInFlight) return;

      const socket = this.socket;
      this.heartbeatInFlight = true;
      void this.own('health-chain', () =>
        this.own('health-result', () =>
          this.originalCallback(undefined, (parent) =>
            parent === undefined ? this.healthCheck!() : this.healthCheck!(parent),
          ),
        )
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
            logger.warn(
              'Backend health check failed; waiting for confirmation before reconnecting',
              {
                failures: this.consecutiveHealthCheckFailures,
                threshold: this.healthCheckFailureThreshold,
                error: connectionError.message,
              },
            );
          })
          .finally(() => {
            if (this.socket === socket) this.heartbeatInFlight = false;
          }),
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
    this.stopStartupPoll();
    this.startupIncarnation = null;
    this.protocolVersion = null;
    this.helloSnapshot = undefined;
    this.helloRevision++;
    this.renegotiatingHello = false;
    // Retire BEFORE any teardown callback can attempt another dispatch.
    this.retireRepositorySocket();
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.connectedVia = null;
    this.buffer = '';
    // Drop any partially-decoded multi-byte sequence so a reconnect starts clean.
    this.decoder = new StringDecoder('utf8');
    socket.removeAllListeners();
    const close = this.lifecycle?.closes.get(socket);
    if (close) {
      close.destroyRequested = true;
      if (!close.closeObserved)
        socket.once('close', () => {
          close.closeObserved = true;
          this.lifecycleChanged();
        });
      socket.on('error', (error) => {
        this.lifecycle?.failures.push({ owner: null, kind: 'close', error });
        this.lifecycleChanged();
      });
    }
    try {
      socket.destroy();
    } catch (error) {
      this.lifecycle?.failures.push({ owner: null, kind: 'close', error });
      // Ordinary disposal keeps its existing best-effort teardown.
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

  private updateStartup(next: DaemonStartupState | null): void {
    this.startupState = next ? Object.freeze({ ...next }) : null;
    this.emit('startup', this.startupState);
  }

  /** The connect-time hello was answered with the structured startup reply. */
  private enterStartup(reply: StartupReply): void {
    // The eventual ready connect is a recovery: consumers whose requests were
    // refused meanwhile retry on `reconnected`.
    this.hasConnectionFailed = true;
    if (reply.kind === 'failed') {
      this.failStartup(reply.message, reply.snapshot);
      return;
    }
    if (this.lifecycle?.stopping) {
      this.abandonStartup();
      return;
    }
    const previous = this.startupState?.state === 'starting' ? this.startupState.snapshot : null;
    this.startupIncarnation = this.socketIncarnation;
    const starting: DaemonStartupState = {
      state: 'starting',
      snapshot: reply.snapshot ?? previous,
      available: reply.snapshot !== null,
    };
    this.updateStartup(starting);
    logger.info('Backend is starting; waiting until it is ready', {
      target: describeBackendConfig(this.config),
      phase: reply.snapshot?.phase,
      retryAfterMs: reply.retryAfterMs,
    });
    this.failWaiters(new JsonRpcError(startupErrorShape(starting)));
    this.scheduleStartupPoll(reply.retryAfterMs);
  }

  private scheduleStartupPoll(delayMs: number): void {
    this.stopStartupPoll();
    const generation = this.startupPollGeneration;
    const incarnation = this.startupIncarnation;
    this.startupPollTimer = setTimeout(() => {
      this.startupPollTimer = null;
      if (
        generation !== this.startupPollGeneration ||
        incarnation === null ||
        incarnation !== this.socketIncarnation ||
        this.disposed
      )
        return;
      void this.own('startup-poll', () => this.pollStartup(generation, incarnation));
    }, delayMs);
  }

  private stopStartupPoll(): void {
    this.startupPollGeneration++;
    if (this.startupPollTimer) {
      clearTimeout(this.startupPollTimer);
      this.startupPollTimer = null;
    }
  }

  private async pollStartup(generation: number, incarnation: object): Promise<void> {
    const current = () =>
      generation === this.startupPollGeneration &&
      incarnation === this.startupIncarnation &&
      incarnation === this.socketIncarnation &&
      !this.disposed;
    const previous = this.startupState?.snapshot ?? null;
    let snapshot: StartupSnapshot | null;
    try {
      snapshot = parseStartupSnapshot(
        await this.sendNow(STARTUP_STATUS_METHOD, undefined, STARTUP_POLL_TIMEOUT_MS),
      );
    } catch (error) {
      if (!current()) return;
      const reply = classifyStartupReply(error);
      if (reply?.kind === 'failed') {
        this.failStartup(reply.message, reply.snapshot);
        return;
      }
      if (reply?.kind === 'not-ready') {
        this.updateStartup({
          state: 'starting',
          snapshot: reply.snapshot ?? previous,
          available: reply.snapshot !== null,
        });
        this.scheduleStartupPoll(reply.retryAfterMs);
        return;
      }
      // No usable status (timeout, unknown method, transport error): hello
      // again on a fresh socket, which re-enters startup if still starting.
      logger.warn('Backend startup status unavailable; reconnecting', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.updateStartup({ state: 'starting', snapshot: previous, available: false });
      this.startupHandoff();
      return;
    }
    if (!current()) return;
    if (snapshot === null) {
      logger.warn('Backend startup status was malformed; reconnecting');
      this.updateStartup({ state: 'starting', snapshot: previous, available: false });
      this.startupHandoff();
      return;
    }
    if (snapshot.phase === 'failed') {
      this.failStartup(snapshot.failure?.message ?? '', snapshot);
      return;
    }
    this.updateStartup({ state: 'starting', snapshot, available: true });
    if (snapshot.phase === 'ready') {
      logger.info('Backend finished starting; reconnecting', {
        target: describeBackendConfig(this.config),
      });
      this.startupHandoff();
      return;
    }
    this.scheduleStartupPoll(clampStartupRetryMs(snapshot.retryAfterMs));
  }

  /**
   * Leave the bootstrap socket and dial one fresh connection after the base
   * delay. Status stays `connecting`, so no connection-lost posture flashes;
   * the fresh hello either confirms readiness or re-enters startup.
   */
  private startupHandoff(): void {
    const refusal = this.startupState
      ? new JsonRpcError(startupErrorShape(this.startupState))
      : new Error('Connection closed');
    this.teardownSocket();
    this.failPending(refusal);
    this.finishConnectionOwner();
    if (this.disposed || this.lifecycle?.stopping) {
      this.failWaiters(refusal);
      this.setStatus('disconnected');
      return;
    }
    this.clearReconnect();
    this.currentReconnectDelay = this.reconnectDelayMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed && !this.lifecycle?.stopping) this.connect();
    }, this.reconnectDelayMs);
  }

  /** The daemon reported a terminal startup failure. */
  private failStartup(message: string, snapshot: StartupSnapshot | null): void {
    this.stopStartupPoll();
    this.startupIncarnation = null;
    this.hasConnectionFailed = true;
    const failed: DaemonStartupState = {
      state: 'failed',
      snapshot,
      available: snapshot !== null,
      message,
    };
    this.updateStartup(failed);
    logger.warn('Backend failed to start', {
      target: describeBackendConfig(this.config),
      message,
    });
    // Normal reconnect backoff continues: the sitter may restart or roll back.
    this.onConnectionFailure(new JsonRpcError(startupErrorShape(failed)));
  }

  /** Retirement during startup: stop waiting and release the connection. */
  private abandonStartup(): void {
    const error = new Error('Original transport unavailable during retirement');
    this.teardownSocket();
    this.failPending(error);
    this.failWaiters(error);
    this.setStatus('disconnected');
    this.finishConnectionOwner();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }
}
