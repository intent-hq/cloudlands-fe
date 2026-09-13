/**
 * Transport-aware attachment placement (`file.placeAttachment` +
 * `file.attachmentUpload.*`, PROTOCOL §5.9). The daemon's `sourcePath` arm
 * copies from a path on the DAEMON's host, so it only works when the FE and
 * daemon share a machine (local UDS sidecar). Against a remote backend the
 * FE reads the file bytes off its own disk and sends them over the wire
 * instead — single-shot `data` arm up to 25 MB (the 2.27.0
 * remote-attachment regression, monorepo#2144), and the staged chunked
 * upload session (`begin` → sequential `chunk`s → `commit`, v6.16) above
 * that, up to the daemon's 1 GiB attachment cap.
 *
 * Idempotent placement (v9.13, intent-hq/intent#4691): callers mint one
 * `idempotencyKey` per attachment and reuse it across retries. A lost reply
 * (transport failure after the daemon placed the file) is recovered here by
 * looking the key up via `file.getAttachmentInfo` before the failure is
 * surfaced; a same-key retry against the daemon replays the bound placement
 * instead of placing a collision-suffixed duplicate.
 */
import { invoke } from '$lib/electron-bridge';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { selectIsDaemonLocal } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import {
  abortAttachmentUpload,
  beginAttachmentUpload,
  commitAttachmentUpload,
  getAttachmentInfo,
  placeAttachment,
  sendAttachmentUploadChunk,
  type AttachmentInfo,
  type PlaceAttachmentResult,
} from './context-api';

/**
 * Byte cap for the remote single-shot `data` arm. Base64 inflates by 4/3
 * and the serialized JSON-RPC frame is capped at 40 MiB (PROTOCOL §1.3), so
 * raw bytes must stay well under that; 25 MB matches the daemon's
 * serialized `attachments` payload cap precedent. Larger files go through
 * the chunked upload session instead.
 */
export const MAX_REMOTE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * The daemon's per-attachment byte cap (`file.attachmentUpload.begin`
 * rejects declared sizes above 1 GiB, PROTOCOL §5.9) — the effective remote
 * attachment limit now that oversized files go through the chunked session.
 */
export const MAX_REMOTE_ATTACHMENT_TOTAL_BYTES = 1024 * 1024 * 1024;

/**
 * Raw bytes per upload chunk — matches the daemon's 16 MiB decoded-slice
 * cap (`maxChunkBytes` from `begin`; the effective size is min of both).
 */
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

/**
 * Fraction of chunks acknowledged by the daemon, for the uploading pill's
 * percent progress. Only the chunked (>25MB) path reports progress.
 */
export type UploadProgressCallback = (fraction: number) => void;

const UPLOAD_CANCELLED_MESSAGE = 'attachment upload cancelled'; // i18n-ignore (internal sentinel, caller checks signal.aborted — never rendered)

/**
 * True when a placement failure is the caller's own cancellation (the
 * `signal` passed to `placeAttachmentViaTransport` was aborted), so callers
 * can skip failure UI for uploads the user deliberately discarded.
 */
export function isPlacementCancellation(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.message === UPLOAD_CANCELLED_MESSAGE)
  );
}

/** Throw the cancellation sentinel when the caller aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(UPLOAD_CANCELLED_MESSAGE);
}

/**
 * True when the daemon host is NOT the user's machine, i.e. `sourcePath`
 * placement cannot work because the daemon has no access to the FE host's
 * filesystem. Uses the daemon-reported locality (transport heuristic before
 * the first status poll) — same signal that gates other host-local
 * affordances like reveal-in-file-manager.
 */
export function isRemoteBackend(): boolean {
  return !selectIsDaemonLocal.select(appStore.state);
}

/**
 * True when the daemon accepts `idempotencyKey` on `file.placeAttachment` /
 * `file.attachmentUpload.begin` and the key arm of `file.getAttachmentInfo`
 * (PROTOCOL §5.9, v9.13). Older daemons reject unknown params, so the key
 * is never sent to them.
 */
