/**
 * Streaming arbitrary execution proxied to the daemon (`host.execStream`,
 * PROTOCOL.md §5.14).
 *
 * The buffered `hostExec` (§5.14) fits one-shot fire-and-forget calls, but
 * streaming CLI flows need a live stdout/stderr feed **and** a stdin
 * channel (initial payload + follow-up writes with an explicit EOF). Those go
 * through `host.execStream`, which returns `{ requestId }` immediately and
 * publishes:
 *   - `host:exec:stdout` — `{ requestId, chunk }` (base64-encoded bytes)
 *   - `host:exec:stderr` — same shape as stdout
 *   - `host:exec:exit`   — terminal: `{ requestId, ok, exitCode?, timedOut?, cancelled? }`
 *
 * Every call opens its own `events.subscribe` so multiple concurrent streams
 * cannot cross-talk, then unsubscribes on the terminal `host:exec:exit` frame
 * (mirrors the `git.clone` streaming client in `workspace.service.ts`). All
 * caller env values ride inside the request payload and are never logged.
 *
 * Turn-scoped subscription (RESUB-1): the subscription lives for a single
 * `host.execStream` invocation. If the daemon restarts mid-stream the
 * pending request rejects, cleanup runs, and the caller retries; there is no
 * long-lived subscription to replay after reconnect.
 */
import { Buffer } from 'node:buffer';
import { Logger } from '../logger';
import { getBackendClient } from '../../features/backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../features/backend/main/json-rpc-client';

const logger = new Logger('HostExecStream');

export interface HostExecStreamOptions {
  /** Positional arguments passed to `command`. No shell interpolation. */
  args?: string[];
  /** Working directory; requires `workspaceId` and must be inside its root. */
  cwd?: string;
  /** Extra env vars merged on top of the daemon's host env. Secret-safe. */
  env?: Record<string, string>;
  /** Wall-clock timeout in ms; the daemon reaps the whole process tree on hit. */
  timeoutMs?: number;
  /** Required when `cwd` is set so the daemon can enforce containment. */
  workspaceId?: string;
  /** Initial UTF-8 stdin payload written before any reader task starts. */
  stdin?: string;
  /** Initial base64-encoded stdin payload (mutually exclusive with `stdin`). */
  stdinBase64?: string;
  /** Called with each decoded stdout chunk as bytes arrive. */
  onStdout?: (chunk: Buffer) => void;
  /** Called with each decoded stderr chunk as bytes arrive. */
  onStderr?: (chunk: Buffer) => void;
  /** Abort signal: aborting invokes `host.execStream.cancel` on the daemon. */
  signal?: AbortSignal;
}

export interface HostExecStreamResult {
  ok: boolean;
  exitCode?: number;
  timedOut?: boolean;
  cancelled?: boolean;
  /**
   * Set when the stream was terminated because the live backend was switched
   * out from under it (see {@link cancelInflightHostExecStreamsForBackendSwitch}).
   * A `host.execStream` bound to the now-disposed client can never receive its
   * remaining output or exit frame, so the switch synthesizes this terminal
   * result so the consumer resolves deterministically instead of hanging.
   */
  cancelledByBackendSwitch?: boolean;
}

export interface HostExecStreamHandle {
  readonly requestId: string;
  /** Append UTF-8 bytes to the child's stdin. */
  writeStdin(input: string): Promise<void>;
  /** Append base64 bytes to the child's stdin. */
  writeStdinBase64(base64: string): Promise<void>;
  /** Close the child's stdin end so readers-to-EOF exit cleanly. */
  endStdin(): Promise<void>;
  /** Force-reap the child's process group; idempotent on unknown ids. */
  cancel(): Promise<{ ok: boolean; cancelled: boolean }>;
  /** Resolves with the terminal `host:exec:exit` frame; rejects on abort/RPC error. */
  readonly done: Promise<HostExecStreamResult>;
}

const EXEC_EVENT_TYPES = ['host:exec:stdout', 'host:exec:stderr', 'host:exec:exit'] as const;

/**
 * One entry per live `host.execStream` call, so a backend switch can enumerate
 * and terminate streams whose per-call subscription is bound to the client it
 * is about to dispose. Unlike the T8/T9 long-lived listeners, the exec-stream
 * subscription is per-call and cannot be migrated onto a stable forwarder, so
 * the chosen contract is cancel-and-notify (issue #1616): the switch tears the
 * stream down and hands the consumer a deterministic terminal frame.
 */
interface InflightExecStream {
  readonly requestId: string;
  /**
   * Fire-and-forget best-effort `host.execStream.cancel` to the still-connected
   * old daemon, then immediately settle the consumer's `done` with a
   * cancelled-by-backend-switch terminal result. Does NOT await the cancel RPC —
   * an unresponsive-but-connected old backend would otherwise stall the switch
   * on the 30s request timeout. Idempotent (a stream that settled on its own
   * between snapshot and sweep is a no-op) and never throws.
   */
  terminate(): void;
}

const inflightExecStreams = new Set<InflightExecStream>();

