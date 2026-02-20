/**
 * Configuration Constants
 *
 * Browser-safe constants that can be used in both main and renderer processes.
 * This file contains only constants and no Node.js dependencies.
 */

export class WorkspaceConfigConstants {
  // Limits
  static readonly MAX_WORKSPACES = 100;
  static readonly MAX_NOTES_PER_WORKSPACE = 1000;
  static readonly MAX_COMMENTS_PER_NOTE = 10000;
  static readonly MAX_TITLE_LENGTH = 100;
  static readonly MAX_CONTENT_LENGTH = 1000000; // 1MB

  // File names
  static readonly WORKSPACE_METADATA_FILE = 'workspace.json';
  static readonly FIRST_VISIT_STATE_FILE = 'first-visit-state.json';
  static readonly PANEL_LAYOUT_HISTORY_FILE = 'panel-layout-history.json';
  static readonly NOTE_FILE_EXTENSION = '.md';
  /** @deprecated Legacy notes used .json, now use .md */
  static readonly LEGACY_NOTE_FILE_EXTENSION = '.json';
  static readonly COMMENTS_FILE_SUFFIX = '.comments.json';

  // Folder names
  static readonly METADATA_FOLDER = '.workspace';
  static readonly NOTES_FOLDER = 'notes';
  static readonly AGENTS_FOLDER = 'agents';
  static readonly DIFFS_FOLDER = 'diffs';
  static readonly CACHE_FOLDER = 'cache';
  static readonly ASSETS_FOLDER = 'assets';
  static readonly BROWSER_SNAPSHOTS_FOLDER = 'browser-snapshots';
  static readonly LOGS_FOLDER = 'logs';
  static readonly WORKTREES_FOLDER = 'workspaces';

  /**
   * Convert text to URL-safe slug
   *
   * Examples:
   * - "Fix Login Bug" → "fix-login-bug"
   * - "Feature: Dark Mode 🌙" → "feature-dark-mode"
   * - "Fix #123 - Login Bug" → "fix-123-login-bug"
   */
  static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dash
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
      .slice(0, 50); // Limit length to 50 chars
  }

  /**
   * Generate worktree folder name - just the repo name for cleanliness.
   *
   * The folder structure is:
   * ~/intent/workspaces/{workspace-slug}/{repo-name}/
   *
   * Examples:
   * - ~/intent/workspaces/amber-forest/augment/
   * - ~/intent/workspaces/silver-canyon-2/my-app/
   * - ~/intent/workspaces/cobalt-river/repo/ (fallback when no repo name)
   */
  static generateWorktreeFolderName(
    repoName?: string,
    _workspaceName?: string,
    _workspaceId?: string,
  ): string {
    // Just use the repo name - the workspace ID is already in the parent folder
    if (repoName) {
      return WorkspaceConfigConstants.slugify(repoName);
    }

    // Fallback if no repo name provided
    return 'repo';
  }

  /**
   * Validate workspace ID format
   * Accepts:
   * - New slug format: word-word (e.g., "amber-forest", "auth-refactor")
   * - New slug with collision suffix: word-word-N (e.g., "amber-forest-2")
   * - Legacy slug format: word-word-xxxx (e.g., "amber-forest-a7x2") for backward compatibility
   * - Legacy UUID v4 format for backward compatibility
   * - Optimistic workspace IDs
   */
  static isValidWorkspaceId(id: string): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }

    // Check if it's an optimistic workspace ID
    if (id.startsWith('optimistic-')) {
      // Optimistic IDs have format: optimistic-{timestamp}-{random}
      const optimisticPattern = /^optimistic-\d+-[a-z0-9]+$/;
      return optimisticPattern.test(id);
    }

    // Check for new slug format: word-word or word-word-N (numeric suffix)
    const slugPattern = /^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/;
    if (slugPattern.test(id)) {
      return true;
    }

    // Legacy slug format: word-word-xxxx (4 alphanumeric chars)
    const legacySlugPattern = /^[a-z]{2,15}-[a-z]{2,15}-[a-z0-9]{4}$/;
    if (legacySlugPattern.test(id)) {
      return true;
    }

    // Legacy UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }
}
