import { createAttachmentInfoRead } from '$lib/client/live/backend-attachment-info';
import type {
  AttachmentInfo,
  AttachmentInfoSelector,
} from '$lib/client/live/backend-attachment-info';
import type { ContextItem } from './context-item';
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

export type { ContextItem } from './context-item';

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

/** Result of `file.placeAttachment` (PROTOCOL §5.9, plus registry fields). */
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
export async function placeAttachment(
  workspaceId: string,
  fileName: string,
  source: { data?: string; sourcePath?: string; mimeType?: string; idempotencyKey?: string },
): Promise<PlaceAttachmentResult> {
  logger.debug('Placing attachment', {
    workspaceId,
    fileName,
    viaSourcePath: source.sourcePath !== undefined,
    keyed: source.idempotencyKey !== undefined,
  });
  return await backendRequest<PlaceAttachmentResult>('file.placeAttachment', {
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

/** Result of `file.attachmentUpload.begin` (PROTOCOL §5.9). */
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

/**
 * Open a staged chunked attachment upload session on the daemon
 * (`file.attachmentUpload.begin`, PROTOCOL §5.9). The daemon verifies
 * the assembled payload against `sha256` (lowercase hex) at commit. Optional
 * `idempotencyKey` binds the committed attachment to the key so a
 * lost commit reply is recoverable via `getAttachmentInfo`; a key already
 * bound to a committed attachment rejects begin with -32602 ("already
 * committed"). Errors propagate to the caller.
 */
export async function beginAttachmentUpload(
  workspaceId: string,
  fileName: string,
  sizeBytes: number,
  sha256: string,
  options: { mimeType?: string; idempotencyKey?: string } = {},
): Promise<BeginAttachmentUploadResult> {
  return await backendRequest<BeginAttachmentUploadResult>('file.attachmentUpload.begin', {
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
export async function sendAttachmentUploadChunk(
  uploadId: string,
  seq: number,
  data: string,
  workspaceId?: string,
): Promise<{ uploadId: string; seq: number; receivedBytes: number }> {
  return await backendRequest(
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
export async function commitAttachmentUpload(
  uploadId: string,
  workspaceId?: string,
): Promise<PlaceAttachmentResult> {
  return await backendRequest<PlaceAttachmentResult>(
    'file.attachmentUpload.commit',
    { uploadId, ...(workspaceId !== undefined ? { workspaceId } : {}) },
    { timeoutMs: UPLOAD_TRANSFER_TIMEOUT_MS },
  );
}

/**
 * Drop a staged chunked upload session and its staging directory
 * (`file.attachmentUpload.abort`, PROTOCOL §5.9). Idempotent.
 */
export async function abortAttachmentUpload(
  uploadId: string,
  workspaceId?: string,
): Promise<{ uploadId: string; aborted: boolean }> {
  return await backendRequest('file.attachmentUpload.abort', {
    uploadId,
    ...(workspaceId !== undefined ? { workspaceId } : {}),
  });
}

export type {
  AttachmentInfo,
  AttachmentInfoSelector,
} from '$lib/client/live/backend-attachment-info';
/** Keep the source-facing selector signature at its existing compatibility boundary. */
export function getAttachmentInfo(selector: AttachmentInfoSelector): Promise<AttachmentInfo> {
  // Preserve lazy transport access for source consumers that never resolve media.
  return createAttachmentInfoRead(backendRequest)(selector);
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
