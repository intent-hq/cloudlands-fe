/**
 * Streaming arbitrary execution proxied to the daemon (`host.execStream`,
 * PROTOCOL.md §5.14).
 *
 * The buffered `hostExec` (§5.14) fits one-shot fire-and-forget calls, but
 * `augment-cli`-style flows need a live stdout/stderr feed **and** a stdin
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
  let resolveDone: (r: HostExecStreamResult) => void = () => {};
  let rejectDone: (e: Error) => void = () => {};

  const done = new Promise<HostExecStreamResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const cleanup = (): void => {
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
