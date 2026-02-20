/**
 * Context API for rich input features
 * Provides IPC communication for file search, notes, and editor integration
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, CommandResponse, NoteId } from '../../../../shared/types';
import { NoteId as NoteIdFn } from '../../../../shared/types/branded-ids';

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
 * Search for files in a workspace
 */
export async function searchFiles(
  workspaceId: string,
  query: string,
  limit: number = 10,
): Promise<FileSearchResult[]> {
  try {
    logger.debug('Searching files', { workspaceId, query, limit });

    // For now, use a simple file listing approach
    // In production, this would use a proper file indexing service
    const response = await invoke<{ files: any[]; folders?: any[] }>('workspace:list-files', {
      workspaceId,
      pattern: query,
      limit,
    });

    if (!response || !response.files) {
      logger.warn('No files returned from search');
      return [];
    }

    return response.files.map((file: any) => ({
      name: file.name || file.path.split('/').pop(),
      path: file.path,
      relativePath: file.relativePath || file.path,
      type: file.type || 'file',
      size: file.size,
      modified: file.modified ? new Date(file.modified) : undefined,
    }));
  } catch (error) {
    logger.error('Failed to search files', error);
    // Return mock data for development
    if (query) {
      return [
        {
          name: `${query}.ts`,
          path: `/workspace/src/${query}.ts`,
          relativePath: `src/${query}.ts`,
          type: 'file',
        },
        {
          name: `${query}.test.ts`,
          path: `/workspace/tests/${query}.test.ts`,
          relativePath: `tests/${query}.test.ts`,
          type: 'file',
        },
      ];
    }
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
 * Get notes for a workspace
 */
export async function getNotes(workspaceId: string): Promise<Note[]> {
  try {
    logger.debug('Getting notes', { workspaceId });
    const response = await invoke<CommandResponse<any[]>>('notes:list', { workspaceId });

    if (!response) {
      return [];
    }

    if (!response.success || !Array.isArray(response.data)) {
      logger.warn('Notes response not successful or invalid shape:', response);
      return [];
    }

    const notes = response.data;

    return notes.map(
      (note: any) =>
        ({
          id: NoteIdFn(note.id),
          workspaceId: note.workspaceId,
          title: note.title || 'Untitled',
          content: note.content || '',
          contentType: note.contentType || 'markdown',
          tags: note.tags || [],
          isPinned: note.isPinned || false,
          isArchived: note.isArchived || false,
          isDefault: note.isDefault,
          parentId: note.parentId ? NoteIdFn(note.parentId) : undefined,
          visibility: note.visibility || 'workspace',
          metadata: note.metadata,
          references: note.references,
          versions: note.versions,
          createdAt: note.createdAt || note.created_at || new Date().toISOString(),
          updatedAt: note.updatedAt || note.updated_at || new Date().toISOString(),
          // Legacy compatibility
          is_pinned: note.is_pinned,
          created_at: note.created_at,
          updated_at: note.updated_at,
          is_archived: note.is_archived,
        }) as Note,
    );
  } catch (error) {
    logger.error('Failed to get notes', { error });
    // Return mock data for development
    return [
      {
        id: NoteIdFn('note-1'),
        workspaceId: workspaceId as any,
        title: 'Project Overview',
        content: 'This project implements a rich input system for the chat interface...',
        contentType: 'markdown' as const,
        tags: ['documentation', 'overview'],
        isPinned: false,
        isArchived: false,
        visibility: 'workspace' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Note,
      {
        id: NoteIdFn('note-2'),
        workspaceId: workspaceId as any,
        title: 'TODO List',
        content: '- Implement file search\n- Add note support\n- Integrate with editor',
        contentType: 'markdown' as const,
        tags: ['tasks'],
        isPinned: false,
        isArchived: false,
        visibility: 'workspace' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Note,
    ];
  }
}

/**
 * Get a specific note
 */
export async function getNote(workspaceId: string, noteId: string): Promise<Note | null> {
  try {
    logger.debug('Getting note', { workspaceId, noteId });
    const response = await invoke<CommandResponse<any>>('notes:get', { workspaceId, noteId });

    if (!response || !response.success || !response.data) {
      logger.warn('Note not found or invalid response', { workspaceId, noteId, response });
      return null;
    }

    const note = response.data;

    return {
      id: NoteIdFn(note.id),
      workspaceId: note.workspaceId,
      title: note.title || 'Untitled',
      content: note.content || '',
      contentType: note.contentType || 'markdown',
      tags: note.tags || [],
      isPinned: note.isPinned || false,
      isArchived: note.isArchived || false,
      isDefault: note.isDefault,
      parentId: note.parentId ? NoteIdFn(note.parentId) : undefined,
      visibility: note.visibility || 'workspace',
      metadata: note.metadata,
      references: note.references,
      versions: note.versions,
      createdAt: note.createdAt || note.created_at || new Date().toISOString(),
      updatedAt: note.updatedAt || note.updated_at || new Date().toISOString(),
      // Legacy compatibility
      is_pinned: note.is_pinned,
      created_at: note.created_at,
      updated_at: note.updated_at,
      is_archived: note.is_archived,
    } as Note;
  } catch (error) {
    logger.error('Failed to get note', { workspaceId, noteId, error });
    return null;
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
    // Return mock data for development
    return {
      text: "function example() {\n  logger.info('Hello, world!');\n}",
      file: '/workspace/src/example.ts',
      range: { start: 10, end: 13 },
      language: 'typescript',
    };
  }
}

/**
 * Search for symbols in the workspace
 */
export async function searchSymbols(
  workspaceId: string,
  query: string,
  limit: number = 10,
): Promise<SymbolInfo[]> {
  try {
    logger.debug('Searching symbols', { workspaceId, query, limit });
    const symbols = await invoke<any[]>('workspace:search-symbols', {
      workspaceId,
      query,
      limit,
    });

    if (!symbols) {
      return [];
    }

    return symbols.map((symbol: any) => ({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      documentation: symbol.documentation,
    }));
  } catch (error) {
    logger.error('Failed to search symbols', error);
    // Return mock data for development
    return [
      {
        name: 'RichPromptBox',
        kind: 'class',
        file: '/workspace/src/components/RichPromptBox.svelte',
        line: 25,
        documentation: 'Main rich input component',
      },
      {
        name: 'handleSubmit',
        kind: 'function',
        file: '/workspace/src/components/RichPromptBox.svelte',
        line: 150,
        documentation: 'Handles form submission',
      },
    ];
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
 * Create a context item from a note
 */
export async function createNoteContext(workspaceId: string, noteId: string): Promise<any> {
  try {
    const note = await getNote(workspaceId, noteId);
    if (!note) {
      throw new Error('Note not found');
    }

    return {
      id: `note-${noteId}`,
      type: 'note',
      label: note.title,
      content: note.content,
      metadata: {
        noteId: note.id,
        tags: note.tags,
      },
    };
  } catch (error) {
    logger.error('Failed to create note context', { workspaceId, noteId, error });
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
