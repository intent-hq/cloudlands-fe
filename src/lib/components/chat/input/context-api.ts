/**
 * Context API for rich input features
 * Provides daemon-backed reads for file search, symbols, and editor integration
 */

import { invoke } from '$lib/electron-bridge';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ContextAPI');

export interface FileSearchResult {
  name: string;
  path: string;
  relativePath: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
}

// Import and re-export Note type from shared types to avoid duplication

/**
 * Context item used in rich input for attaching files, notes, selections, etc.
 */
export interface ContextItem {
  id: string;
  type: 'file' | 'note' | 'selection' | 'workspace' | 'memory' | 'personality' | 'folder';
  label: string;
  description?: string;
  content?: string;
  path?: string; // For file items
  metadata?: Record<string, any>; // For additional data
  file?: File; // For uploaded/pasted files (images, etc.)
  // For base64 image data (e.g., from loaded messages)
  imageData?: string; // Base64 encoded image data
  imageMimeType?: string; // MIME type of the image
  // For base64 file data (e.g., from loaded messages)
  fileData?: string; // Base64 encoded file data
  fileMimeType?: string; // MIME type of the file
  // For placed workspace attachments (file.placeAttachment, PROTOCOL §5.9):
  // the UUID registry key plus the metadata needed to build the
  // attachment-reference file block — no bytes are kept on the item.
  attachmentId?: string; // UUID from the daemon's attachment registry
  attachmentMimeType?: string; // MIME type recorded at placement
  attachmentSize?: number; // Placed byte length
  // Placement lifecycle for non-image attachments. Placement copies from
  // `sourcePath` on the local sidecar and sends base64 bytes via the `data`
  // arm against a remote backend (attachment-placement.ts): `placing` while
  // file.placeAttachment is in flight, `failed` when it errored (no
  // resolvable path, daemon error, stale/missing source). Absent/'placed'
  // means the item is ready to send. Send/create is blocked while any item
  // is placing or failed.
  placementStatus?: 'placing' | 'failed' | 'placed';
  // Chunk-acknowledged upload fraction (0..1) while a chunked remote
  // placement (>25MB, file.attachmentUpload.*) is in flight — drives the
  // uploading pill's percent label. Absent for single-shot placements
  // (indeterminate spinner) and outside the 'placing' state. Transient
  // UI-only state, never persisted.
  placementProgress?: number;
  // Human-readable reason for a failed placement (daemon error detail, e.g.
  // "sourcePath is a directory"), shown in the failed pill tooltip. Absent
  // when no informative detail was available.
  placementError?: string;
  // Absolute host-local source path captured at drop/pick time — what
  // placeAttachment copies from and what a retry re-places from. Also the
  // staging key for pre-workspace surfaces (modal/onboarding), where
  // placement is deferred until workspace.create returns.
  sourcePath?: string;
}

/** True when any attachment item still blocks sending: placement in flight or failed. */
export function hasBlockingAttachments(items: ContextItem[]): boolean {
  return items.some(
    (item) => item.placementStatus === 'placing' || item.placementStatus === 'failed',
  );
}

export interface SymbolInfo {
  name: string;
  kind: string; // function, class, variable, etc.
  file: string;
  line: number;
  documentation?: string;
}

/**
 * Search for files in a workspace via the daemon (`search.fileNames`, PROTOCOL §5.15).
 * Errors surface as empty results — never fabricated data.
 */
export async function searchFiles(
  workspaceId: string,
  query: string,
  limit: number = 10,
): Promise<FileSearchResult[]> {
  try {
    logger.debug('Searching files', { workspaceId, query, limit });
    const result = await backendRequest<{ files?: string[] }>('search.fileNames', {
      workspaceId,
      pattern: query,
      limit,
    });

    const files = Array.isArray(result?.files) ? result.files : [];
    return files.map((path) => ({
      name: path.split('/').pop() || path,
      path,
      relativePath: path,
      type: 'file' as const,
    }));
  } catch (error) {
    logger.error('Failed to search files', error);
    return [];
  }
}

/** Result of `file.placeAttachment` (PROTOCOL §5.9, v6.5 + registry fields). */
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
}

/**
 * Place a chat attachment into the workspace's `.intent/attachments/`
 * directory via the daemon (`file.placeAttachment`, PROTOCOL §5.9, v6.5).
 * Exactly one of `data` (base64, `data:` URL prefix tolerated) or
 * `sourcePath` (absolute host-local path the daemon copies directly) must be
 * provided; optional `mimeType` is recorded in the attachment registry.
 * Errors propagate to the caller.
 */
export async function placeAttachment(
  workspaceId: string,
  fileName: string,
  source: { data?: string; sourcePath?: string; mimeType?: string },
): Promise<PlaceAttachmentResult> {
  logger.debug('Placing attachment', {
    workspaceId,
    fileName,
    viaSourcePath: source.sourcePath !== undefined,
  });
  return await backendRequest<PlaceAttachmentResult>('file.placeAttachment', {
    workspaceId,
    fileName,
    ...(source.data !== undefined ? { data: source.data } : {}),
    ...(source.sourcePath !== undefined ? { sourcePath: source.sourcePath } : {}),
    ...(source.mimeType !== undefined && source.mimeType !== ''
      ? { mimeType: source.mimeType }
      : {}),
  });
}

