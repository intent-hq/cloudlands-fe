/**
 * Context API for rich input features
 * Provides daemon-backed reads for file search, symbols, and editor integration
 */

import { invoke } from '$lib/electron-bridge';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
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

export interface EditorSelection {
  text: string;
  file?: string;
  range?: {
    start: number;
    end: number;
  };
  language?: string;
}

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
        const errorMsg = fileResult.error?.message || 'Failed to read file';
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
 * Get current editor selection
 */
export async function getEditorSelection(workspaceId?: string): Promise<EditorSelection | null> {
  try {
    logger.debug('Getting editor selection', { workspaceId });
    const selection = await invoke<Partial<EditorSelection> | null>('editor:get-selection', {
      // Pass workspaceId as-is (undefined if not provided) rather than defaulting to empty string
      workspaceId,
    });

    if (!selection || !selection.text) {
      return null;
    }

    return {
      text: selection.text,
      file: selection.file,
      range: selection.range,
      language: selection.language,
    };
  } catch (error) {
    logger.debug('No editor selection available', error);
    return null;
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

/**
 * Create a context item from editor selection
 */
export async function createSelectionContext(workspaceId?: string): Promise<any | null> {
  try {
    const selection = await getEditorSelection(workspaceId);
    if (!selection) {
      return null;
    }

    return {
      id: `selection-${Date.now()}`,
      type: 'selection',
      label: 'Current Selection',
      content: selection.text,
      path: selection.file,
      range: selection.range,
      metadata: {
        language: selection.language,
      },
    };
  } catch (error) {
    logger.error('Failed to create selection context', error);
    return null;
  }
}
