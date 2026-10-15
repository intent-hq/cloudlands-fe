import { m } from '$shared/paraglide/messages.js';
import type { AttachmentInfo } from './backend-attachment-info';
import type {
  AttachmentByteSource,
  AttachmentPlacementApi,
  AttachmentPlacementOptions,
  PlaceAttachmentResult,
} from './attachment-upload-types';

/** PROTOCOL §5.9 caps: single-shot bytes, total bytes, and decoded chunk bytes. */
export const MAX_REMOTE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_REMOTE_ATTACHMENT_TOTAL_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

const UPLOAD_CANCELLED_MESSAGE = 'attachment upload cancelled'; // i18n-ignore (internal sentinel, caller checks signal.aborted — never rendered)
const INVALID_SIZE_MESSAGE = 'Invalid attachment byte size'; // i18n-ignore (internal contract error, filtered from failure detail)
const INVALID_CHUNK_CAP_MESSAGE = 'Invalid attachment upload chunk cap'; // i18n-ignore (internal contract error, filtered from failure detail)

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

export function supportsIdempotentPlacementProtocol(protocolVersion?: string | null): boolean {
  if (!protocolVersion) return false;
  const match = protocolVersion.trim().match(/^([0-9]+)(?:\.([0-9]+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 9 || (major === 9 && minor >= 13);
}

/** A daemon `-32602` rejection (the request was received and refused). */
function isInvalidParamsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { rpcCode, code } = error as { rpcCode?: unknown; code?: unknown };
  return rpcCode === -32602 || code === 'INVALID_PARAMS';
}

/**
 * `file.attachmentUpload.begin` refusing a key already bound to a committed
 * attachment (PROTOCOL §5.9) — the earlier commit's reply was lost;
 * the attachment is recovered through the lookup arm.
 */
export function isAlreadyCommittedError(error: unknown): boolean {
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
 * PROTOCOL §5.9). Resolves `undefined` when the key is unknown (the
 * placement never landed — the original failure stands) or the lookup
 * itself fails.
 */
export async function recoverPlacementByKey(
  workspaceId: string,
  idempotencyKey: string,
  lookup: AttachmentPlacementApi['getAttachmentInfo'],
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

/** Original submission authority must survive every local read and wire step. */
export function assertPlacementCurrent(current: () => boolean): void {
  // i18n-ignore (internal cancellation, never shown for an obsolete form)
  if (!current()) throw new DOMException('Obsolete attachment submission', 'AbortError');
}

/** Check before/after every awaited boundary and before publishing progress/results. */
export function assertUploadActive(options: AttachmentPlacementOptions): void {
  assertPlacementCurrent(options.current ?? (() => true));
  throwIfAborted(options.signal);
}

function assertAttachmentSize(size: number, fileName: string): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(INVALID_SIZE_MESSAGE);
  }
  if (size > MAX_REMOTE_ATTACHMENT_TOTAL_BYTES) {
    throw new Error(m.chat_attachmentPlacement_tooLargeRemote_error({ name: fileName, maxGb: 1 }));
  }
}

async function recoverCurrent(
  api: AttachmentPlacementApi,
  workspaceId: string,
  options: AttachmentPlacementOptions,
): Promise<PlaceAttachmentResult | undefined> {
  assertUploadActive(options);
  const recovered =
    options.idempotencyKey === undefined
      ? undefined
      : await recoverPlacementByKey(workspaceId, options.idempotencyKey, api.getAttachmentInfo);
  assertUploadActive(options);
  return recovered;
}

/** Also used for the source app's local sourcePath arm. */
export async function placeAttachmentWithRecovery(
  api: AttachmentPlacementApi,
  workspaceId: string,
  options: AttachmentPlacementOptions,
  attempt: () => Promise<PlaceAttachmentResult>,
): Promise<PlaceAttachmentResult> {
  assertUploadActive(options);
  try {
    const placed = await attempt();
    assertUploadActive(options);
    return placed;
  } catch (error) {
    assertUploadActive(options);
    if (shouldRecoverPlacement(error, options.idempotencyKey, options.signal)) {
      const recovered = await recoverCurrent(api, workspaceId, options);
      if (recovered) return recovered;
    }
    throw error;
  }
}

/** One upload/recovery owner for browser blobs, inline images and host-local files. */
export async function placeAttachmentBytes(
  api: AttachmentPlacementApi,
  workspaceId: string,
  fileName: string,
  source: AttachmentByteSource,
  options: AttachmentPlacementOptions = {},
): Promise<PlaceAttachmentResult> {
  assertUploadActive(options);
  const size = source.size;
  assertAttachmentSize(size, fileName);
  const keyed =
    options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {};
  if (size <= MAX_REMOTE_ATTACHMENT_BYTES) {
    const data = await source.readBase64(0, size);
    assertUploadActive(options);
    return placeAttachmentWithRecovery(api, workspaceId, options, () =>
      api.placeAttachment(workspaceId, fileName, { data, mimeType: options.mimeType, ...keyed }),
    );
  }
  const sha256 = await source.sha256();
  assertUploadActive(options);
  let uploadId: string;
  let maxChunkBytes: number;
  try {
    ({ uploadId, maxChunkBytes } = await api.beginAttachmentUpload(
      workspaceId,
      fileName,
      size,
      sha256,
      { mimeType: options.mimeType, ...keyed },
    ));
  } catch (error) {
    assertUploadActive(options);
    if (options.idempotencyKey !== undefined && isAlreadyCommittedError(error)) {
      const recovered = await recoverCurrent(api, workspaceId, options);
      if (recovered) return recovered;
    }
    throw error;
  }
  let committing = false;
  try {
    assertUploadActive(options);
    // A malformed cap is a contract failure, never an infinite/empty upload loop.
    if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes <= 0) {
      throw new Error(INVALID_CHUNK_CAP_MESSAGE);
    }
    const chunkBytes = Math.min(UPLOAD_CHUNK_BYTES, maxChunkBytes);
    const totalChunks = Math.ceil(size / chunkBytes);
    for (let seq = 0; seq < totalChunks; seq++) {
      assertUploadActive(options);
      const data = await source.readBase64(seq * chunkBytes, chunkBytes);
      assertUploadActive(options);
      await api.sendAttachmentUploadChunk(uploadId, seq, data, workspaceId);
      assertUploadActive(options);
      options.onProgress?.((seq + 1) / totalChunks);
    }
    assertUploadActive(options);
    committing = true;
    const placed = await api.commitAttachmentUpload(uploadId, workspaceId);
    assertUploadActive(options);
    return placed;
  } catch (error) {
    let recoveredCommit = false;
    try {
      assertUploadActive(options);
      if (committing && shouldRecoverPlacement(error, options.idempotencyKey, options.signal)) {
        const recovered = await recoverCurrent(api, workspaceId, options);
        if (recovered) {
          recoveredCommit = true;
          return recovered;
        }
      }
      throw error;
    } finally {
      // A cancelled selection still owns cleanup. A retired transport/principal
      // does not: never route cleanup through its replacement connection.
      if (!recoveredCommit && options.current?.() !== false) {
        await api.abortAttachmentUpload(uploadId, workspaceId).catch(() => {
          // Best effort; the daemon sweeps orphaned sessions.
        });
      }
    }
  }
}

