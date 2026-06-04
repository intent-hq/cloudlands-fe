/**
 * Centralized Configuration
 *
 * Single source of truth for all paths, constants, and configuration.
 *
 * IMPORTANT: This file should only be imported in the main process (Node.js/Electron).
 * For renderer process, use IPC calls to get configuration values or import config-constants.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceConfigConstants } from '../config-constants';
import { CHIEF_WORKSPACE_ID } from '../types/branded-ids';
import { getSafeHomeDir } from './utils';

export class WorkspaceConfig extends WorkspaceConfigConstants {
  // Root directory for NEW workspaces (dynamic; can be overridden via env for tests)
  static get WORKSPACE_ROOT(): string {
    const override = process.env.WORKSPACES_BASE_DIR || process.env.AUGMENT_WORKSPACES_ROOT;
    return override && override.trim().length > 0
      ? override
      : path.join(getSafeHomeDir(), 'intent');
  }

  // Legacy root where older workspaces may still live
  static get LEGACY_WORKSPACE_ROOT(): string {
    return path.join(getSafeHomeDir(), '.workspaces');
  }

  /**
   * The canonical base for all new workspace data.
   * Everything lives under ~/intent/workspaces/{id}/.
   */
  static get WORKSPACES_BASE(): string {
    return path.join(WorkspaceConfig.WORKSPACE_ROOT, WorkspaceConfig.WORKTREES_FOLDER);
  }

  /**
   * Virtual workspace IDs that don't correspond to real directories on disk.
   * These are used by background services (e.g. background-request, http-bridge-workspace)
   * and should skip filesystem lookups to avoid unnecessary sync I/O and log spam.
   */
  private static readonly VIRTUAL_WORKSPACE_IDS = new Set([
    'background-request',
    'http-bridge-workspace',
    CHIEF_WORKSPACE_ID,
  ]);

  /**
   * Check whether a workspace ID is virtual (not backed by a real directory).
   */
  static isVirtualWorkspace(id: string): boolean {
    return WorkspaceConfig.VIRTUAL_WORKSPACE_IDS.has(id);
  }

  /**
   * Resolve which workspace root a given workspace ID lives in.
   * Checks ~/intent/workspaces/{id} first, then ~/intent/{id}, then ~/.workspaces/{id}.
   * Defaults to WORKSPACES_BASE for new / not-yet-created workspaces.
   */
  static resolveWorkspaceRoot(id: string): string {
    // Fast path: virtual workspace IDs skip all disk lookups
    const workspacesBase = WorkspaceConfig.WORKSPACES_BASE;
    if (WorkspaceConfig.isVirtualWorkspace(id)) {
      return workspacesBase;
    }

    const currentRoot = WorkspaceConfig.WORKSPACE_ROOT;
    const legacyRoot = WorkspaceConfig.LEGACY_WORKSPACE_ROOT;
    const workspacesPath = path.join(workspacesBase, id);
    const currentPath = path.join(currentRoot, id);
    const legacyPath = path.join(legacyRoot, id);

    // Fast path: check the canonical ~/intent/workspaces/ location first
    if (fs.existsSync(workspacesPath)) {
      return workspacesBase;
    }
    // Check older ~/intent/{id} location
    if (fs.existsSync(currentPath)) {
      return currentRoot;
    }
    // Fall back to legacy ~/.workspaces root
    if (fs.existsSync(legacyPath)) {
      return legacyRoot;
    }

    // DEBUG: Log when workspace not found in any location
    // This helps diagnose race conditions during app startup
    console.warn(
      `[WorkspaceConfig] resolveWorkspaceRoot: workspace "${id}" not found in any location:`,
      { workspacesPath, currentPath, legacyPath },
    );

    // Default to canonical location for new workspaces
    return workspacesBase;
  }

  /**
   * Generate all paths for a workspace
   * Note: Using getters and arrow functions to ensure paths are evaluated lazily,
   * avoiding calls to getSafeHomeDir() at module load time when HOME might not be ready.
   */
  static paths = {
    /**
     * Base workspaces directory
     * Example: ~/intent
     */
    get base(): string {
      return WorkspaceConfig.WORKSPACE_ROOT;
    },

    /**
     * Root workspace folder (resolves to legacy ~/intent/{id} or ~/.workspaces/{id} if that's where it lives)
     * Example: ~/intent/workspaces/abc-123-def
     */
    workspace: (id: string): string => path.join(WorkspaceConfig.resolveWorkspaceRoot(id), id),

    /**
     * Hidden metadata folder (resolves to legacy locations if that's where it lives)
     * Example: ~/intent/workspaces/abc-123-def/.workspace
     */
    metadata: (id: string): string =>
      path.join(WorkspaceConfig.resolveWorkspaceRoot(id), id, WorkspaceConfig.METADATA_FOLDER),

    /**
     * Workspace metadata file
     * Example: ~/intent/workspaces/abc-123-def/.workspace/workspace.json
     */
    workspaceMetadata: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.WORKSPACE_METADATA_FILE),

    /**
     * Notes folder
     * Example: ~/intent/abc-123-def/.workspace/notes
     */
    notes: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.NOTES_FOLDER),

    /**
     * Specific note file
     * Example: ~/intent/abc-123-def/.workspace/notes/spec.md
     */
    note: (workspaceId: string, noteId: string): string =>
      path.join(
        WorkspaceConfig.paths.notes(workspaceId),
        `${noteId}${WorkspaceConfig.NOTE_FILE_EXTENSION}`,
      ),

    /**
     * Comments file for a note
     * Example: ~/intent/abc-123-def/.workspace/notes/spec.comments.json
     */
    comments: (workspaceId: string, noteId: string): string =>
      path.join(
        WorkspaceConfig.paths.notes(workspaceId),
        `${noteId}${WorkspaceConfig.COMMENTS_FILE_SUFFIX}`,
      ),

    /**
     * Agents folder
     * Example: ~/intent/abc-123-def/.workspace/agents
     */
    agents: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.AGENTS_FOLDER),

    /**
     * Diffs folder
     * Example: ~/intent/abc-123-def/.workspace/diffs
     */
    diffs: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.DIFFS_FOLDER),

    /**
     * Cache folder
     * Example: ~/intent/abc-123-def/.workspace/cache
     */
    cache: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.CACHE_FOLDER),

    /**
     * Assets folder (for images and other uploaded files)
     * Example: ~/intent/abc-123-def/.workspace/assets
     */
    assets: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.ASSETS_FOLDER),

    /**
     * Specific asset file
     * Example: ~/intent/abc-123-def/.workspace/assets/abc123.png
     */
    asset: (workspaceId: string, assetId: string): string =>
      path.join(WorkspaceConfig.paths.assets(workspaceId), assetId),

    /**
     * First visit state file
     * Example: ~/intent/abc-123-def/.workspace/first-visit-state.json
     */
    firstVisitState: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.FIRST_VISIT_STATE_FILE),

    /**
     * Panel layout history file
     * Example: ~/intent/abc-123-def/.workspace/panel-layout-history.json
     */
    panelLayoutHistory: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.PANEL_LAYOUT_HISTORY_FILE),

    /**
     * Browser snapshots folder
     * Example: ~/intent/abc-123-def/.workspace/browser-snapshots
     */
    browserSnapshots: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.BROWSER_SNAPSHOTS_FOLDER),

    /**
     * Browser snapshot session folder
     * Example: ~/intent/abc-123-def/.workspace/browser-snapshots/example.com/login-flow
     */
    browserSnapshotSession: (workspaceId: string, domain: string, sessionName: string): string =>
      path.join(WorkspaceConfig.paths.browserSnapshots(workspaceId), domain, sessionName),

    /**
     * Logs folder for workspace-specific logs
     * Example: ~/intent/abc-123-def/.workspace/logs
     */
    logs: (id: string): string =>
      path.join(WorkspaceConfig.paths.metadata(id), WorkspaceConfig.LOGS_FOLDER),

    /**
     * Git worktree folder with stable name (doesn't change when workspace is renamed)
     *
     * Default: ~/intent/workspaces/{id}/{folderName}
     * Custom:  {customBase}/{id}/{folderName}
     */
    worktree: (
      id: string,
      repoName?: string,
      workspaceName?: string,
      customBase?: string,
    ): string => {
      const folderName = WorkspaceConfig.generateWorktreeFolderName(repoName, workspaceName, id);
      const base =
        customBase || path.join(WorkspaceConfig.WORKSPACE_ROOT, WorkspaceConfig.WORKTREES_FOLDER);
      return path.join(base, id, folderName);
    },

    /**
     * Legacy worktree path for backward-compatible discovery of existing worktrees.
     * Checks ~/intent/{id}/{folderName} and ~/.workspaces/{id}/{folderName}.
     */
    legacyWorktree: (id: string, repoName?: string, workspaceName?: string): string => {
      const folderName = WorkspaceConfig.generateWorktreeFolderName(repoName, workspaceName, id);
      return path.join(WorkspaceConfig.resolveWorkspaceRoot(id), id, folderName);
    },
  };

  /**
   * Extract workspace ID from a path
   *
   * Examples:
   * - "/Users/user/intent/abc-123/notes" → "abc-123"
   * - "~/intent/abc-123/.workspace" → "abc-123"
   * - "/Users/user/.workspaces/abc-123/notes" → "abc-123" (legacy support)
   */
  static extractWorkspaceId(filePath: string): string | null {
    const normalized = filePath.replace(/^~/, getSafeHomeDir());
    const parts = normalized.split(path.sep);

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
}
