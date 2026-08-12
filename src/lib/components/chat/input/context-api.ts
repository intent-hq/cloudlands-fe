/**
 * Context API for rich input features
 * Provides daemon-backed reads for file search, symbols, and editor integration
 */

import { invoke } from '$lib/electron-bridge';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '../../../../shared/types';

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
import type { Note } from '$shared/types';
export type { Note };



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

/** Maximum file size for context (1MB) - prevents crashes with large files */
const MAX_CONTEXT_FILE_SIZE = 1 * 1024 * 1024;

interface ReadFileOptions {
  /** Maximum file size in bytes (default: 1MB) */
  maxSize?: number;
  /** If true, truncate content to maxSize instead of throwing (default: true) */
  truncateIfLarge?: boolean;
  /** Workspace ID for remote workspace file routing */
  workspaceId?: string;
}

interface FileReadResult {
  success: boolean;
  data?: {
    content: string;
    stats?: { size: number; modified: string };
    isBinary?: boolean;
    truncated?: boolean;
  };
  error?: { code: string; message: string };
}

/**
 * Read file content with size limits to prevent crashes
 */
export async function readFile(path: string, options?: ReadFileOptions): Promise<string> {
  try {
    const maxSize = options?.maxSize ?? MAX_CONTEXT_FILE_SIZE;
    const truncateIfLarge = options?.truncateIfLarge ?? true;

    logger.debug('Reading file', { path, maxSize, truncateIfLarge });
    const result = await invoke<string | { content: string } | FileReadResult>('file:read', {
      path,
      maxSize,
      truncateIfLarge,
      workspaceId: options?.workspaceId,
    });

    // Handle new response format with success/error
    if (result && typeof result === 'object' && 'success' in result) {
      const fileResult = result as FileReadResult;
      if (!fileResult.success) {
        const errorMsg = fileResult.error?.message || m.chat_contextApi_readFileFailed_error();
        logger.warn('File read failed', { path, error: errorMsg });
        throw new Error(errorMsg);
      }
      if (fileResult.data?.truncated) {
        logger.debug('File content was truncated', { path, size: fileResult.data.stats?.size });
      }
      return fileResult.data?.content || '';
    }

    // Legacy response handling
    if (typeof result === 'string') {
      return result;
    } else if (result && typeof result === 'object' && 'content' in result) {
      return String((result as { content: string }).content);
    } else {
      return String(result);
    }
  } catch (error) {
    logger.error('Failed to read file', { path, error });
    throw error;
  }
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

/**
 * Get workspace information
 */
export async function getWorkspaceInfo(workspace: Workspace): Promise<any> {
  try {
    logger.debug('Getting workspace info', { workspaceId: workspace.id });
    const info = await invoke('workspace:get-info', { workspaceId: workspace.id });
    return info || workspace;
  } catch (error) {
    logger.error('Failed to get workspace info', error);
    return workspace;
  }
}

/**
 * Create a context item from a file path
 */
export async function createFileContext(path: string): Promise<any> {
  try {
    const content = await readFile(path);
    const name = path.split('/').pop() || path;

    return {
      id: `file-${Date.now()}-${name}`,
      type: 'file',
      label: name,
      path,
      content,
      metadata: {
        size: content.length,
        lines: content.split('\n').length,
      },
    };
  } catch (error) {
    logger.error('Failed to create file context', { path, error });
    throw error;
  }
}


