/**
 * Per-transfer JSON-RPC connections for bulk payloads (monorepo#2458).
 *
 * A 16 MiB upload chunk is ~21.3 MiB of base64 on the wire; while it drains
 * on a slow uplink it head-of-line-blocks EVERYTHING sharing the socket —
 * the liveness heartbeat times out and tears down a healthy connection, and
 * unrelated RPCs hit their own timeouts. Instead of making the heartbeat
 * tolerant, each bulk transfer rides its OWN short-lived connection
 * (connect → transfer → close) reusing the main channel's connection
 * parameters (endpoint, bearer token, TLS material). The daemon accepts
 * multiple concurrent WSS connections and keys upload sessions by uploadId,
 * not connection, so no daemon changes are needed.
 *
 * Transfer connections are request-only: no event subscriptions, drafts,
 * reverse-RPC registration, or liveness heartbeat — per-request timeouts
 * (transfer-scale, 5 minutes) bound them instead. At most
 * {@link MAX_TRANSFER_CONNECTIONS} are open at once (client-side bound —
 * intentd does not limit concurrent connections); further transfers wait
 * FIFO for a free slot. A settling transfer (success, failure, or abort)
 * disposes its socket and releases its slot.
 *
 * Only remote transports route here (`backend.ipc.ts` gates on
 * `transport !== 'uds'`); the local sidecar keeps the single UDS socket.
 */
import { Logger } from '$shared/logger';
import type { BackendConnectionConfig } from './backend-connection';
import { JsonRpcClient } from './json-rpc-client';

const logger = new Logger('TransferConnections');

/**
 * Hard cap on simultaneously open transfer connections. Side benefit for
 * chunked uploads: the daemon separately caps live upload sessions at 4 per
 * workspace (`ATTACHMENT_UPLOAD_MAX_SESSIONS_PER_WORKSPACE`), and this
 * client-side bound keeps chunked uploads under that too.
 */
export const MAX_TRANSFER_CONNECTIONS = 4;

/**
 * Default per-request timeout on a transfer connection. A 16 MiB chunk (or
 * a ≤25 MB single-shot `data` payload, up to ~33 MiB of base64) blows the
 * main channel's flat 30s default on connections below ~6 Mbit/s; 5 minutes
 * tolerates ~0.6 Mbit/s. Matches `UPLOAD_TRANSFER_TIMEOUT_MS` on the
 * renderer side (context-api.ts).
 */
export const TRANSFER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Idle TTL on a chunked-upload session lease, mirroring the daemon's
 * `ATTACHMENT_UPLOAD_IDLE_TTL` (15 min). A session lease is normally
 * settled by commit/abort, but if the renderer reloads or crashes after
 * `begin` no abort ever arrives — without reclamation the lease would hold
 * its socket and pool slot until a backend switch or shutdown, and enough
 * leaks would starve the pool. The timer resets on session activity; on
 * expiry the lease is released (socket disposed, slot freed). A late chunk
 * then fails via the self-contained `no live transfer connection` path, and
 * commit/abort fall back to a one-shot connection.
 */
export const SESSION_LEASE_IDLE_TTL_MS = 15 * 60 * 1000;

/**
 * A leased transfer connection: a dedicated request-only JsonRpcClient plus
 * the concurrency slot it occupies. `release()` disposes the socket and
 * frees the slot (idempotent); every acquirer MUST release when its
 * transfer settles — success, failure, or abort.
 */
export interface TransferConnectionLease {
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T>;
  release(): void;
}

/** Test seam: how a transfer client is built from the connection config. */
type TransferClientFactory = (config: BackendConnectionConfig) => JsonRpcClient;

const defaultClientFactory: TransferClientFactory = (config) =>
  new JsonRpcClient({
    config,
    requestTimeoutMs: TRANSFER_REQUEST_TIMEOUT_MS,
    // Request-only: no heartbeat (per-request timeouts bound liveness), and
    // callers never register reverse handlers or subscriptions on it.
    // The client's built-in auto-reconnect (1s→5s backoff) is intentionally
    // kept: the daemon keys upload sessions by uploadId, not connection, so
    // a mid-session socket blip recovers transparently. It is bounded — a
    // one-shot transfer disposes when `fn` settles, and a session lease is
    // reclaimed by {@link SESSION_LEASE_IDLE_TTL_MS} when no settle arrives.
    heartbeatIntervalMs: 0,
  });

let clientFactory: TransferClientFactory = defaultClientFactory;

/** Open leases, so a backend switch/shutdown can dispose every socket. */
const activeLeases = new Set<TransferConnectionLease>();

/** Slots in use (leases open); never exceeds {@link MAX_TRANSFER_CONNECTIONS}. */
let activeCount = 0;

