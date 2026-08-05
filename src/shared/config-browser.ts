/**
 * Browser-Safe Configuration
 *
 * This is a browser-compatible version of config.ts that doesn't use Node.js modules.
 * It provides the same constants and configuration without file system operations.
 */

import { WorkspaceConfigConstants } from './config-constants';

export class WorkspaceConfig extends WorkspaceConfigConstants {
  // In browser context, we can't access the file system directly
  // These values are used for display/reference only
  static get WORKSPACE_ROOT(): string {
    // This is just a placeholder path for browser context
    // Actual file operations happen through IPC to the main process
    return '~/intent';
  }

  // Additional folder names not in constants (browser-only display paths)
  static readonly COMMENTS_FOLDER = 'comments';
  /** @deprecated Use events feature instead - this folder is no longer used */
  static readonly ACTIVITY_LOG_FOLDER = 'activity-log';
  static readonly SESSIONS_FOLDER = 'sessions';
  static readonly LOGS_FOLDER = 'logs';

  // Additional validation methods
  static isValidNoteId(id: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(id);
  }

  static isValidCommentId(id: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(id);
  }

  /**
   * Extract workspace ID from a path (browser-safe version)
   *
   * Examples:
   * - "/Users/user/intent/abc-123/notes" → "abc-123"
   * - "~/intent/abc-123/.workspace" → "abc-123"
   * - "/Users/user/.workspaces/abc-123/notes" → "abc-123" (legacy support)
   */
  static extractWorkspaceId(filePath: string): string | null {
    // Replace ~ with a placeholder home directory
    const normalized = filePath.replace(/^~/, '/home/user');
    const parts = normalized.split('/');

    // Try new 'intent' path first, then legacy '.workspaces' for backward compatibility
    let workspacesIndex = parts.indexOf('intent');
    if (workspacesIndex === -1) {
      workspacesIndex = parts.indexOf('.workspaces');
    }

    if (workspacesIndex === -1 || workspacesIndex === parts.length - 1) {
      return null;
    }

    let candidate = parts[workspacesIndex + 1];

    // Skip the WORKTREES_FOLDER ('workspaces') if it appears right after 'intent'.
    // Paths look like ~/intent/workspaces/{id}/{repo}, so the actual
    // workspace ID is one segment further.
    if (candidate === WorkspaceConfig.WORKTREES_FOLDER && workspacesIndex + 2 < parts.length) {
      candidate = parts[workspacesIndex + 2];
    }

    return candidate;
  }

  // Path helpers (for display/reference only in browser)
  // These use string concatenation instead of path.join since we're in the browser
  static paths = {
    base: WorkspaceConfig.WORKSPACE_ROOT,

    workspace: (id: string) => `${WorkspaceConfig.WORKSPACE_ROOT}/${id}`,

    metadata: (id: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${id}/${WorkspaceConfig.METADATA_FOLDER}`,

    workspaceMetadata: (id: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${id}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.WORKSPACE_METADATA_FILE}`,

    notes: (workspaceId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.NOTES_FOLDER}`,

    note: (workspaceId: string, noteId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.NOTES_FOLDER}/${noteId}${WorkspaceConfig.NOTE_FILE_EXTENSION}`,

    comments: (workspaceId: string, noteId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.NOTES_FOLDER}/${noteId}${WorkspaceConfig.COMMENTS_FILE_SUFFIX}`,

    cache: (workspaceId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.CACHE_FOLDER}`,

    worktree: (id: string, repoName?: string, workspaceName?: string, customBase?: string) => {
      const folderName = WorkspaceConfig.generateWorktreeFolderName(repoName, workspaceName, id);
      const base =
        customBase || `${WorkspaceConfig.WORKSPACE_ROOT}/${WorkspaceConfig.WORKTREES_FOLDER}`;
      return `${base}/${id}/${folderName}`;
    },

    firstVisitState: (id: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${id}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.FIRST_VISIT_STATE_FILE}`,

    panelLayoutHistory: (id: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${id}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.PANEL_LAYOUT_HISTORY_FILE}`,

    diffs: (id: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${id}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.DIFFS_FOLDER}`,

    agents: (id: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${id}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.AGENTS_FOLDER}`,

    /** @deprecated Use events feature instead - this path function is no longer used */
    activityLog: (workspaceId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.ACTIVITY_LOG_FOLDER}`,

    sessions: (workspaceId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.SESSIONS_FOLDER}`,

    session: (workspaceId: string, sessionId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.SESSIONS_FOLDER}/${sessionId}.json`,

    logs: (workspaceId: string) =>
      `${WorkspaceConfig.WORKSPACE_ROOT}/${workspaceId}/${WorkspaceConfig.METADATA_FOLDER}/${WorkspaceConfig.LOGS_FOLDER}`,
  };

  // Git configuration
  static readonly GIT_CONFIG = {
    DEFAULT_BRANCH: 'main',
    DEFAULT_REMOTE: 'origin',
    WORKTREE_PREFIX: 'wt-',
  };

  // Agent configuration
  // NOTE: Non-model defaults are defined in constants/agent-services.ts
  // (MODEL_DEFAULTS). There is no hardcoded default model id — the default
  // is always derived from the provider CLI's catalog.
  static readonly AGENT_CONFIG = {
    MAX_MESSAGE_LENGTH: 100000,
    MAX_HISTORY_SIZE: 1000,
    /** @deprecated Use MODEL_DEFAULTS.DEFAULT_TEMPERATURE from constants/agent-services.ts */
    DEFAULT_TEMPERATURE: 0.7,
    DEFAULT_MAX_TOKENS: 4096,
  };

  // UI configuration
  static readonly UI_CONFIG = {
    DEFAULT_THEME: 'dark',
    DEFAULT_FONT_SIZE: 14,
    DEFAULT_TAB_SIZE: 2,
    MAX_OPEN_TABS: 20,
  };
}

// Export a default instance for convenience
export default WorkspaceConfig;
