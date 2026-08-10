/**
 * Centralized Configuration
 *
 * Constants and workspace-ID helpers for the main process.
 *
 * IMPORTANT: This file should only be imported in the main process (Node.js/Electron).
 * For renderer process, use IPC calls to get configuration values or import config-constants.ts.
 *
 * This module MUST NOT perform any filesystem access or derive workspace
 * directories from assumed roots (e.g. ~/intent, ~/.workspaces). Workspace
 * paths come exclusively from daemon-reported data via WorkspacePathService
 * (see src/features/workspace/main/workspace-path.service.ts); a regression
 * guard in __tests__/config.test.ts enforces this.
 */

import { WorkspaceConfigConstants } from '../config-constants';
import { CHIEF_WORKSPACE_ID } from '../types/branded-ids';

export class WorkspaceConfig extends WorkspaceConfigConstants {
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
}