/** FIFO queue of transfers waiting for a free slot. */
let slotWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

/**
 * Bumped by {@link disposeAllTransferConnections}; a waiter that was handed
 * a slot in the same tick as a dispose (before its continuation ran) checks
 * this after waking and fails instead of opening a connection against the
 * outgoing backend.
 */
let disposeGeneration = 0;

/** In-flight chunked upload sessions: uploadId → the lease carrying them. */
const uploadLeases = new Map<string, SessionLease>();

/** A session lease plus its idle-TTL reclamation timer. */
interface SessionLease {
  lease: TransferConnectionLease;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** (Re)arm the idle-TTL timer on a session; called on every session request. */
function touchSession(uploadId: string, session: SessionLease): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    // No commit/abort ever arrived (renderer reload/crash mid-upload):
    // reclaim the socket and pool slot. The daemon sweeps its side of the
    // session independently (ATTACHMENT_UPLOAD_IDLE_TTL).
    if (uploadLeases.get(uploadId) === session) {
      uploadLeases.delete(uploadId);
      logger.warn('Reclaiming idle attachment upload session lease', { uploadId });
      session.lease.release();
    }
  }, SESSION_LEASE_IDLE_TTL_MS);
  session.idleTimer.unref?.();
}

/** Settle a session: stop its idle timer and drop it from the map. */
function settleSession(uploadId: string, session: SessionLease): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  uploadLeases.delete(uploadId);
}

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_TRANSFER_CONNECTIONS) {
    activeCount += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    slotWaiters.push({ resolve, reject });
  });
}

function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) {
    // Hand the slot straight to the next waiter; the in-use count is
    // unchanged (this lease's slot becomes the waiter's slot).
    next.resolve();
    return;
  }
  activeCount -= 1;
}

/**
 * Acquire a dedicated transfer connection (waiting FIFO for a free slot
 * when {@link MAX_TRANSFER_CONNECTIONS} are already open). The returned
 * lease MUST be released when the transfer settles. Prefer
 * {@link withTransferConnection} unless the transfer spans multiple IPC
 * calls (the chunked upload session).
 */
export async function acquireTransferConnection(
  config: BackendConnectionConfig,
): Promise<TransferConnectionLease> {
  const generation = disposeGeneration;
  await acquireSlot();
  if (generation !== disposeGeneration) {
    // A dispose landed while we waited (a settling lease handed us its slot
    // in the same tick the backend was torn down) — do not open a
    // connection against the outgoing backend.
    releaseSlot();
    throw new Error('transfer connections disposed');
  }
  const client = clientFactory(config);
  client.on('error', (error: Error) => {
    logger.warn('Transfer connection transport error', { error: error.message });
  });
  let released = false;
  const lease: TransferConnectionLease = {
    request: (method, params, options) => client.request(method, params, options),
    release: () => {
      if (released) return;
      released = true;
      activeLeases.delete(lease);
      client.dispose();
      releaseSlot();
    },
  };
  activeLeases.add(lease);
  client.start();
  return lease;
}

/**
 * Run one self-contained transfer on its own connection: acquire → run →
 * dispose. The connection is released when `fn` settles, success or
 * failure. This is the reusable primitive for single-shot transfers
 * (attachment `data` placement today, chunked downloads next).
 */
export async function withTransferConnection<T>(
  config: BackendConnectionConfig,
  fn: (connection: TransferConnectionLease) => Promise<T>,
): Promise<T> {
  const lease = await acquireTransferConnection(config);
  try {
    return await fn(lease);
  } finally {
    lease.release();
  }
}

/**
 * The bulk-payload methods that ride a per-transfer connection on remote
 * backends: attachment placement/upload plus the chunked download read
 * (`file.readChunk`, a ~21 MiB base64 frame per chunk). Everything else
 * stays on the main channel.
 */
const TRANSFER_METHODS = new Set([
  'file.placeAttachment',
  'file.attachmentUpload.begin',
  'file.attachmentUpload.chunk',
  'file.attachmentUpload.commit',
  'file.attachmentUpload.abort',
  'file.readChunk',
]);

/** Whether `method` is a bulk-transfer call that should route here. */
export function isTransferMethod(method: string): boolean {
  return TRANSFER_METHODS.has(method);
}

/**
 * Whether a call should ride a per-transfer connection: a bulk-transfer
 * method on a remote transport. The local UDS sidecar keeps the single
 * socket — no uplink to saturate, same-host bandwidth — which is the same
 * condition that picks the remote chunked upload path today.
 */
export function shouldUseTransferConnection(
  method: string,
  config: BackendConnectionConfig,
): boolean {
  return isTransferMethod(method) && config.transport !== 'uds';
}