/** Encode bytes without the argument-spread stack cap. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

export function base64DecodedBytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** No reads/allocation until the placement owner checks the total cap. */
export function blobAttachmentSource(
  blob: Blob,
  options: AttachmentPlacementOptions = {},
): AttachmentByteSource {
  const read = async (offset: number, length: number) => {
    assertUploadActive(options);
    const bytes = await blob.slice(offset, offset + length).arrayBuffer();
    assertUploadActive(options);
    return bytes;
  };
  return {
    size: blob.size,
    async readBase64(offset, length) {
      return bytesToBase64(new Uint8Array(await read(offset, length)));
    },
    // WebCrypto requires one bounded buffer; never encode that full buffer as base64.
    async sha256() {
      return sha256Hex(await read(0, blob.size));
    },
  };
}

/** Lazy decoding keeps the total cap check ahead of allocations for inline images. */
export function base64AttachmentSource(data: string): AttachmentByteSource {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  const decoded = () => {
    if (!bytes) {
      const binary = atob(data);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };
  const size = base64DecodedBytes(data);
  return {
    size,
    async readBase64(offset, length) {
      return offset === 0 && length === size
        ? data
        : bytesToBase64(decoded().subarray(offset, offset + length));
    },
    async sha256() {
      return sha256Hex(decoded().buffer);
    },
  };
}

/**
 * Messages too generic to render as the user-visible failure reason: the
 * daemon's bare `-32603` message, the electron-ipc-transport fallback for a
 * payload-less IPC failure, and this module's own `file:read` envelope
 * fallbacks. Filtering them keeps the tooltip/toast detail daemon-reasons
 * (or informative IPC reasons) only, so untranslated fallbacks never render.
 */
const GENERIC_PLACEMENT_MESSAGES = new Set([
  INVALID_SIZE_MESSAGE,
  INVALID_CHUNK_CAP_MESSAGE,
  'Internal error', // i18n-ignore (verbatim daemon -32603 message, filtered)
  'Backend request failed', // i18n-ignore (verbatim electron-ipc-transport fallback, filtered)
  'file:read returned an unexpected response', // i18n-ignore (internal fallback)
  'file:read failed', // i18n-ignore (internal fallback)
]);

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
