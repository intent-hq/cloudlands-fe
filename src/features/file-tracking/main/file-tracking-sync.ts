import type { FileTrackingSyncResult } from '../types';

export interface GitIntegrationForSync {
  syncCurrentState(force?: boolean): Promise<void>;
}

export interface FileTrackingSyncGlobals {
  gitIntegrations?: Map<string, GitIntegrationForSync>;
  gitIntegrationLocks?: Map<string, Promise<void>>;
}

interface SyncReadinessLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

const NOT_READY_CODE = 'GIT_INTEGRATION_NOT_READY' as const;

export async function syncGitIntegrationForWorkspace(
  workspaceId: string,
  force: boolean,
  globals: FileTrackingSyncGlobals = globalThis as FileTrackingSyncGlobals,
  logger?: SyncReadinessLogger,
): Promise<FileTrackingSyncResult> {
  let gitIntegration = globals.gitIntegrations?.get(workspaceId);

  if (!gitIntegration) {
    const initLock = globals.gitIntegrationLocks?.get(workspaceId);
    if (initLock) {
      logger?.debug('Waiting for git integration initialization before sync', { workspaceId });
      try {
        await initLock;
      } catch (error) {
        logger?.warn('Git integration initialization failed before sync', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      gitIntegration = globals.gitIntegrations?.get(workspaceId);
    }
  }

  if (!gitIntegration) {
    logger?.debug('No git integration found for workspace after readiness check', { workspaceId });
    return {
      success: false,
      notReady: true,
      code: NOT_READY_CODE,
      error: 'Git integration is not ready for this workspace',
    };
  }

  await gitIntegration.syncCurrentState(force);
  return { success: true, synced: true };
}