/**
 * Workspace Content Diff Manager
 *
 * Handles diff-related operations for the workspace content panel
 */

import { createLogger } from '$lib/utils/client-logger';
import { invoke } from '$lib/electron-bridge';
import { gitClient } from '$features/git/git.client';
import { workspaceClient } from './workspace.client';
import { toast } from '$lib/components/ui/toast';
import type { Workspace } from '$shared/types';
import type { AgentAttribution } from '$features/file-tracking/types';

const logger = createLogger('WorkspaceContentDiffManager');

export interface DiffContent {
  fileName: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  additions?: number;
  deletions?: number;
  diffChunks?: any[];
  isStaged?: boolean;
  /** Agent attribution if this change was made by an agent */
  agentAttribution?: AgentAttribution;
}

export interface DiffState {
  content: DiffContent | null;
  isDirty: boolean;
  isSaving: boolean;
  modifiedContent: string;
  viewMode: 'inline' | 'side-by-side';
}

export class WorkspaceContentDiffManager {
  private workspace: Workspace | null = null;

  constructor() {}

  setWorkspace(workspace: Workspace) {
    this.workspace = workspace;
  }

  /**
   * Load diff content for a file
   */
  async loadDiffContent(filePath: string): Promise<DiffContent | null> {
    if (!this.workspace) {
      logger.error('[loadDiffContent] No workspace set');
      return null;
    }

    try {
      // PERF: Changed from INFO to DEBUG - called for every diff load
      logger.debug('[loadDiffContent] Loading diff for file:', filePath);

      // Check if the file path contains staging info
      let filePathStr = filePath;
      let staged = false;

      if (filePath.includes(':staged:')) {
        filePathStr = filePath.replace(':staged:', '');
        staged = true;
        // PERF: Changed from INFO to DEBUG - called for every staged diff load
        logger.debug('[loadDiffContent] File is staged:', filePathStr);
      }

      // Use the diffs:get IPC call directly
      const response = await invoke<any>('diffs:get', {
        workspaceId: this.workspace.id,
        filePath: filePathStr,
        staged,
      });

      // PERF: Changed from INFO to DEBUG - called for every diff load
      logger.debug('[loadDiffContent] Diff response:', response);

      if ((response.ok || response.success) && response.data) {
        return {
          ...response.data,
          isStaged: staged,
        };
      }

      logger.warn('[loadDiffContent] No diff data returned');
      return null;
    } catch (error) {
      logger.error('[loadDiffContent] Failed to load diff:', error);
      return null;
    }
  }

  /**
   * Save diff content (save the modified file)
   */
  async saveDiffContent(diffContent: DiffContent, modifiedContent: string): Promise<boolean> {
    if (!this.workspace || !diffContent) {
      logger.error('[saveDiffContent] No workspace or diff content');
      return false;
    }

    try {
      // Convert relative path to absolute path
      const workspacePath = this.workspace.worktreePath || this.workspace.path || '';
      const absolutePath = diffContent.filePath.startsWith('/')
        ? diffContent.filePath
        : `${workspacePath}/${diffContent.filePath}`;

      // PERF: Changed from INFO to DEBUG - called for every diff save
      logger.debug('[saveDiffContent] Attempting to save diff file:', {
        relativePath: diffContent.filePath,
        absolutePath,
        workspacePath,
        contentLength: modifiedContent?.length,
      });

      const response = await invoke<{
        success: boolean;
        error?: string;
      }>('file:write', {
        path: absolutePath,
        content: modifiedContent,
        workspaceId: this.workspace?.id, // For immediate file tracking updates
      });

      if (response.success) {
        logger.info('[saveDiffContent] File saved successfully:', absolutePath);

        // Trigger git check after diff save
        if (this.workspace.id) {
          workspaceClient.triggerCheck(this.workspace.id, 'Diff saved');
        }

        return true;
      } else {
        const errorMsg = response.error || 'Unknown error';
        logger.error('[saveDiffContent] File write failed:', {
          error: errorMsg,
          path: absolutePath,
          contentLength: modifiedContent?.length,
        });
        toast.error(`Failed to save file: ${errorMsg}`);
        return false;
      }
    } catch (error) {
      logger.error('[saveDiffContent] Failed to save file:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save file: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Stage a file
   */
  async stageFile(filePath: string): Promise<boolean> {
    if (!this.workspace) return false;

    try {
      const result = await gitClient.stageFiles(this.workspace.id, [filePath]);
      if (!result.ok) {
        logger.error('[stageFile] Failed to stage file:', result.error);
        return false;
      }
      return true;
    } catch (error) {
      logger.error('[stageFile] Failed to stage file:', error);
      return false;
    }
  }

  /**
   * Unstage a file
   */
  async unstageFile(filePath: string): Promise<boolean> {
    if (!this.workspace) return false;

    try {
      const result = await gitClient.unstageFiles(this.workspace.id, [filePath]);
      if (!result.ok) {
        logger.error('[unstageFile] Failed to unstage file:', result.error);
        return false;
      }
      return true;
    } catch (error) {
      logger.error('[unstageFile] Failed to unstage file:', error);
      return false;
    }
  }
}
