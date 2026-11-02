/**
 * Daemon startup readiness (docs/protocol/startup-readiness.md), shared by the
 * main-process JSON-RPC client, the browser WebSocket transport, the update
 * flow and the renderer's startup progress screen.
 *
 * While a restarted daemon is still starting it answers `client.hello` and
 * every ordinary request with JSON-RPC error `-32012`: `data.code` is either
 * `daemon-not-ready` (retryable, with `retryAfterMs`) or `daemon-startup-failed`
 * (terminal). Only `system.startupStatus` answers with a snapshot.
 */
import { z } from 'zod';

/** JSON-RPC error code of the structured startup reply. */
const DAEMON_STARTUP_RPC_CODE = -32012;
/** The only method a starting daemon answers. */
export const STARTUP_STATUS_METHOD = 'system.startupStatus';

// The protocol bounds the daemon's retry hint to 1-30s.
const STARTUP_RETRY_DEFAULT_MS = 1000;
const STARTUP_RETRY_MIN_MS = 1000;
const STARTUP_RETRY_MAX_MS = 30_000;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const progress = z
  .object({
    completedNotes: count,
    totalNotes: count,
    processedSourceBytes: count,
    totalSourceBytes: count,
  })
  .refine((p) => p.completedNotes <= p.totalNotes && p.processedSourceBytes <= p.totalSourceBytes);
const snapshotSchema = z
  .object({
    startupStatus: z.literal(1),
    daemonVersion: z.string().min(1).optional(),
    attemptId: z.string().min(1),
    phase: z.enum(['preparing', 'indexing', 'finalizing', 'ready', 'failed']),
    elapsedMs: count,
    phaseElapsedMs: count,
    progressAgeMs: count,
    retryAfterMs: z.number().int().min(STARTUP_RETRY_MIN_MS).max(STARTUP_RETRY_MAX_MS).optional(),
    progress: progress.optional(),
    estimatedRemainingMs: count.optional(),
    finalizingStep: z.enum(['anchors', 'committing', 'services']).optional(),
    failure: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
  })
  .refine((s) => {
    const terminal = s.phase === 'ready' || s.phase === 'failed';
    return (
      (terminal ? s.retryAfterMs === undefined : s.retryAfterMs !== undefined) &&
      (s.phase === 'finalizing'
        ? s.finalizingStep !== undefined
        : s.finalizingStep === undefined) &&
      (s.phase === 'failed' ? s.failure !== undefined : s.failure === undefined) &&
      (s.estimatedRemainingMs === undefined || s.phase === 'indexing')
    );
  });

/** One `system.startupStatus` snapshot (schema 1). */
export type StartupSnapshot = z.infer<typeof snapshotSchema>;

/**
 * A connection's startup posture, `null` once it is ready (or before any
 * startup reply was seen). `snapshot` is the latest valid snapshot; `available`
 * is false when the most recent status read failed, so a cached snapshot is
 * never presented as current. `message` carries the daemon's failure text.
 */
export interface DaemonStartupState {
  state: 'starting' | 'failed';
  snapshot: StartupSnapshot | null;
  available: boolean;
  message?: string;
}

export type StartupReply =
  | { kind: 'not-ready'; retryAfterMs: number; snapshot: StartupSnapshot | null }
  | { kind: 'failed'; message: string; snapshot: StartupSnapshot | null };

/** A valid schema-1 snapshot, or `null` for anything else. */
export function parseStartupSnapshot(value: unknown): StartupSnapshot | null {
  const result = snapshotSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Clamp a daemon retry hint to the protocol's 1-30s window. */
export function clampStartupRetryMs(value: unknown): number {
  const hint =
    typeof value === 'number' && Number.isFinite(value) ? value : STARTUP_RETRY_DEFAULT_MS;
  return Math.min(STARTUP_RETRY_MAX_MS, Math.max(STARTUP_RETRY_MIN_MS, hint));
}

function numericRpcCode(error: object): number | undefined {
  const e = error as { rpcCode?: unknown; code?: unknown };
  if (typeof e.rpcCode === 'number') return e.rpcCode;
  return typeof e.code === 'number' ? e.code : undefined;
}

/**
 * Recognize the structured startup reply. Accepts the main-process
 * `JsonRpcError` (`rpcCode`), the renderer's IPC error payload (`rpcCode`) and
 * a raw JSON-RPC error object (`code`). Anything else is not a startup reply.
 */
export function classifyStartupReply(error: unknown): StartupReply | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (numericRpcCode(error) !== DAEMON_STARTUP_RPC_CODE) return undefined;
  const data = ((error as { data?: unknown }).data ?? {}) as {
    code?: unknown;
    retryable?: unknown;
    retryAfterMs?: unknown;
    startup?: unknown;
  };
  const snapshot = parseStartupSnapshot(data.startup);
  if (data.code === 'daemon-startup-failed') {
    const detail = (data.startup as { failure?: { message?: unknown } } | undefined)?.failure
      ?.message;
    const fallback = (error as { message?: unknown }).message;
    return {
      kind: 'failed',
      message:
        typeof detail === 'string' && detail.trim()
          ? detail
          : typeof fallback === 'string'
            ? fallback
            : '',
      snapshot,
    };
  }
  if (data.code !== 'daemon-not-ready' || data.retryable !== true) return undefined;
  return { kind: 'not-ready', retryAfterMs: clampStartupRetryMs(data.retryAfterMs), snapshot };
}

/**
 * The JSON-RPC error shape a client reports for a request it refused locally
 * because its daemon is still starting (or failed to start). It mirrors the
 * daemon's own reply, so callers and {@link classifyStartupReply} treat both
 * the same way.
 */