/**
 * True while {@link cancelInflightHostExecStreamsForBackendSwitch} is draining
 * the registry. A `host.execStream` call whose response resolves during this
 * window (after the sweep snapshotted the registry, while cancel RPCs are
 * pending) must NOT attach itself to the about-to-be-disposed client — it is
 * settled immediately with the same terminal frame instead. See the
 * registration guard in {@link hostExecStream}.
 */
let backendSwitchDraining = false;

/**
 * Cancel + notify every in-flight `host.execStream`, invoked by `switchBackend`
 * BEFORE the old client is disposed. Each stream's subscription and settle
 * callbacks are bound to the outgoing client; once it is disposed the remaining
 * output and terminal exit frame are unreachable and the consumer's `done`
 * would hang forever. For each in-flight stream this best-effort fires (never
 * awaits) `host.execStream.cancel` on the old daemon (still connected here;
 * failure is non-fatal) and settles `done` with a terminal
 * cancelled-by-backend-switch result. The registry is emptied and every
 * per-call listener detached from the outgoing client. A no-op when nothing is
 * streaming.
 *
 * Race-safe: the sweep loops until the registry is empty and holds
 * `backendSwitchDraining` for its whole duration, so a stream that registers
 * concurrently (its `host.execStream` response landing while cancel RPCs are
 * pending) is either caught by the next loop iteration or settled inline by the
 * registration guard — never left hanging on the disposed client.
 */
export async function cancelInflightHostExecStreamsForBackendSwitch(): Promise<void> {
  backendSwitchDraining = true;
  try {
    // Loop (not a single snapshot) so a stream whose `host.execStream` response
    // resolves mid-drain is still handled instead of orphaned on the client
    // about to be disposed. `backendSwitchDraining` stays true for the whole
    // loop, so such a stream is settled inline by the registration guard in
    // `hostExecStream` rather than joining the already-swept registry.
    while (inflightExecStreams.size > 0) {
      const entries = [...inflightExecStreams];
      // Clear so each terminate()'s own cleanup (which deletes its entry) is a
      // harmless no-op and a re-entrant call finds nothing to do.
      inflightExecStreams.clear();
      logger.debug('Cancelling in-flight host.execStream on backend switch', {
        count: entries.length,
      });
      // terminate() is synchronous and non-blocking (fires cancel, settles).
      for (const entry of entries) entry.terminate();
      // Yield one microtask so a registration whose `host.execStream` response
      // already resolved this tick runs (hitting the drain guard) before we
      // re-check the registry. We deliberately do NOT await the fire-and-forget
      // cancel RPCs — that is exactly the 30s-timeout stall this teardown avoids.
      await Promise.resolve();
    }
  } finally {
    backendSwitchDraining = false;
  }
}

function decodeChunk(input: unknown): Buffer | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  try {
    return Buffer.from(input, 'base64');
  } catch {
    return null;
  }
}

/**
 * Invoke `host.execStream` on the daemon and return a handle that streams
 * stdout/stderr via callbacks, exposes stdin write / cancel controls, and
 * resolves `done` on the terminal `host:exec:exit` frame. Rejects `done` on
 * RPC/transport failure so callers can degrade honestly (no silent local
 * spawn fallback).
 */
