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
 * Fetch the daemon-resolved auto-commit state. Throws on wire failure;
 * a malformed response degrades to the built-in default (warn-logged).
 */
async function fetchWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const result = await backendRequest<{
    autoCommit?: { enabled?: unknown; source?: string };
  }>('workspace.getAutoCommit', { workspaceId });
  const enabled = result?.autoCommit?.enabled;
  if (typeof enabled === 'boolean') {
    return { autoCommitEnabled: enabled };
  }
  logger.warn('workspace.getAutoCommit returned a malformed response; using default', {
    workspaceId,
  });
  return { ...defaultSettings };
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
    return await fetchWorkspaceSettings(workspaceId);
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
 *
 * A `workspace.setAutoCommit` failure REJECTS (deliberately — callers must
 * not believe a write that never landed; the daemon returns -32602 for the
 * virtual Chief workspace, see PROTOCOL §5.1). If the set succeeds but the
 * read-back fails, the value just written is returned rather than the
 * default, so the caller never sees a value contradicting its own write.
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
    try {
      return await fetchWorkspaceSettings(workspaceId);
    } catch (error) {
      logger.warn('read-back after workspace.setAutoCommit failed; returning written value', {
        workspaceId,
        error: (error as Error).message,
      });
      return { autoCommitEnabled: settings.autoCommitEnabled };
    }
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
