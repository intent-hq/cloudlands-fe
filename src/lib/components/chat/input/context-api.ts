import { createBackendAttachmentPlacement } from '$lib/client/live/backend-attachment-placement';
import type { AttachmentPlacementApi } from '$lib/client/live/attachment-upload-types';
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

/**
 * Source compatibility boundary: retain existing consumers/mocks until they inject
 * the shared attachment adapter. Request construction lives in the shared factory.
 */
export type {
  PlaceAttachmentResult,
  BeginAttachmentUploadResult,
} from '$lib/client/live/attachment-upload-types';
export const placeAttachment: AttachmentPlacementApi['placeAttachment'] = (...args) =>
  createBackendAttachmentPlacement(backendRequest).placeAttachment(...args);
export const beginAttachmentUpload: AttachmentPlacementApi['beginAttachmentUpload'] = (...args) =>
  createBackendAttachmentPlacement(backendRequest).beginAttachmentUpload(...args);
export const sendAttachmentUploadChunk: AttachmentPlacementApi['sendAttachmentUploadChunk'] = (
  ...args
) => createBackendAttachmentPlacement(backendRequest).sendAttachmentUploadChunk(...args);
export const commitAttachmentUpload: AttachmentPlacementApi['commitAttachmentUpload'] = (...args) =>
  createBackendAttachmentPlacement(backendRequest).commitAttachmentUpload(...args);
export const abortAttachmentUpload: AttachmentPlacementApi['abortAttachmentUpload'] = (...args) =>
  createBackendAttachmentPlacement(backendRequest).abortAttachmentUpload(...args);

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