/** Result of `file.attachmentUpload.begin` (PROTOCOL §5.9, v6.16). */
export interface BeginAttachmentUploadResult {
  uploadId: string;
  /** Daemon's decoded-bytes-per-chunk cap (16 MiB). */
  maxChunkBytes: number;
}

/**
 * Open a staged chunked attachment upload session on the daemon
 * (`file.attachmentUpload.begin`, PROTOCOL §5.9, v6.16). The daemon verifies
 * the assembled payload against `sha256` (lowercase hex) at commit. Errors
 * propagate to the caller.
 */
export async function beginAttachmentUpload(
  workspaceId: string,
  fileName: string,
  sizeBytes: number,
  sha256: string,
  mimeType?: string,
): Promise<BeginAttachmentUploadResult> {
  return await backendRequest<BeginAttachmentUploadResult>('file.attachmentUpload.begin', {
    workspaceId,
    fileName,
    sizeBytes,
    sha256,
    ...(mimeType !== undefined && mimeType !== '' ? { mimeType } : {}),
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
 * (`file.attachmentUpload.chunk`, PROTOCOL §5.9, v6.16). Retrying a seq is
 * idempotent on the daemon side.
 */
export async function sendAttachmentUploadChunk(
  uploadId: string,
  seq: number,
  data: string,
): Promise<{ uploadId: string; seq: number; receivedBytes: number }> {
  return await backendRequest(
    'file.attachmentUpload.chunk',
    { uploadId, seq, data },
    { timeoutMs: UPLOAD_TRANSFER_TIMEOUT_MS },
  );
}

/**
 * Verify and place a completed chunked upload
 * (`file.attachmentUpload.commit`, PROTOCOL §5.9, v6.16). The result is
 * byte-shape-identical to a successful `file.placeAttachment`.
 */
export async function commitAttachmentUpload(uploadId: string): Promise<PlaceAttachmentResult> {
  return await backendRequest<PlaceAttachmentResult>(
    'file.attachmentUpload.commit',
    { uploadId },
    { timeoutMs: UPLOAD_TRANSFER_TIMEOUT_MS },
  );
}

/**
 * Drop a staged chunked upload session and its staging directory
 * (`file.attachmentUpload.abort`, PROTOCOL §5.9, v6.16). Idempotent.
 */
export async function abortAttachmentUpload(
  uploadId: string,
): Promise<{ uploadId: string; aborted: boolean }> {
  return await backendRequest('file.attachmentUpload.abort', { uploadId });
}

/** Result of `file.getAttachmentInfo` (PROTOCOL §5.9, v6.12). */
export interface AttachmentInfo {
  attachmentId: string;
  fileName: string;
  mimeType?: string;
  size: number;
  uploadedAt: string;
  /** Workspace-relative path under `.intent/attachments/`. */
  path: string;
  /** Whether the file is still on disk at read time (the registry row survives an out-of-band delete). */
  exists: boolean;
}

/**
 * Look up an attachment-registry row by UUID via the daemon
 * (`file.getAttachmentInfo`, PROTOCOL §5.9, v6.12). Unknown ids reject with
 * -32602; errors propagate to the caller.
 */
export async function getAttachmentInfo(attachmentId: string): Promise<AttachmentInfo> {
  return await backendRequest<AttachmentInfo>('file.getAttachmentInfo', { attachmentId });
}

/** `file:download-attachment` result: `canceled` means the user dismissed the save dialog. */
export interface DownloadAttachmentResult {
  success: boolean;
  canceled?: boolean;
  data?: { filePath: string };
  error?: { code: string; message: string };
}

/**
 * Save a non-editor attachment to a user-chosen location (monorepo#2458).
 * The main process owns the native save dialog (default name = `fileName`)
 * and fetches the bytes: a local backend copies from the workspace path on
 * disk; a remote backend loops `file.readChunk` over a per-transfer
 * connection and streams chunks to the chosen path.
 */
export async function downloadAttachment(
  workspaceId: string,
  path: string,
  fileName: string,
): Promise<DownloadAttachmentResult> {
  return await invoke<DownloadAttachmentResult>('file:download-attachment', {
    workspaceId,
    path,
    fileName,
  });
}

/**
 * Search for symbols in the workspace via the daemon (`search.codebase`, PROTOCOL §5.15).
 * Errors surface as empty results — never fabricated data.
 */
export async function searchSymbols(
  workspaceId: string,
  query: string,
  limit: number = 10,
): Promise<SymbolInfo[]> {
  try {
    logger.debug('Searching symbols', { workspaceId, query, limit });
    const result = await backendRequest<{ matches?: any[] }>('search.codebase', {
      workspaceId,
      query,
    });

    const matches = Array.isArray(result?.matches) ? result.matches : [];
    return matches.slice(0, limit).map((match: any) => ({
      name: match.symbol || match.name || '',
      kind: match.kind || 'symbol',
      file: match.file || '',
      line: typeof match.line === 'number' ? match.line : 0,
      documentation: match.preview,
    }));
  } catch (error) {
    logger.error('Failed to search symbols', error);
    return [];
  }
}