export async function hostExecStream(
  command: string,
  options: HostExecStreamOptions = {},
): Promise<HostExecStreamHandle> {
  const client = getBackendClient();

  // Subscribe FIRST so we cannot miss the first stdout/exit frame that races
  // the `host.execStream` response.
  let subscriptionId: string | undefined;
  try {
    const subResult = await client.request<{ subscriptionId?: string }>('events.subscribe', {
      eventTypes: EXEC_EVENT_TYPES,
    });
    if (typeof subResult?.subscriptionId === 'string' && subResult.subscriptionId.length > 0) {
      subscriptionId = subResult.subscriptionId;
    }
  } catch (error) {
    logger.debug('events.subscribe for host.execStream failed', {
      command,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const params: Record<string, unknown> = { command };
  if (options.args && options.args.length > 0) params.args = options.args;
  if (typeof options.cwd === 'string' && options.cwd.length > 0) params.cwd = options.cwd;
  if (options.env && Object.keys(options.env).length > 0) params.env = options.env;
  if (typeof options.timeoutMs === 'number') params.timeoutMs = options.timeoutMs;
  if (typeof options.workspaceId === 'string' && options.workspaceId.length > 0) {
    params.workspaceId = options.workspaceId;
  }
  if (typeof options.stdin === 'string') params.stdin = options.stdin;
  if (typeof options.stdinBase64 === 'string') params.stdinBase64 = options.stdinBase64;

  let notificationListener: ((n: JsonRpcNotification) => void) | null = null;
  let settled = false;
  let inflightEntry: InflightExecStream | null = null;
  let resolveDone: (r: HostExecStreamResult) => void = () => {};
  let rejectDone: (e: Error) => void = () => {};

  const done = new Promise<HostExecStreamResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const cleanup = (): void => {
    if (inflightEntry) {
      inflightExecStreams.delete(inflightEntry);
      inflightEntry = null;
    }
    if (notificationListener) {
      client.off('notification', notificationListener);
      notificationListener = null;
    }
    if (subscriptionId) {
      const idToRelease = subscriptionId;
      subscriptionId = undefined;
      client.request('events.unsubscribe', { subscriptionId: idToRelease }).catch((err) => {
        logger.debug('events.unsubscribe after host.execStream failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (options.signal && abortHandler) {
      options.signal.removeEventListener('abort', abortHandler);
    }
  };

  const settleOk = (result: HostExecStreamResult): void => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveDone(result);
  };

  const settleErr = (error: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectDone(error);
  };

  let started = false;
  let requestId = '';

  notificationListener = (n: JsonRpcNotification): void => {
    if (n.method !== 'events.event') return;
    const params = n.params as { event?: unknown } | undefined;
    const event = (params && typeof params === 'object' && 'event' in params
      ? (params as { event?: unknown }).event
      : params) as { type?: unknown; data?: unknown } | undefined;
    if (!event || typeof event !== 'object') return;
    const type = event.type;
    if (
      type !== 'host:exec:stdout'
      && type !== 'host:exec:stderr'
      && type !== 'host:exec:exit'
    ) return;
    const data = event.data as
      | {
          requestId?: unknown;
          chunk?: unknown;
          ok?: unknown;
          exitCode?: unknown;
          timedOut?: unknown;
          cancelled?: unknown;
        }
      | undefined;
    if (!data) return;
    if (!started || typeof data.requestId !== 'string' || data.requestId !== requestId) return;

    if (type === 'host:exec:stdout') {
      const bytes = decodeChunk(data.chunk);
      if (bytes && options.onStdout) options.onStdout(bytes);
      return;
    }
    if (type === 'host:exec:stderr') {
      const bytes = decodeChunk(data.chunk);
      if (bytes && options.onStderr) options.onStderr(bytes);
      return;
    }

    // host:exec:exit — terminal frame
    settleOk({
      ok: data.ok === true,
      exitCode: typeof data.exitCode === 'number' ? data.exitCode : undefined,
      timedOut: data.timedOut === true ? true : undefined,
      cancelled: data.cancelled === true ? true : undefined,
    });
  };
  client.on('notification', notificationListener);

  // Abort → cancel the daemon-side stream.
  let abortHandler: (() => void) | null = null;
  const cancelRpc = async (): Promise<{ ok: boolean; cancelled: boolean }> => {
    if (!started) return { ok: true, cancelled: false };
    try {
      const res = await client.request<{ ok?: boolean; cancelled?: boolean }>(
        'host.execStream.cancel',
        { requestId },
      );
      return { ok: res?.ok === true, cancelled: res?.cancelled === true };
    } catch (error) {
      logger.debug('host.execStream.cancel failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, cancelled: false };
    }
  };
  if (options.signal) {
    if (options.signal.aborted) {
      cleanup();
      throw new Error('host.execStream aborted before start');
    }
    abortHandler = () => {
      void cancelRpc();
      settleErr(new Error('host.execStream aborted'));
    };
    options.signal.addEventListener('abort', abortHandler);
  }

  try {
    const startResult = await client.request<{ requestId?: string }>(
      'host.execStream',
      params,
    );
    if (typeof startResult?.requestId !== 'string' || startResult.requestId.length === 0) {
      throw new Error('host.execStream returned no requestId');
    }
    requestId = startResult.requestId;
    started = true;
  } catch (error) {
    cleanup();
    throw error;
  }

  // Register in the in-flight set so a backend switch can enumerate and
  // terminate this stream before disposing the client it is bound to. Removed
  // again by `cleanup()` on any settle (normal exit, abort, or the switch sweep).
  const settleBackendSwitch = (): void => {
    // (a) Best-effort cancel on the still-connected old daemon — fire-and-forget.
    // Do NOT await: `cancelRpc` runs against `JsonRpcClient`'s 30s default
    // request timeout, so awaiting it would stall the switch on an
    // unresponsive-but-connected old backend. `cancelRpc` swallows its own
    // errors (never rejects), so `void` cannot leak an unhandled rejection.
    void cancelRpc();
    // (b) Hand the consumer a deterministic terminal frame so `done` resolves
    // instead of hanging on a client that is about to be disposed.
    settleOk({ ok: false, cancelled: true, cancelledByBackendSwitch: true });
  };
  inflightEntry = {
    requestId,
    terminate: settleBackendSwitch,
  };
  if (backendSwitchDraining) {
    // A backend switch snapshotted the registry before this stream's
    // `host.execStream` response landed. Attaching to the now-doomed client
    // would leave `done` hanging once it is disposed, so settle inline with the
    // same terminal frame instead of joining the (already-swept) registry.
    settleBackendSwitch();
  } else {
    inflightExecStreams.add(inflightEntry);
  }

  const handle: HostExecStreamHandle = {
    requestId,
    writeStdin: async (input: string) => {
      await client.request('host.execStream.write', { requestId, stdin: input });
    },
    writeStdinBase64: async (base64: string) => {
      await client.request('host.execStream.write', { requestId, stdinBase64: base64 });
    },
    endStdin: async () => {
      await client.request('host.execStream.write', { requestId, eof: true });
    },
    cancel: cancelRpc,
    done,
  };
  return handle;
}