export function startupErrorShape(state: DaemonStartupState): {
  code: number;
  message: string;
  data: Record<string, unknown>;
} {
  const startup = state.snapshot ?? undefined;
  if (state.state === 'failed') {
    return {
      code: DAEMON_STARTUP_RPC_CODE,
      message: 'Daemon startup failed', // i18n-ignore (JSON-RPC protocol error, localized by startup UI)
      data: { code: 'daemon-startup-failed', retryable: false, startup },
    };
  }
  return {
    code: DAEMON_STARTUP_RPC_CODE,
    message: 'Daemon not ready', // i18n-ignore (JSON-RPC protocol error, localized by startup UI)
    data: {
      code: 'daemon-not-ready',
      retryable: true,
      retryAfterMs: clampStartupRetryMs(startup?.retryAfterMs),
      startup,
    },
  };
}

/** Bound on one `system.startupStatus` read; an unanswered poll re-hellos instead. */
export const STARTUP_POLL_TIMEOUT_MS = 5_000;

// While only the clocks move, republish at most this often: every publish is
// a full status broadcast to each window.
const STARTUP_REPUBLISH_MS = 5_000;
// Matches the progress screen's "count unchanged" threshold.
const STARTUP_STALLED_MS = 30_000;

/** What a transport supplies to {@link StartupPoller} for one bootstrap socket. */
export interface StartupPollerHost {
  /** Send `system.startupStatus` on the bootstrap socket. */
  request(): Promise<unknown>;
  /** Publish a new `starting` posture. */
  publish(state: DaemonStartupState): void;
  /**
   * Leave the bootstrap socket and hello again on a fresh one. `ready` is true
   * when the daemon reported ready; false when no usable status arrived.
   */
  handoff(ready: boolean): void;
  /** The daemon reported a terminal startup failure. */
  fail(message: string, snapshot: StartupSnapshot | null): void;
  /** Optional ownership wrapper for each asynchronous poll. */
  track?(poll: () => Promise<void>): void;
}

/** The parts of a posture worth an immediate publish (not the clocks). */
function startupKey(state: DaemonStartupState): string {
  const s = state.snapshot;
  return JSON.stringify([
    state.state,
    state.available,
    s?.attemptId,
    s?.phase,
    s?.finalizingStep,
    s?.progress?.completedNotes,
    s?.progress?.totalNotes,
    s?.estimatedRemainingMs === undefined,
    (s?.progressAgeMs ?? 0) >= STARTUP_STALLED_MS,
  ]);
}

/**
 * Polls one starting daemon, one request at a time, at the daemon's retry
 * delay. Shared by the main JSON-RPC client and the browser WebSocket
 * transport; each owns its socket, the handoff and the failure path.
 * {@link stop} must run whenever the bootstrap socket is torn down.
 */
export class StartupPoller {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: StartupSnapshot | null = null;
  private lastKey: string | null = null;
  private lastPublishedAt = 0;

  constructor(private readonly host: StartupPollerHost) {}

  /** The hello was answered with daemon-not-ready: publish it and arm the first poll. */
  start(reply: Extract<StartupReply, { kind: 'not-ready' }>): void {
    this.stop();
    this.snapshot = reply.snapshot ?? this.snapshot;
    this.publish(
      { state: 'starting', snapshot: this.snapshot, available: reply.snapshot !== null },
      true,
    );
    this.schedule(reply.retryAfterMs);
  }

  /** Cancel the pending or in-flight poll. */
  stop(): void {
    this.generation++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Forget the previous attempt's snapshot (the daemon became ready or went away). */
  reset(): void {
    this.stop();
    this.snapshot = null;
    this.lastKey = null;
    this.lastPublishedAt = 0;
  }

  private publish(state: DaemonStartupState, force = false): void {
    const key = startupKey(state);
    const now = Date.now();
    if (!force && key === this.lastKey && now - this.lastPublishedAt < STARTUP_REPUBLISH_MS) return;
    this.lastKey = key;
    this.lastPublishedAt = now;
    this.host.publish(state);
  }

  private schedule(delayMs: number): void {
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation) return;
      const poll = () => this.poll(generation);
      if (this.host.track) this.host.track(poll);
      else void poll();
    }, delayMs);
  }

  private async poll(generation: number): Promise<void> {
    let snapshot: StartupSnapshot | null;
    try {
      snapshot = parseStartupSnapshot(await this.host.request());
    } catch (error) {
      if (generation !== this.generation) return;
      const reply = classifyStartupReply(error);
      if (reply?.kind === 'failed') {
        this.stop();
        this.host.fail(reply.message, reply.snapshot);
        return;
      }
      if (reply?.kind === 'not-ready') {
        this.snapshot = reply.snapshot ?? this.snapshot;
        this.publish({
          state: 'starting',
          snapshot: this.snapshot,
          available: reply.snapshot !== null,
        });
        this.schedule(reply.retryAfterMs);
        return;
      }
      this.unavailable();
      return;
    }
    if (generation !== this.generation) return;
    if (snapshot === null) {
      this.unavailable();
      return;
    }
    this.snapshot = snapshot;
    if (snapshot.phase === 'failed') {
      this.stop();
      this.host.fail(snapshot.failure?.message ?? '', snapshot);
      return;
    }
    if (snapshot.phase === 'ready') {
      this.stop();
      this.publish({ state: 'starting', snapshot, available: true }, true);
      this.host.handoff(true);
      return;
    }
    this.publish({ state: 'starting', snapshot, available: true });
    this.schedule(clampStartupRetryMs(snapshot.retryAfterMs));
  }

  /** No usable status (timeout, unknown method, malformed reply): hello again. */
  private unavailable(): void {
    this.stop();
    this.publish({ state: 'starting', snapshot: this.snapshot, available: false }, true);
    this.host.handoff(false);
  }
}
