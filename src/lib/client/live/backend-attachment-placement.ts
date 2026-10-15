import type { BackendTransport } from './backend-transport-types';
import { createAttachmentInfoRead } from './backend-attachment-info';
import { blobAttachmentSource, placeAttachmentBytes } from './attachment-upload';
import type {
  AttachmentByteSource,
  AttachmentPlacementOptions,
  PlaceAttachmentResult,
  BeginAttachmentUploadResult,
} from './attachment-upload-types';

/** Canonical attachment requests, with the caller supplying its captured transport. */
export function createBackendAttachmentPlacement(request: BackendTransport['request']) {
  /**
   * Place a chat attachment into the workspace's `.intent/attachments/`
   * directory via the daemon (`file.placeAttachment`, PROTOCOL §5.9).
   * Exactly one of `data` (base64, `data:` URL prefix tolerated) or
   * `sourcePath` (absolute host-local path the daemon copies directly) must be
   * provided; optional `mimeType` is recorded in the attachment registry.
   * Optional `idempotencyKey` makes a same-key retry replay the bound
   * placement instead of placing a duplicate — only send it to daemons that
   * accept keyed placement. Errors propagate to the caller.
   */
  async function placeAttachment(
    workspaceId: string,
    fileName: string,
    source: { data?: string; sourcePath?: string; mimeType?: string; idempotencyKey?: string },
  ): Promise<PlaceAttachmentResult> {
    return await request<PlaceAttachmentResult>('file.placeAttachment', {
      workspaceId,
      fileName,
      ...(source.data !== undefined ? { data: source.data } : {}),
      ...(source.sourcePath !== undefined ? { sourcePath: source.sourcePath } : {}),
      ...(source.mimeType !== undefined && source.mimeType !== ''
        ? { mimeType: source.mimeType }
        : {}),
      ...(source.idempotencyKey !== undefined ? { idempotencyKey: source.idempotencyKey } : {}),
    });
  }

  /**
   * Open a staged chunked attachment upload session on the daemon
   * (`file.attachmentUpload.begin`, PROTOCOL §5.9). The daemon verifies
   * the assembled payload against `sha256` (lowercase hex) at commit. Optional
   * `idempotencyKey` binds the committed attachment to the key so a
   * lost commit reply is recoverable via `getAttachmentInfo`; a key already
   * bound to a committed attachment rejects begin with -32602 ("already
   * committed"). Errors propagate to the caller.
   */
  async function beginAttachmentUpload(
    workspaceId: string,
    fileName: string,
    sizeBytes: number,
    sha256: string,
    options: { mimeType?: string; idempotencyKey?: string } = {},
  ): Promise<BeginAttachmentUploadResult> {
    return await request<BeginAttachmentUploadResult>('file.attachmentUpload.begin', {
      workspaceId,
      fileName,
      sizeBytes,
      sha256,
      ...(options.mimeType !== undefined && options.mimeType !== ''
        ? { mimeType: options.mimeType }
        : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
    });
  }

  /**
   * Per-call timeout for chunk sends and commit. A 16 MiB chunk is ~21.3 MiB
   * of base64 on the wire, which blows the transport's flat 30s default on
   * connections below ~6 Mbit/s; 5 minutes tolerates ~0.6 Mbit/s. Commit gets
   * the same bound: the daemon assembles and SHA-256-verifies up to 1 GiB
   * before replying.
   */
  const UPLOAD_TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;

  /**
   * Stage one seq-numbered base64 slice of a chunked upload
   * (`file.attachmentUpload.chunk`, PROTOCOL §5.9). Retrying a seq is
   * idempotent on the daemon side.
   */
  async function sendAttachmentUploadChunk(
    uploadId: string,
    seq: number,
    data: string,
    workspaceId?: string,
  ): Promise<{ uploadId: string; seq: number; receivedBytes: number }> {
    return await request(
      'file.attachmentUpload.chunk',
      { uploadId, seq, data, ...(workspaceId !== undefined ? { workspaceId } : {}) },
      { timeoutMs: UPLOAD_TRANSFER_TIMEOUT_MS },
    );
  }

  /**
   * Verify and place a completed chunked upload
   * (`file.attachmentUpload.commit`, PROTOCOL §5.9). The result is
   * byte-shape-identical to a successful `file.placeAttachment`.
   */
  async function commitAttachmentUpload(
    uploadId: string,
    workspaceId?: string,
  ): Promise<PlaceAttachmentResult> {
    return await request<PlaceAttachmentResult>(
      'file.attachmentUpload.commit',
      { uploadId, ...(workspaceId !== undefined ? { workspaceId } : {}) },
      { timeoutMs: UPLOAD_TRANSFER_TIMEOUT_MS },
    );
  }

  /**
   * Drop a staged chunked upload session and its staging directory
   * (`file.attachmentUpload.abort`, PROTOCOL §5.9). Idempotent.
   */
  async function abortAttachmentUpload(
    uploadId: string,
    workspaceId?: string,
  ): Promise<{ uploadId: string; aborted: boolean }> {
    return await request('file.attachmentUpload.abort', {
      uploadId,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    });
  }

  const api = {
    placeAttachment,
    beginAttachmentUpload,
    sendAttachmentUploadChunk,
    commitAttachmentUpload,
    abortAttachmentUpload,
    getAttachmentInfo: createAttachmentInfoRead(request),
  };
  return {
    ...api,
    place(
      workspaceId: string,
      fileName: string,
      source: Blob | AttachmentByteSource,
      options: AttachmentPlacementOptions = {},
    ): Promise<PlaceAttachmentResult> {
      const bytes = 'readBase64' in source ? source : blobAttachmentSource(source, options);
      return placeAttachmentBytes(api, workspaceId, fileName, bytes, options);
    },
  };
}
