/**
 * Transport-aware attachment placement (`file.placeAttachment` +
 * `file.attachmentUpload.*`, PROTOCOL §5.9). The daemon's `sourcePath` arm
 * copies from a path on the DAEMON's host, so it only works when the FE and
 * daemon share a machine (local UDS sidecar). Against a remote backend the
 * FE reads the file bytes off its own disk and sends them over the wire
 * instead — single-shot `data` arm up to 25 MB (the 2.27.0
 * remote-attachment regression, monorepo#2144), and the staged chunked
 * upload session (`file.attachmentUpload.begin` → sequential `chunk`s → `commit`) above
 * that, up to the daemon's 1 GiB attachment cap.
 *
 * Idempotent placement (`idempotencyKey`, intent-hq/intent#4691): callers mint one
 * `idempotencyKey` per attachment and reuse it across retries. A lost reply
 * (transport failure after the daemon placed the file) is recovered here by
 * looking the key up via `file.getAttachmentInfo` before the failure is
 * surfaced; a same-key retry against the daemon replays the bound placement
 * instead of placing a collision-suffixed duplicate.
 */
import { invoke } from '$lib/electron-bridge';
import { store as appStore } from '$store/renderer/store';
import { selectIsDaemonLocal } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import {
  abortAttachmentUpload,
  beginAttachmentUpload,
  commitAttachmentUpload,
  getAttachmentInfo,
  placeAttachment,
  sendAttachmentUploadChunk,
  type PlaceAttachmentResult,
} from './context-api';

import {
  assertUploadActive,
  MAX_REMOTE_ATTACHMENT_BYTES,
  placeAttachmentBytes,
  placeAttachmentWithRecovery,
  recoverPlacementByKey as recoverByKey,
  supportsIdempotentPlacementProtocol,
} from '$lib/client/live/attachment-upload';
import type { UploadProgressCallback } from '$lib/client/live/attachment-upload-types';

// Compatibility exports for the source input and its tests. Remove once those
// consumers import the shared upload owner directly; locality remains source-owned.
export {
  assertPlacementCurrent,
  isPlacementCancellation,
  isAlreadyCommittedError,
  MAX_REMOTE_ATTACHMENT_BYTES,
  MAX_REMOTE_ATTACHMENT_TOTAL_BYTES,
  UPLOAD_CHUNK_BYTES,
  shouldRecoverPlacement,
  supportsIdempotentPlacementProtocol,
} from '$lib/client/live/attachment-upload';
export type { UploadProgressCallback } from '$lib/client/live/attachment-upload-types';

const placementApi = {
  placeAttachment,
  beginAttachmentUpload,
  sendAttachmentUploadChunk,
  commitAttachmentUpload,
  abortAttachmentUpload,
  getAttachmentInfo,
};

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

/** Whether the daemon connected right now accepts keyed placement. */
function daemonSupportsIdempotentPlacement(): boolean {
  return supportsIdempotentPlacementProtocol(appStore.state?.daemonHealth?.stats?.protocolVersion);
}

/**
 * Resolve the placement `idempotencyKey` for an attempt: `existing` (the key
 * retained on the item from an earlier attempt) when the connected daemon
 * supports keyed placement, a fresh UUID when there is none yet, and
 * `undefined` (unkeyed placement, no `idempotencyKey`) when it does not — a
 * key retained across a reconnect to an older daemon is dropped rather than
 * sent.
 * Callers keep the result on the attachment item so every retry reuses it.
 */
export function mintPlacementIdempotencyKey(existing?: string): string | undefined {
  if (!daemonSupportsIdempotentPlacement()) return undefined;
  return existing ?? crypto.randomUUID();
}

/** Source compatibility for the default lookup; remove when callers inject their API. */
export function recoverPlacementByKey(
  workspaceId: string,
  idempotencyKey: string,
  lookup: typeof getAttachmentInfo = getAttachmentInfo,
): Promise<PlaceAttachmentResult | undefined> {
  return recoverByKey(workspaceId, idempotencyKey, lookup);
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
 * `source.idempotencyKey` (keyed placement; callers mint it via
 * `mintPlacementIdempotencyKey` and reuse it on retry) a lost reply is
 * recovered through `file.getAttachmentInfo` before the failure surfaces;
 * the key is checked against the daemon connected NOW, so one retained
 * across a reconnect to a daemon without keyed placement is dropped, not
 * sent. Errors propagate — use `extractPlacementErrorDetail` to surface the
 * daemon's reason.
 */
export async function placeAttachmentViaTransport(
  workspaceId: string,
  fileName: string,
  source: { sourcePath: string; mimeType?: string; idempotencyKey?: string },
  onProgress?: UploadProgressCallback,
  signal?: AbortSignal,
  current: () => boolean = () => true,
): Promise<PlaceAttachmentResult> {
  const options = {
    mimeType: source.mimeType,
    idempotencyKey: daemonSupportsIdempotentPlacement() ? source.idempotencyKey : undefined,
    onProgress,
    signal,
    current,
  };
  assertUploadActive(options);
  if (!isRemoteBackend()) {
    return placeAttachmentWithRecovery(placementApi, workspaceId, options, () =>
      placeAttachment(workspaceId, fileName, {
        sourcePath: source.sourcePath,
        mimeType: source.mimeType,
        ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      }),
    );
  }
  const size = await statFileSize(source.sourcePath);
  assertUploadActive(options);
  return placeAttachmentBytes(
    placementApi,
    workspaceId,
    fileName,
    {
      size,
      sha256: () => hashFileSha256(source.sourcePath),
      readBase64: async (offset, length) =>
        size <= MAX_REMOTE_ATTACHMENT_BYTES
          ? readFileBase64(source.sourcePath)
          : (await readFileChunkBase64(source.sourcePath, offset, length)).content,
    },
    options,
  );
}

// Source callers retain this error-formatting import until the input facade retires.
export { extractPlacementErrorDetail } from '$lib/client/live/attachment-upload';
