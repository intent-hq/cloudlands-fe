import type { AttachmentInfo, AttachmentInfoSelector } from './backend-attachment-info';

/** Result of file.placeAttachment and file.attachmentUpload.commit (PROTOCOL §5.9). */
export interface PlaceAttachmentResult {
  ok: boolean;
  /** Workspace-relative path under `.intent/attachments/`. */
  path: string;
  /** The collision-safe file name the daemon actually chose. */
  fileName: string;
  /** Placed byte length. */
  size: number;
  /** UUID key of the attachment registry row. */
  attachmentId: string;
  /** MIME type recorded in the registry (when the caller supplied one). */
  mimeType?: string;
  /** ISO timestamp of the registry row. */
  uploadedAt: string;
  /**
   * Presence-detected (keyed placement): the keyed call replayed an earlier placement
   * bound to the same `idempotencyKey` and placed nothing. Absent on a first
   * placement or an unkeyed call.
   */
  replayed?: boolean;
}

export interface BeginAttachmentUploadResult {
  uploadId: string;
  /** Daemon's decoded-bytes-per-chunk cap (16 MiB). */
  maxChunkBytes: number;
  /**
   * Presence-detected (keyed begin): a same-key begin re-answered a still-live
   * session's `uploadId` (a lost begin reply) instead of opening a second one.
   */
  replayed?: boolean;
}

export interface AttachmentPlacementApi {
  placeAttachment(
    workspaceId: string,
    fileName: string,
    source: {
      data?: string;
      sourcePath?: string;
      mimeType?: string;
      idempotencyKey?: string;
    },
  ): Promise<PlaceAttachmentResult>;
  beginAttachmentUpload(
    workspaceId: string,
    fileName: string,
    sizeBytes: number,
    sha256: string,
    options?: { mimeType?: string; idempotencyKey?: string },
  ): Promise<BeginAttachmentUploadResult>;
  sendAttachmentUploadChunk(
    uploadId: string,
    seq: number,
    data: string,
    workspaceId?: string,
  ): Promise<{ uploadId: string; seq: number; receivedBytes: number }>;
  commitAttachmentUpload(uploadId: string, workspaceId?: string): Promise<PlaceAttachmentResult>;
  abortAttachmentUpload(
    uploadId: string,
    workspaceId?: string,
  ): Promise<{ uploadId: string; aborted: boolean }>;
  getAttachmentInfo(selector: AttachmentInfoSelector): Promise<AttachmentInfo>;
}

export type UploadProgressCallback = (fraction: number) => void;

export interface AttachmentPlacementOptions {
  mimeType?: string;
  /** Caller retains the key across retries and gates it on daemon support. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Captured principal/backend/workspace authority; false forbids further requests/publication. */
  current?: () => boolean;
  onProgress?: UploadProgressCallback;
}

/** Reads must be bounded to length (or EOF), and hash the same immutable content. */
export interface AttachmentByteSource {
  size: number;
  readBase64(offset: number, length: number): Promise<string>;
  sha256(): Promise<string>;
}
