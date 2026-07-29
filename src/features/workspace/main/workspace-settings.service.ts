/**
 * Workspace Settings Service (Main Process)
 *
 * Thin daemon-backed accessor for workspace-level settings (auto-commit).
 *
 * The source of truth is the daemon's **persisted per-workspace override**
 * (PROTOCOL.md §5.1 `workspace.getAutoCommit` / `workspace.setAutoCommit`),
 * which the daemon resolves against the global `git.autoCommit` setting
 * (§5.12) when no override is set. The former renderer-synced in-memory map
 * is retired — reads and writes go straight to the daemon, so the value
 * survives app/daemon restarts and stays consistent with the daemon-side
 * commit gate.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger({ category: 'WorkspaceSettingsService' });

export interface WorkspaceSettings {
  /** Whether agents should auto-commit their changes when tasks complete */
  autoCommitEnabled: boolean;
}

const defaultSettings: WorkspaceSettings = {
  autoCommitEnabled: true, // Default to enabled (matches the daemon catalog default)
};

async function backendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  return (await getBackendClient().request(method, params)) as T;
}

/**
 * Get settings for a workspace from the daemon.
 *
 * Falls back to the built-in default (enabled) when the daemon is
 * unreachable or the workspace is unknown, matching the daemon's own
 * schema default for `git.autoCommit`.
 */
export async function getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings> {
  try {
    const result = await backendRequest<{
      autoCommit?: { enabled?: unknown; source?: string };
    }>('workspace.getAutoCommit', { workspaceId });
    const enabled = result?.autoCommit?.enabled;
    if (typeof enabled === 'boolean') {
      return { autoCommitEnabled: enabled };
    }
    return { ...defaultSettings };
  } catch (error) {
    logger.warn('workspace.getAutoCommit failed; using default', {
      workspaceId,
      error: (error as Error).message,
    });
    return { ...defaultSettings };
  }
}

/**
 * Update settings for a workspace — persists the per-workspace override in
 * the daemon (survives restarts; the daemon emits `workspace:updated`).
 */
export async function updateWorkspaceSettings(
  workspaceId: string,
  settings: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  if (settings.autoCommitEnabled !== undefined) {
    await backendRequest('workspace.setAutoCommit', {
      workspaceId,
      enabled: settings.autoCommitEnabled,
    });
    logger.info('Updated workspace settings', { workspaceId, settings });
  }
  return getWorkspaceSettings(workspaceId);
}

/**
 * Check if auto-commit is enabled for a workspace (daemon-resolved:
 * per-workspace override → global `git.autoCommit` fallback).
 */
export async function isAutoCommitEnabled(workspaceId: string): Promise<boolean> {
  return (await getWorkspaceSettings(workspaceId)).autoCommitEnabled;
}