export function supportsIdempotentPlacementProtocol(protocolVersion?: string | null): boolean {
  if (!protocolVersion) return false;
  const match = protocolVersion.trim().match(/^([0-9]+)(?:\.([0-9]+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 9 || (major === 9 && minor >= 13);
}

/**
 * Mint a fresh placement `idempotencyKey` (a UUID) when the connected daemon
 * supports keyed placement, else `undefined` (unkeyed, pre-9.13 behavior).
 * Callers keep the key on the attachment item so every retry reuses it.
 */
export function mintPlacementIdempotencyKey(): string | undefined {
  const protocolVersion = appStore.state?.daemonHealth?.stats?.protocolVersion;
  return supportsIdempotentPlacementProtocol(protocolVersion) ? crypto.randomUUID() : undefined;
}

/** A daemon `-32602` rejection (the request was received and refused). */
function isInvalidParamsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { rpcCode, code } = error as { rpcCode?: unknown; code?: unknown };
  return rpcCode === -32602 || code === 'INVALID_PARAMS';
}

/**
 * `file.attachmentUpload.begin` refusing a key already bound to a committed
 * attachment (PROTOCOL §5.9, v9.13) — the earlier commit's reply was lost;
 * the attachment is recovered through the lookup arm.
 */
function isAlreadyCommittedError(error: unknown): boolean {
  return (
    isInvalidParamsError(error) &&
    /already committed/i.test(String((error as { message?: unknown }).message ?? ''))
  );
}

/** Rebuild a `placeAttachment`-shaped result from the registry row a key resolves to. */
function attachmentInfoToPlacementResult(info: AttachmentInfo): PlaceAttachmentResult {
  return {
    ok: true,
    path: info.path,
    fileName: info.fileName,
    size: info.size,
    attachmentId: info.attachmentId,
    ...(info.mimeType !== undefined ? { mimeType: info.mimeType } : {}),
    uploadedAt: info.uploadedAt,
    replayed: true,
  };
}

/**
 * Lost-reply recovery: resolve the attachment a placement `idempotencyKey`
 * is bound to (`file.getAttachmentInfo { workspaceId, idempotencyKey }`,
 * PROTOCOL §5.9, v9.13). Resolves `undefined` when the key is unknown (the
 * placement never landed — the original failure stands) or the lookup
 * itself fails.
 */
export async function recoverPlacementByKey(
  workspaceId: string,
  idempotencyKey: string,
  lookup: typeof getAttachmentInfo = getAttachmentInfo,
): Promise<PlaceAttachmentResult | undefined> {
  try {
    return attachmentInfoToPlacementResult(await lookup({ workspaceId, idempotencyKey }));
  } catch {
    return undefined;
  }
}

/**
 * Whether a failed placement is worth a key lookup: the request was keyed,
 * the failure is not a daemon `-32602` refusal (nothing was placed) and not
 * the caller's own cancellation.
 */
export function shouldRecoverPlacement(
  error: unknown,
  idempotencyKey: string | undefined,
  signal?: AbortSignal,
): idempotencyKey is string {
  return (
    idempotencyKey !== undefined &&
    !isInvalidParamsError(error) &&
    !isPlacementCancellation(error, signal)
  );
}

/**
 * Run one placement attempt; on a transport-loss class failure of a keyed
 * attempt, recover the committed attachment through the key lookup before
 * surfacing the failure.
 */
async function placeWithRecovery(
  workspaceId: string,
  idempotencyKey: string | undefined,
  signal: AbortSignal | undefined,
  attempt: () => Promise<PlaceAttachmentResult>,
): Promise<PlaceAttachmentResult> {
  try {
    return await attempt();
  } catch (error) {
    if (shouldRecoverPlacement(error, idempotencyKey, signal)) {
      const recovered = await recoverPlacementByKey(workspaceId, idempotencyKey);
      if (recovered) return recovered;
    }
    throw error;
  }
}

/** Main-process `file:read` response envelope (see `file.ipc.ts`). */
interface FileReadIpcResult {
  success: boolean;
  data?: { content: string; truncated?: boolean };
  error?: { code: string; message: string };
}

/** Main-process `file:read-chunk` / `file:hash` response envelopes. */
interface FileReadChunkIpcResult {
  success: boolean;
  data?: { content: string; bytesRead: number; size: number };
  error?: { code: string; message: string };
}
interface FileHashIpcResult {
  success: boolean;
  data?: { sha256: string; size: number };
  error?: { code: string; message: string };
}

const UNEXPECTED_READ_RESPONSE_MESSAGE = 'file:read returned an unexpected response'; // i18n-ignore (internal error, filtered from detail — surfaced via generic toast)
const READ_FAILED_MESSAGE = 'file:read failed'; // i18n-ignore (fallback for missing IPC error message, filtered from detail)

/** Unwrap a `{ success, data, error }` file-IPC envelope or throw. */
function unwrapFileIpc<T extends { success: boolean; data?: unknown; error?: { message: string } }>(
  result: T,
): NonNullable<T['data']> {
  if (!result || typeof result !== 'object' || !('success' in result)) {
    throw new Error(UNEXPECTED_READ_RESPONSE_MESSAGE);
  }
  if (!result.success || result.data === undefined) {
    throw new Error(result.error?.message ?? READ_FAILED_MESSAGE);
  }
  return result.data as NonNullable<T['data']>;
}

/** Read a host-local file as base64 via the main-process `file:read` IPC. */
async function readFileBase64(path: string): Promise<string> {
  const result = await invoke<FileReadIpcResult>('file:read', {
    path,
    encoding: 'base64',
    maxSize: MAX_REMOTE_ATTACHMENT_BYTES,
    truncateIfLarge: false,
  });
  const data = unwrapFileIpc(result);
  if (data.content === undefined) {
    throw new Error(result.error?.message ?? READ_FAILED_MESSAGE);
  }
  return data.content;
}

/** Read one bounded base64 slice via the main-process `file:read-chunk` IPC. */
async function readFileChunkBase64(
  path: string,
  offset: number,
  length: number,
): Promise<{ content: string; bytesRead: number; size: number }> {
  const result = await invoke<FileReadChunkIpcResult>('file:read-chunk', { path, offset, length });
  return unwrapFileIpc(result);
}

/** Probe a host-local file's byte size (1-byte `file:read-chunk` read). */
async function statFileSize(path: string): Promise<number> {
  const { size } = await readFileChunkBase64(path, 0, 1);
  return size;
}

/** Streaming SHA-256 (lowercase hex) via the main-process `file:hash` IPC. */
async function hashFileSha256(path: string): Promise<string> {
  const result = await invoke<FileHashIpcResult>('file:hash', { path });
  return unwrapFileIpc(result).sha256;
}

/**
 * Messages too generic to render as the user-visible failure reason: the
 * daemon's bare `-32603` message, the electron-ipc-transport fallback for a
 * payload-less IPC failure, and this module's own `file:read` envelope
 * fallbacks. Filtering them keeps the tooltip/toast detail daemon-reasons
 * (or informative IPC reasons) only, so untranslated fallbacks never render.
 */
const GENERIC_PLACEMENT_MESSAGES = new Set([
  'Internal error', // i18n-ignore (verbatim daemon -32603 message, filtered)
  'Backend request failed', // i18n-ignore (verbatim electron-ipc-transport fallback, filtered)
  UNEXPECTED_READ_RESPONSE_MESSAGE,
  READ_FAILED_MESSAGE,
]);

/**
 * Place an attachment picking the arm by backend locality: `sourcePath`
 * (daemon copies directly, no bytes on the wire) against the local sidecar,
 * bytes read off the FE host against a remote backend — the single-shot
 * `data` arm up to 25 MB, the chunked `file.attachmentUpload.*` session
 * above that (up to the daemon's 1 GiB cap). Signature matches
 * `placeAttachment` minus the `data` field so call sites and their retry
 * paths swap in without change; `onProgress` (optional) receives the
 * chunk-acknowledged fraction during a chunked upload only; `signal`
 * (optional) cancels between chunks — the staged session is aborted on the
 * daemon and the rejection satisfies `isPlacementCancellation`. With
 * `source.idempotencyKey` (v9.13; callers mint it via
 * `mintPlacementIdempotencyKey` and reuse it on retry) a lost reply is
 * recovered through `file.getAttachmentInfo` before the failure surfaces.
 * Errors propagate — use `extractPlacementErrorDetail` to surface the
 * daemon's reason.
 */
export async function placeAttachmentViaTransport(
  workspaceId: string,
  fileName: string,
  source: { sourcePath: string; mimeType?: string; idempotencyKey?: string },
  onProgress?: UploadProgressCallback,
  signal?: AbortSignal,
): Promise<PlaceAttachmentResult> {
  const keyed =
    source.idempotencyKey !== undefined ? { idempotencyKey: source.idempotencyKey } : {};
  if (!isRemoteBackend()) {
    return placeWithRecovery(workspaceId, source.idempotencyKey, signal, () =>
      placeAttachment(workspaceId, fileName, {
        sourcePath: source.sourcePath,
        mimeType: source.mimeType,
        ...keyed,
      }),
    );
  }
  const size = await statFileSize(source.sourcePath);
  if (size > MAX_REMOTE_ATTACHMENT_TOTAL_BYTES) {
    throw new Error(
      m.chat_attachmentPlacement_tooLargeRemote_error({
        name: fileName,
        maxGb: Math.round(MAX_REMOTE_ATTACHMENT_TOTAL_BYTES / (1024 * 1024 * 1024)),
      }),
    );
  }
  if (size > MAX_REMOTE_ATTACHMENT_BYTES) {
    return placeAttachmentChunked(workspaceId, fileName, source, size, onProgress, signal);
  }
  const data = await readFileBase64(source.sourcePath);
  throwIfAborted(signal);
  return placeWithRecovery(workspaceId, source.idempotencyKey, signal, () =>
    placeAttachment(workspaceId, fileName, { data, mimeType: source.mimeType, ...keyed }),
  );
}

/**
 * Chunked remote placement: `begin` (declares size + FE-computed SHA-256),
 * sequential 16 MiB `chunk` reads/sends, then `commit` (daemon verifies the
 * checksum and places through the `placeAttachment` path). Any failure
 * after `begin` aborts the session (best-effort — abort is idempotent and
 * the daemon sweeps orphans) and rethrows; retry re-runs the whole flow.
 * Keyed (v9.13): a begin refused because the key is "already committed"
 * (an earlier commit whose reply was lost) and a commit whose own reply is
 * lost both resolve through the key lookup instead of failing.
 */
async function placeAttachmentChunked(
  workspaceId: string,
  fileName: string,
  source: { sourcePath: string; mimeType?: string; idempotencyKey?: string },
  size: number,
  onProgress?: UploadProgressCallback,
  signal?: AbortSignal,
): Promise<PlaceAttachmentResult> {
  const sha256 = await hashFileSha256(source.sourcePath);
  throwIfAborted(signal);
  let uploadId: string;
  let maxChunkBytes: number;
  try {
    ({ uploadId, maxChunkBytes } = await beginAttachmentUpload(
      workspaceId,
      fileName,
      size,
      sha256,
      {
        mimeType: source.mimeType,
        ...(source.idempotencyKey !== undefined ? { idempotencyKey: source.idempotencyKey } : {}),
      },
    ));
  } catch (error) {
    if (source.idempotencyKey !== undefined && isAlreadyCommittedError(error)) {
      const recovered = await recoverPlacementByKey(workspaceId, source.idempotencyKey);
      if (recovered) return recovered;
    }
    throw error;
  }
  const chunkBytes = Math.min(UPLOAD_CHUNK_BYTES, maxChunkBytes);
  const totalChunks = Math.ceil(size / chunkBytes);
  let committing = false;
  try {
    for (let seq = 0; seq < totalChunks; seq++) {
      throwIfAborted(signal);
      const { content } = await readFileChunkBase64(
        source.sourcePath,
        seq * chunkBytes,
        chunkBytes,
      );
      await sendAttachmentUploadChunk(uploadId, seq, content);
      onProgress?.((seq + 1) / totalChunks);
    }
    throwIfAborted(signal);
    committing = true;
    return await commitAttachmentUpload(uploadId);
  } catch (error) {
    // Only a commit can have placed the file before its reply was lost; a
    // failed chunk never binds the key, so no lookup is attempted for it.
    if (committing && shouldRecoverPlacement(error, source.idempotencyKey, signal)) {
      const recovered = await recoverPlacementByKey(workspaceId, source.idempotencyKey);
      if (recovered) return recovered;
    }
    await abortAttachmentUpload(uploadId).catch(() => {
      // Best-effort: the daemon sweeps orphaned sessions on the next begin.
    });
    throw error;
  }
}

/**
 * Extract a human-readable failure reason from a placement error for the
 * failed pill tooltip / toast. Prefers the daemon's structured
 * `error.data.detail` (the transport maps a plain-string JSON-RPC `data`
 * there), then a non-generic error message (`-32602` messages carry the
 * classified reason, e.g. "sourcePath is a directory"); returns undefined
 * for generic transport/daemon fallbacks so callers keep the localized
 * generic copy.
 */
export function extractPlacementErrorDetail(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim().length > 0) return detail.trim();
  }
  const message = (error as { message?: unknown }).message;
  if (
    typeof message === 'string' &&
    message.trim().length > 0 &&
    !GENERIC_PLACEMENT_MESSAGES.has(message.trim())
  ) {
    return message.trim();
  }
  return undefined;
}