/**
 * Route one attachment transfer call onto a per-transfer connection.
 *
 * - `file.placeAttachment` (single-shot `data` arm): one connection for the
 *   one call — acquire → request → release.
 * - `file.attachmentUpload.begin`: acquires a connection and pins the whole
 *   session (chunk/commit/abort ride the SAME socket, keyed by the returned
 *   uploadId — one socket per transfer as the simple default).
 * - `file.attachmentUpload.chunk`: rides the session's connection.
 * - `file.attachmentUpload.commit` / `.abort`: ride the session's
 *   connection and settle the session — the connection is released whether
 *   the call succeeds or fails (a failed commit is followed by the
 *   renderer's abort, which then takes the one-shot fallback below).
 *
 * A chunk/commit failure does NOT release mid-session state eagerly beyond
 * the above: the renderer's error path always calls abort (best-effort), so
 * the session's socket is torn down there. An abort/commit for an unknown
 * uploadId (e.g. after a backend switch disposed the session's connection)
 * falls back to a one-shot connection so the daemon-side session is still
 * settled. A session that never settles (renderer reload/crash after begin)
 * is reclaimed by the {@link SESSION_LEASE_IDLE_TTL_MS} idle timer.
 */
export async function requestOverTransferConnection<T = unknown>(
  config: BackendConnectionConfig,
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  const uploadId =
    params && typeof params === 'object' && 'uploadId' in params
      ? String((params as { uploadId: unknown }).uploadId)
      : undefined;

  if (method === 'file.attachmentUpload.begin') {
    const lease = await acquireTransferConnection(config);
    try {
      const result = await lease.request<T>(method, params, options);
      const newUploadId =
        result && typeof result === 'object' && 'uploadId' in result
          ? String((result as { uploadId: unknown }).uploadId)
          : undefined;
      if (newUploadId) {
        const session: SessionLease = { lease, idleTimer: null };
        uploadLeases.set(newUploadId, session);
        touchSession(newUploadId, session);
        return result;
      }
      // No uploadId to key the session on — nothing can ride this socket.
      lease.release();
      return result;
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  if (method === 'file.attachmentUpload.chunk' && uploadId) {
    const session = uploadLeases.get(uploadId);
    if (session) {
      touchSession(uploadId, session);
      return session.lease.request<T>(method, params, options);
    }
    // Session connection is gone (backend switch / shutdown mid-upload):
    // fail the chunk with the same self-contained error surface a dead
    // socket would produce; the renderer aborts and retries the upload.
    throw new Error(`attachment upload session ${uploadId} has no live transfer connection`);
  }

  if (
    (method === 'file.attachmentUpload.commit' || method === 'file.attachmentUpload.abort') &&
    uploadId
  ) {
    const session = uploadLeases.get(uploadId);
    if (session) {
      try {
        return await session.lease.request<T>(method, params, options);
      } finally {
        settleSession(uploadId, session);
        session.lease.release();
      }
    }
    // Unknown session here (already settled, or its connection was disposed
    // by a switch): settle it on the daemon over a one-shot connection —
    // upload sessions are keyed by uploadId, not connection, so this works.
    return withTransferConnection(config, (connection) =>
      connection.request<T>(method, params, options),
    );
  }

  // Single-shot transfers (`file.placeAttachment` data arm).
  return withTransferConnection(config, (connection) =>
    connection.request<T>(method, params, options),
  );
}

/**
 * Dispose every open transfer connection and fail queued waiters — called
 * on backend switch and shutdown (`disposeBackendClient`), where transfers
 * against the outgoing backend can no longer complete.
 */
export function disposeAllTransferConnections(): void {
  // Invalidate waiters already handed a slot (their continuation has not run
  // yet); they fail after waking instead of connecting to the old backend.
  disposeGeneration += 1;
  for (const [uploadId, session] of uploadLeases) {
    settleSession(uploadId, session);
  }
  // Fail queued waiters BEFORE releasing leases: a release hands its slot
  // straight to the next waiter, which would start a transfer against the
  // backend being torn down.
  const waiters = slotWaiters;
  slotWaiters = [];
  for (const waiter of waiters) {
    waiter.reject(new Error('transfer connections disposed'));
  }
  for (const lease of [...activeLeases]) lease.release();
}

/** @internal Test seam: replace how transfer clients are constructed. */
export function __setTransferClientFactoryForTesting(factory: TransferClientFactory | null): void {
  clientFactory = factory ?? defaultClientFactory;
}

/** @internal Test seam: open-connection count (slots in use). */
export function __getActiveTransferCountForTesting(): number {
  return activeCount;
}

/** @internal Test seam: reset all pool state between tests. */
export function __resetTransferConnectionsForTesting(): void {
  disposeAllTransferConnections();
  activeCount = 0;
  slotWaiters = [];
}
