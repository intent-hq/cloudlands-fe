/**
 * Workspace Content File Manager
 *
 * Handles file-related operations for the workspace content panel
 */

import { createLogger } from '$lib/utils/client-logger';
import { invoke } from '$lib/electron-bridge';
import { workspaceClient } from './workspace.client';
import { toast } from '$lib/components/ui/toast';
import { getLanguageFromPath } from '$lib/utils/file-utils';
import { isBinaryExtension } from '$shared/binary-file-extensions';
import type { Workspace } from '$shared/types';

const logger = createLogger('WorkspaceContentFileManager');

/**
 * Maximum file size for loading (5MB) - prevents crashes with very large files
 * Files larger than this will still be shown but content will be truncated
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface FileState {
  content: string;
  originalContent: string;
  language: string;
  isDirty: boolean;
  isSaving: boolean;
  isTextFile: boolean;
  isBinary?: boolean;
  lastSaveTime: number;
}

export class WorkspaceContentFileManager {
  private workspace: Workspace | null = null;

  constructor() {}

  setWorkspace(workspace: Workspace) {
    this.workspace = workspace;
  }

  /**
   * Load file content from the file system
   */
  async loadFileContent(filePath: string): Promise<FileState | null> {
    if (!filePath || filePath.trim() === '') {
      logger.warn('[loadFileContent] No file path provided');
      return null;
    }

    // Strip leading @ if present (cleanup for legacy data or corrupted mentions)
    let cleanPath = filePath;
    if (cleanPath.startsWith('@')) {
      cleanPath = cleanPath.slice(1);
      // PERF: Changed from INFO to DEBUG - called for every file load
      logger.debug('[loadFileContent] Stripped @ prefix from path:', {
        original: filePath,
        clean: cleanPath,
      });
    }

    try {
      // PERF: Changed from INFO to DEBUG - called for every file load
      logger.debug('[loadFileContent] Loading file:', cleanPath);

      // Resolve the file path
      let resolvedPath = cleanPath;
      const workspacePath = this.workspace?.worktreePath || this.workspace?.repositoryPath;
      if (!cleanPath.startsWith('/') && workspacePath) {
        resolvedPath = `${workspacePath}/${cleanPath}`;
        // PERF: Changed from INFO to DEBUG - called for every file load
        logger.debug('[loadFileContent] Resolved relative path:', resolvedPath);
      }

      const response = await invoke<{
        success: boolean;
        data?:
          | {
              content: string;
              stats: { size: number; modified: string };
              isBinary?: boolean;
              truncated?: boolean;
            }
          | string;
        error?: string | { code?: string; message?: string };
      }>('file:read', {
        path: resolvedPath,
        workspaceId: this.workspace?.id,
        maxSize: MAX_FILE_SIZE,
        truncateIfLarge: true,
      });

      if (response.success && response.data !== undefined) {
        // Handle both old format (string) and new format (object with content property)
        const content = typeof response.data === 'string' ? response.data : response.data.content;
        const isBinary = typeof response.data === 'object' ? response.data.isBinary : false;
        const truncated = typeof response.data === 'object' ? response.data.truncated : false;

        if (truncated) {
          logger.info('[loadFileContent] File content was truncated due to size limits', {
            path: cleanPath,
          });
        }
        const language = getLanguageFromPath(cleanPath);
        const isTextFile = this.isTextFileType(cleanPath);

        // PERF: Changed from INFO to DEBUG - called for every file load
        logger.debug('[loadFileContent] File loaded successfully:', {
          path: cleanPath,
          contentLength: content.length,
          language,
          isTextFile,
          isBinary,
        });

        return {
          content,
          originalContent: content,
          language,
          isDirty: false,
          isSaving: false,
          isTextFile,
          isBinary,
          lastSaveTime: 0,
        };
      } else {
        // Handle error which can be a string or an object with code/message
        const rawError = response.error ?? 'Unknown error';
        const errorObj = rawError as { message?: string; code?: string };
        const errorMsg =
          typeof rawError === 'string'
            ? rawError
            : errorObj?.message || errorObj?.code || String(rawError);

        // If file not found and it's a simple filename (no path separators), try to search for it
        if (
          (errorMsg.includes('ENOENT') || errorMsg.includes('not found')) &&
          !cleanPath.includes('/') &&
          this.workspace?.id
        ) {
          logger.info('[loadFileContent] File not found, searching workspace for:', cleanPath);
          const searchResult = await this.searchAndLoadFile(cleanPath);
          if (searchResult) {
            return searchResult;
          }
        }

        logger.error('[loadFileContent] Failed to load file:', {
          error: rawError,
          path: cleanPath,
        });

        if (errorMsg.includes('ENOENT') || errorMsg.includes('not found')) {
          toast.error(`File not found: ${cleanPath.split('/').pop()}`);
        } else {
          toast.error(`Failed to load file: ${errorMsg}`);
        }
        return null;
      }
    } catch (error) {
      logger.error('[loadFileContent] Failed to load file:', error);
      toast.error(`Failed to load file: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Search for a file by name in the workspace and load it if found
   * Used as a fallback when a simple filename (without path) isn't found at the root
   */
  private async searchAndLoadFile(fileName: string): Promise<FileState | null> {
    if (!this.workspace?.id) {
      return null;
    }

    try {
      const response = await invoke<{ files: any[]; folders?: any[] }>('workspace:list-files', {
        workspaceId: this.workspace.id,
        pattern: fileName,
        limit: 10,
      });

      if (!response?.files?.length) {
        logger.info('[searchAndLoadFile] No files found matching:', fileName);
        return null;
      }

      // Find exact filename matches (not just partial matches)
      const exactMatches = response.files.filter(
        (f: any) => f.name === fileName || f.relativePath?.endsWith(`/${fileName}`),
      );

      if (exactMatches.length === 0) {
        logger.info('[searchAndLoadFile] No exact matches for:', fileName);
        return null;
      }

      // Use the first exact match
      const matchedFile = exactMatches[0];
      const matchedPath = matchedFile.relativePath || matchedFile.path;

      logger.info('[searchAndLoadFile] Found file, loading:', matchedPath);

      // Dispatch event to update the selected file path in the UI
      window.dispatchEvent(
        new CustomEvent('workspace:file-resolved', {
          detail: { originalPath: fileName, resolvedPath: matchedPath },
        }),
      );

      // Load the file using the resolved path
      const workspacePath = this.workspace?.worktreePath || this.workspace?.repositoryPath;
      const resolvedPath = matchedFile.path.startsWith('/')
        ? matchedFile.path
        : `${workspacePath}/${matchedPath}`;

      const fileResponse = await invoke<{
        success: boolean;
        data?:
          | {
              content: string;
              stats: { size: number; modified: string };
              isBinary?: boolean;
              truncated?: boolean;
            }
          | string;
        error?: string | { code?: string; message?: string };
      }>('file:read', { path: resolvedPath, maxSize: MAX_FILE_SIZE, truncateIfLarge: true });

      if (fileResponse.success && fileResponse.data !== undefined) {
        const content =
          typeof fileResponse.data === 'string' ? fileResponse.data : fileResponse.data.content;
        const isBinary = typeof fileResponse.data === 'object' ? fileResponse.data.isBinary : false;
        const truncated =
          typeof fileResponse.data === 'object' ? fileResponse.data.truncated : false;
        const language = getLanguageFromPath(matchedPath);
        const isTextFile = this.isTextFileType(matchedPath);

        if (truncated) {
          logger.info('[searchAndLoadFile] File content was truncated due to size limits', {
            path: matchedPath,
          });
        }

        return {
          content,
          originalContent: content,
          language,
          isDirty: false,
          isSaving: false,
          isTextFile,
          isBinary,
          lastSaveTime: 0,
        };
      }

      return null;
    } catch (error) {
      logger.error('[searchAndLoadFile] Failed to search for file:', error);
      return null;
    }
  }

  /**
   * Save file content to the file system
   */
  async saveFileContent(filePath: string, content: string): Promise<boolean> {
    if (!filePath || filePath.trim() === '') {
      logger.error('[saveFileContent] Invalid file path: path is empty');
      return false;
    }

    try {
      logger.info('[saveFileContent] Saving file:', filePath);

      // Resolve the file path
      let resolvedPath = filePath;
      const workspacePath = this.workspace?.worktreePath || this.workspace?.repositoryPath;
      if (!filePath.startsWith('/') && workspacePath) {
        resolvedPath = `${workspacePath}/${filePath}`;
        logger.info('[saveFileContent] Resolved relative path for save:', resolvedPath);
      }

      const response = await invoke<{ success: boolean; error?: string }>('file:write', {
        path: resolvedPath,
        content,
        workspaceId: this.workspace?.id, // For immediate file tracking updates
      });

      if (response.success) {
        logger.info('[saveFileContent] File saved successfully:', filePath);

        // Trigger git check after file save
        logger.info('[saveFileContent] Checking workspace for trigger:', {
          hasWorkspace: !!this.workspace,
          workspaceId: this.workspace?.id,
          workspacePath: this.workspace?.worktreePath,
        });

        if (this.workspace?.id) {
          const fileName = filePath.split('/').pop() || filePath;
          logger.info('[saveFileContent] Triggering git check:', {
            workspaceId: this.workspace.id,
            fileName,
            reason: `File saved: ${fileName}`,
          });

          // Add a small delay before triggering check to ensure atomic file write
          // (temp file → rename) is complete. This prevents race conditions where
          // the change detector tries to stat the temporary file before it's renamed.
          if (this.workspace) {
            setTimeout(() => {
              workspaceClient.triggerCheck(this.workspace!.id, `File saved: ${fileName}`);
            }, 50);

            // Emit file:changed event to trigger file tree refresh
            // This ensures the git status badges update immediately
            // PERF: Changed from INFO to DEBUG - called for every file save
            logger.debug('[saveFileContent] Emitting file:changed event for file tree refresh');
            window.dispatchEvent(
              new CustomEvent('file:changed', {
                detail: {
                  workspaceId: this.workspace.id,
                  files: [resolvedPath],
                  type: 'change',
                },
              }),
            );
          }
        } else {
          logger.warn('[saveFileContent] No workspace ID available, skipping git check trigger');
        }

        return true;
      } else {
        const errorMsg = response.error || 'Unknown error';
        logger.error('[saveFileContent] File save failed:', {
          error: errorMsg,
          path: filePath,
          contentLength: content?.length,
        });
        toast.error(`Failed to save file: ${errorMsg}`);
        return false;
      }
    } catch (error) {
      logger.error('[saveFileContent] Failed to save file:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save file: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Check if a file is a text file based on its extension
   */
  isTextFileType(path: string): boolean {
    return !isBinaryExtension(path);
  }
}
