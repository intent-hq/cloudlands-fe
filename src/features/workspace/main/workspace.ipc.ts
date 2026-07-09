/**
 * Workspace IPC
 *
 * Thin IPC layer for workspace operations.
 * Handles communication between renderer and main process.
 */

import { createRequire } from 'module';
import {
  ipcMain,
  BrowserWindow,
} from 'electron';
import {
  sendToWorkspaceWindows,
  getFocusedWindowWorkspaceId,
} from '../../system/main/system.ipc';
import type { Result, CommandResponse, WorkspaceId } from '../../../shared/types';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';
import { changeDetectorManager as singletonChangeDetectorManager } from './change-detector-manager';
import { MetadataWatcherManager } from './metadata-watcher-manager';
import * as fs from 'fs/promises';

import { Logger } from '../../../shared/logger';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { workspaceFileChanges } from '../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice';
import { emitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';

import { WorkspaceConfig } from '../../../shared/main/config.js';
import { InstructionService } from '../../agent/main/instruction-service';
import { execAsync } from '../../../shared/git/git-env';
import { getNotificationService } from '../../notifications/main/notification.service';
import { GitService } from '../../git/main/git.service';
import { getWorkspaceGitInfo } from '../../git/main/git-router';
import { cleanupWorkspaceTerminals } from '../../terminal/main/terminal.ipc';
import { disposeScriptProcessManager } from '../../scripts/main/script-process-manager';
import { readScripts } from '../../scripts/main/scripts-persistence';
import {
  getUnifiedWatcher,
  shutdownUnifiedWatcher,
  shutdownOtherWatchers,
  type UnifiedWorkspaceWatcher,
} from './unified-workspace-watcher';
import { CHANGE_DETECTION_CONFIG } from './change-detection/detection.config';
import { isBinaryExtension } from '../../../shared/binary-file-extensions';
import {
  initRepoRegistry,
  getAllRepos,
  addRepo,
  removeRepo,
  syncRepos,
  clearRepos,
} from './repo-registry';
import { initChangeHistory } from './change-history-persistence';
import { initWorkspaceSettings } from './workspace-settings.service';
import {
  sshManager,
  type SSHConnectionConfig,
} from '../../../shared/main/ssh-manager';

import { clearMetadataFSCache } from '../../metadata-fs/main/metadata-fs-factory';
import { deleteEventStoreForWorkspace } from '../../../store/main/slices/workspace-events/sagas/persistence-saga';

const require = createRequire(import.meta.url);
import { validateIPCString } from '../../ipc/ipc-validation';
import {
  isValidBranchName,
  getBranchNameValidationError,
} from '../../../main/utils/workspace-validation';
import {
  WORKSPACE_CHANNELS,
  EDITOR_CHANNELS,
} from '$shared/ipc/channels';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  createSafeValidatedHandler,
  registerValidationSchema,
} from '../../../main/ipc-validation-middleware';
import {
  WorkspaceGetSchema,
  WorkspaceGetCurrentSchema,
  WorkspaceGetByIdSchema,
  WorkspaceUpdateSchema,
  WorkspaceDeleteSchema,
  WorkspaceCloseSchema,
  WorkspaceOpenSchema,
  WorkspaceRenameSchema,
  WorkspaceRenameBranchSchema,
  WorkspaceDuplicateSchema,
  WorkspaceArchiveSchema,
  WorkspaceUnarchiveSchema,
  WorkspaceCleanupSchema,
  WorkspacePurgeSchema,
  WorkspaceActivateSchema,
  WorkspaceGetRootSchema,
  WorkspaceGetMetadataSchema,
  WorkspaceUpdateMetadataSchema,
  WorkspaceSaveSchema,
  WorkspaceExportSchema,
  WorkspaceImportSchema,
  WorkspaceListSchema,
  WorkspaceTestWatcherSchema,
  WorkspaceGetRecentSchema,
  WorkspaceClearRecentSchema,
  WorkspaceGetStatsSchema,
  WorkspaceGetHoverStatusSchema,
  WorkspaceValidateSchema,
  WorkspacePreflightCloneCheckSchema,
  WorkspaceRepairSchema,
  WorkspaceBackupSchema,
  WorkspaceRestoreSchema,
  WorkspaceGetSettingsSchema,
  WorkspaceUpdateSettingsSchema,
  WorkspaceGetRecentRepositoriesSchema,
  WorkspaceAddRecentRepositorySchema,
  WorkspaceClearRecentRepositoriesSchema,
  WorkspaceRemoveRecentRepositorySchema,
  WorkspaceUpdateGitInfoSchema,
  WorkspaceGetSettingsAltSchema,
  WorkspaceUpdateSettingsAltSchema,
  WorkspaceLoadRulesSchema,
  WorkspaceFindRepositoriesSchema,
  EditorGetSelectionSchema,
  WorkspaceListFilesSchema,
  WorkspaceSearchInFilesSchema,
  WorkspaceTriggerCheckSchema,
  WorkspaceUpdateSpecWatcherTimestampSchema,
  WorkspaceUpdateCurrentContextSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('WorkspaceIPC');

const editorRefreshUnsubscribers = new Map<string, () => void>();

// Use the singleton change detector manager instance
const changeDetectorManager = singletonChangeDetectorManager;

/**
 * Initialize the change detector manager
 * This should be called once when the app starts
 */
let listenerSetUp = false;

export function initializeChangeDetectorManager() {
  // The change detector manager is already initialized as a singleton
  if (!changeDetectorManager) {
    logger.error('ChangeDetectorManager singleton not available!');
    return changeDetectorManager;
  }

  // Set up listener only once
  if (!listenerSetUp) {
    listenerSetUp = true;
    logger.info('Setting up workspace-changes listener');

    // Set up listener to forward workspace:changes events to renderer
    // Note: Activity log events are now created in change-detector.ts with proper provenance
    // This listener just broadcasts the diffChunk for backward compatibility
    changeDetectorManager.on('workspace-changes', (data: any) => {
      // Add null check to prevent "Cannot read properties of undefined" error
      if (!data) {
        logger.warn('Received workspace-changes event with undefined data');
        return;
      }

      const { workspaceId, diffChunk } = data;

      // Broadcast workspace:file-changes
      mainDispatch(
        workspaceFileChanges({
          workspaceId,
          diffChunk,
        }),
      );

      // Also send to renderer processes for this workspace
      sendToWorkspaceWindows(workspaceId, 'workspace-changes', {
        workspaceId,
        diffChunk,
      });
    });

    // Bridge activity-log-event from change detectors into Redux.
    // EventCoordinator → ChangeDetectorRefactored → ChangeDetectorManager → here.
    // We dispatch emitWorkspaceEvent to Redux (workspace-events slice).
    changeDetectorManager.on('activity-log-event', (data: any) => {
      if (!data?.event) {
        logger.warn('Received activity-log-event with missing event data');
        return;
      }
      mainDispatch(emitWorkspaceEvent(data.event));
    });

    // git:commit-created is now handled by domain-event-listener-sagas.ts
    // (handleGitCommitCreatedForFileTracking)
  }

  return changeDetectorManager;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert Result type to CommandResponse type for IPC
 */
function resultToCommandResponse<T>(result: Result<T, string>): CommandResponse<T> {
  if (result.ok) {
    return {
      success: true,
      data: result.data,
    };
  } else {
    return {
      success: false,
      error: result.error,
    };
  }
}

function unsubscribeEditorRefreshSubscriber(workspaceId: string): void {
  const unsubscribe = editorRefreshUnsubscribers.get(workspaceId);
  if (!unsubscribe) return;

  try {
    unsubscribe();
    logger.info('[WorkspaceIPC] Unsubscribed editor refresh watcher', { workspaceId });
  } catch (error) {
    logger.warn('[WorkspaceIPC] Failed to unsubscribe editor refresh watcher', error as Error, {
      workspaceId,
    });
  } finally {
    editorRefreshUnsubscribers.delete(workspaceId);
  }
}

function registerEditorRefreshSubscriber(
  workspaceId: string,
  watcher: UnifiedWorkspaceWatcher,
): void {
  if (!watcher.getStats().isRunning) {
    logger.debug('[WorkspaceIPC] Skipping editor refresh subscriber; watcher is not running', {
      workspaceId,
    });
    return;
  }

  const unsubscribe = watcher.subscribe({
    id: `editor-refresh:${workspaceId}`,
    pathPatterns: ['**'],
    eventTypes: ['change', 'add'],
    callback: (event) => {
      if (event.type !== 'change' && event.type !== 'add') return;
      if (isBinaryExtension(event.relativePath)) return;

      sendToWorkspaceWindows(workspaceId, 'watcher:file-changed', {
        workspaceId,
        path: event.path,
        relativePath: event.relativePath,
        type: event.type,
      });
    },
  });

  editorRefreshUnsubscribers.set(workspaceId, unsubscribe);
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupWorkspaceIPC(): void {
  // Initialize the persistent repo registry
  initRepoRegistry().catch((err) => logger.error('Failed to init repo registry', err as Error));

  // Hydrate the daemon-owned git.autoCommit into the workspace-settings cache
  // (the sync API falls back to the default until this resolves).
  initWorkspaceSettings().catch((err) =>
    logger.error('Failed to init workspace settings', err as Error),
  );

  // Initialize the persistent change history cache
  initChangeHistory().catch((err) =>
    logger.error('Failed to init change history', err as Error),
  );

  // Register validation schemas for all workspace channels
  registerValidationSchema(WORKSPACE_CHANNELS.GET, WorkspaceGetSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_CURRENT, WorkspaceGetCurrentSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.UPDATE, WorkspaceUpdateSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.DELETE, WorkspaceDeleteSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.CLOSE, WorkspaceCloseSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.OPEN, WorkspaceOpenSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.RENAME, WorkspaceRenameSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.RENAME_BRANCH, WorkspaceRenameBranchSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.DUPLICATE, WorkspaceDuplicateSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.ARCHIVE, WorkspaceArchiveSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.UNARCHIVE, WorkspaceUnarchiveSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.CLEANUP, WorkspaceCleanupSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.PURGE, WorkspacePurgeSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.ACTIVATE, WorkspaceActivateSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_ROOT, WorkspaceGetRootSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_METADATA, WorkspaceGetMetadataSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.UPDATE_METADATA, WorkspaceUpdateMetadataSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.SAVE, WorkspaceSaveSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.EXPORT, WorkspaceExportSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.IMPORT, WorkspaceImportSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.LIST, WorkspaceListSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.TEST_WATCHER, WorkspaceTestWatcherSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_RECENT, WorkspaceGetRecentSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.CLEAR_RECENT, WorkspaceClearRecentSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_STATS, WorkspaceGetStatsSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_HOVER_STATUS, WorkspaceGetHoverStatusSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.VALIDATE, WorkspaceValidateSchema);
  registerValidationSchema(
    WORKSPACE_CHANNELS.PREFLIGHT_CLONE_CHECK,
    WorkspacePreflightCloneCheckSchema,
  );
  registerValidationSchema(WORKSPACE_CHANNELS.REPAIR, WorkspaceRepairSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.BACKUP, WorkspaceBackupSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.RESTORE, WorkspaceRestoreSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_SETTINGS, WorkspaceGetSettingsSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.UPDATE_SETTINGS, WorkspaceUpdateSettingsSchema);
  registerValidationSchema(
    WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
    WorkspaceGetRecentRepositoriesSchema,
  );
  registerValidationSchema(
    WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY,
    WorkspaceAddRecentRepositorySchema,
  );
  registerValidationSchema(
    WORKSPACE_CHANNELS.CLEAR_RECENT_REPOSITORIES,
    WorkspaceClearRecentRepositoriesSchema,
  );
  registerValidationSchema(
    WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
    WorkspaceRemoveRecentRepositorySchema,
  );
  registerValidationSchema(WORKSPACE_CHANNELS.UPDATE_GIT_INFO, WorkspaceUpdateGitInfoSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_SETTINGS_ALT, WorkspaceGetSettingsAltSchema);
  registerValidationSchema(
    WORKSPACE_CHANNELS.UPDATE_SETTINGS_ALT,
    WorkspaceUpdateSettingsAltSchema,
  );

  // Test handler for metadata watcher
  ipcMain.handle(
    WORKSPACE_CHANNELS.TEST_WATCHER,
    createSafeValidatedHandler(
      WorkspaceTestWatcherSchema,
      async (_, validated) => {
        try {
          const workspace = await protocolAdapter.getWorkspace(validated.workspaceId);
          if (!workspace) {
            return { success: false, error: 'Workspace not found' };
          }

          const metadataPath = WorkspaceConfig.paths.metadata(validated.workspaceId);

          logger.info('Testing metadata watcher', {
            workspaceId: validated.workspaceId,
            metadataPath,
            worktreePath: workspace.worktreePath,
            exists: await fs
              .access(metadataPath)
              .then(() => true)
              .catch(() => false),
          });

          const metadataWatcher = MetadataWatcherManager.getInstance();
          await metadataWatcher.stopWatching(validated.workspaceId);
          await metadataWatcher.startWatching(validated.workspaceId, metadataPath);

          return {
            success: true,
            metadataPath,
            worktreePath: workspace.worktreePath,
            message: 'Watcher restarted - check logs for file change events',
          };
        } catch (error) {
          logger.error('Test watcher failed', error as Error);
          return { success: false, error: String(error) };
        }
      },
      WORKSPACE_CHANNELS.TEST_WATCHER,
    ),
  );
  logger.info('Setting up workspace IPC handlers');

  // List workspaces - use backward compatible method
  ipcMain.handle(
    WORKSPACE_CHANNELS.LIST,
    createSafeValidatedHandler(
      WorkspaceListSchema,
      async (_, validated) => {
        // Pass lite option to skip heavy computations when requested
        const result = await protocolAdapter.listAllWorkspaces({ lite: validated?.lite });
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.LIST,
    ),
  );

  // Workspace creation is owned by the daemon: the FE routes `workspace.create`
  // through `appClient.workspaces.create` (PROTOCOL §5.1); the legacy
  // `workspace:create` IPC arm was retired with the daemon-direct cut-over.

  // Preflight: verify a GitHub URL is reachable and authenticated before clone
  ipcMain.handle(
    WORKSPACE_CHANNELS.PREFLIGHT_CLONE_CHECK,
    createSafeValidatedHandler(
      WorkspacePreflightCloneCheckSchema,
      async (_, validated) => {
        const result = await protocolAdapter.preflightCloneCheck(validated);
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.PREFLIGHT_CLONE_CHECK,
    ),
  );

  // Get workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET,
    createSafeValidatedHandler(
      WorkspaceGetSchema,
      async (_, validated) => {
        // Protocol adapter now returns data directly for MCP compatibility
        const workspace = await protocolAdapter.getWorkspace(validated.id);

        // Convert to Result format for frontend
        if (workspace) {
          return resultToCommandResponse({ ok: true, data: workspace });
        } else {
          return resultToCommandResponse({ ok: false, error: 'Workspace not found' });
        }
      },
      WORKSPACE_CHANNELS.GET,
    ),
  );

  // Get the current workspace for the calling window
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_CURRENT,
    createSafeValidatedHandler(
      WorkspaceGetCurrentSchema,
      async (event) => {
        // Determine workspace ID from the sender window
        const senderWindow = BrowserWindow.fromWebContents(event.sender);
        const workspaceId = senderWindow ? getFocusedWindowWorkspaceId() : undefined;

        if (!workspaceId) {
          return resultToCommandResponse({
            ok: false,
            error: 'No active workspace for this window',
          });
        }

        const workspace = await protocolAdapter.getWorkspace(workspaceId);
        if (workspace) {
          return resultToCommandResponse({ ok: true, data: workspace });
        } else {
          return resultToCommandResponse({ ok: false, error: 'Workspace not found' });
        }
      },
      WORKSPACE_CHANNELS.GET_CURRENT,
    ),
  );

  // Get workspace by ID (alias for workspace:get with workspaceId parameter)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_BY_ID,
    createSafeValidatedHandler(
      WorkspaceGetByIdSchema,
      async (_, validated) => {
        // Protocol adapter now returns data directly for MCP compatibility
        const workspace = await protocolAdapter.getWorkspace(validated.workspaceId);

        // Convert to Result format for frontend
        if (workspace) {
          return resultToCommandResponse({ ok: true, data: workspace });
        } else {
          return resultToCommandResponse({ ok: false, error: 'Workspace not found' });
        }
      },
      WORKSPACE_CHANNELS.GET_BY_ID,
    ),
  );

  // Get workspace root path
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_ROOT,
    createSafeValidatedHandler(
      WorkspaceGetRootSchema,
      async (_, validated) => {
        try {
          return WorkspaceConfig.paths.workspace(validated.workspaceId);
        } catch (error) {
          logger.error('Failed to get workspace root', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return null;
        }
      },
      WORKSPACE_CHANNELS.GET_ROOT,
    ),
  );

  // Close workspace and stop monitoring
  ipcMain.handle(
    WORKSPACE_CHANNELS.CLOSE,
    createSafeValidatedHandler(
      WorkspaceCloseSchema,
      async (_, validated) => {
        const id = validated.id;
        logger.info('[WorkspaceIPC] Closing workspace', { workspaceId: id });

        try {
          // Stop change detector monitoring
          if (changeDetectorManager) {
            try {
              await changeDetectorManager.stopMonitoring(id);
              logger.info('[WorkspaceIPC] Stopped change detector monitoring', { workspaceId: id });
            } catch (error) {
              logger.warn('[WorkspaceIPC] Failed to stop change detector', error as Error, {
                workspaceId: id,
              });
            }
          }

          // Stop metadata watcher
          const metadataManager = MetadataWatcherManager.getInstance();
          if (metadataManager) {
            try {
              await metadataManager.stopWatching(id);
              logger.info('[WorkspaceIPC] Stopped metadata watcher', { workspaceId: id });
            } catch (error) {
              logger.warn('[WorkspaceIPC] Failed to stop metadata watcher', error as Error, {
                workspaceId: id,
              });
            }
          }

          // Clear MetadataFS cache so it's re-created on next open
          clearMetadataFSCache();

          // Shut down unified workspace watcher (after other watchers that depend on it)
          unsubscribeEditorRefreshSubscriber(id);
          try {
            await shutdownUnifiedWatcher(id);
            logger.info('[WorkspaceIPC] Shut down unified workspace watcher', { workspaceId: id });
          } catch (error) {
            logger.warn('[WorkspaceIPC] Failed to shut down unified watcher', error as Error, {
              workspaceId: id,
            });
          }

          // Stop project specialist file watcher
          try {
            const { updateProjectWatcher } = await import(
              '../../specialists/main/specialist-file-watcher'
            );
            await updateProjectWatcher(undefined, id);
            logger.info('[WorkspaceIPC] Stopped project specialist file watcher', { workspaceId: id });
          } catch (error) {
            logger.warn('[WorkspaceIPC] Failed to stop project specialist file watcher', error as Error, {
              workspaceId: id,
            });
          }


          // Clean up notification service
          try {
            const { disposeNotificationService } =
              await import('../../notifications/main/notification.service');
            disposeNotificationService(id);
            logger.debug('[WorkspaceIPC] Notification service cleanup', { workspaceId: id });
          } catch (error) {
            logger.debug('[WorkspaceIPC] Notification service cleanup not available', { error });
          }

          // Stop all running scripts and dispose ScriptProcessManager
          try {
            await disposeScriptProcessManager(id);
            logger.info('[WorkspaceIPC] Script process manager disposed', { workspaceId: id });
          } catch (error) {
            logger.warn('[WorkspaceIPC] Failed to dispose script process manager', error as Error, {
              workspaceId: id,
            });
          }

          // Clean up agent context registry to prevent memory leaks
          try {
            const { getAgentContextRegistry } = await import('../../agent/agent-context-registry');
            const registry = getAgentContextRegistry();
            const clearedCount = registry.clearForWorkspace(id);
            if (clearedCount > 0) {
              logger.debug('[WorkspaceIPC] Agent context registry cleanup', {
                workspaceId: id,
                clearedCount,
              });
            }
          } catch (error) {
            logger.debug('[WorkspaceIPC] Agent context registry cleanup not available', { error });
          }

          // Clean up cached EventStore (flush pending writes, free events + indexes)
          try {
            await deleteEventStoreForWorkspace(id);
            logger.debug('[WorkspaceIPC] EventStore cache cleanup', { workspaceId: id });
          } catch (error) {
            logger.warn('[WorkspaceIPC] Failed to cleanup EventStore cache', error as Error, {
              workspaceId: id,
            });
          }

          return resultToCommandResponse({ ok: true, data: null });
        } catch (error) {
          logger.error('[WorkspaceIPC] Failed to close workspace', error as Error, {
            workspaceId: id,
          });
          return resultToCommandResponse({ ok: false, error: 'Failed to close workspace' });
        }
      },
      WORKSPACE_CHANNELS.CLOSE,
    ),
  );

  // Open workspace and start monitoring for changes
  //
  // ⚠️  IMPORTANT: This handler has critical side effects beyond just "opening" the workspace:
  //    1. Starts ChangeDetectorManager monitoring (git polling for file changes)
  //    2. Warms caches / starts notification and scripts services
  //
  // Without these side effects, the UI will NOT receive file change updates,
  // causing the activity log and changed files list to appear empty.
  //
  // The backend is IDEMPOTENT - it checks if monitoring is already running before starting,
  // so it's safe to call this multiple times for the same workspace.
  //
  // DO NOT add optimizations that skip calling this handler - always call workspace:open
  // when navigating to a workspace to ensure all listeners are properly initialized.
  //
  ipcMain.handle(
    WORKSPACE_CHANNELS.OPEN,
    createSafeValidatedHandler(
      WorkspaceOpenSchema,
      async (_, validated) => {
        const id = validated.id;
        const startTime = Date.now();
        logger.info('[WorkspaceIPC] Opening workspace', { workspaceId: id });

        // Shut down native @parcel/watcher subscriptions for any previously-open
        // workspace BEFORE we do anything else.  Under high memory pressure, multiple
        // concurrent native watcher subscriptions can cause @parcel/watcher's C++ layer
        // to throw an unrecoverable Napi::Error (libc++abi termination) that kills the
        // entire process.  Doing this first frees native resources and greatly reduces
        // the chance of a native crash during the rest of the open flow.
        try {
          await shutdownOtherWatchers(id);
        } catch (error) {
          logger.warn('[WorkspaceIPC] Failed to shut down other watchers', error as Error, {
            workspaceId: id,
          });
        }

        // Get workspace - protocol adapter now returns data directly for MCP compatibility
        const getWorkspaceStart = Date.now();
        const workspace = await protocolAdapter.getWorkspace(id);
        logger.info('[WorkspaceIPC] Got workspace', {
          workspaceId: id,
          hasWorkspace: !!workspace,
          worktreePath: workspace?.worktreePath,
          repositoryPath: workspace?.repositoryPath,
          durationMs: Date.now() - getWorkspaceStart,
        });

        // Check if workspace exists (not null)
        if (workspace) {
          // Attribution is owned by the daemon (§17.4 / §5.19); no FE-side
          // agent-writes cache to warm here.
          const manager = initializeChangeDetectorManager();
          logger.info('[WorkspaceIPC] Got change detector manager', { workspaceId: id });

          // Convert workspace to WorkspaceInfo format for change detector
          // Use worktreePath if available, otherwise use repositoryPath for both
          const workspaceInfo = {
            id: workspace.id,
            worktreePath: workspace.worktreePath || workspace.repositoryPath,
            repositoryPath: workspace.repositoryPath || workspace.worktreePath,
            environmentConfig: workspace.environmentConfig,
          };

          // Initialize the unified workspace watcher early, before other watchers that
          // depend on it. This creates a single @parcel/watcher instance for the entire workspace.
          // Skip for remote workspaces — the worktree path doesn't exist locally.
          const isRemote = !!workspace.isRemote && !!workspace.environmentConfig?.ssh;
          const worktreePath = workspace.worktreePath || workspace.repositoryPath;
          if (worktreePath && !isRemote) {
            if (
              CHANGE_DETECTION_CONFIG.gitPollingOnly ||
              CHANGE_DETECTION_CONFIG.disableFileWatcher
            ) {
              logger.info('[WorkspaceIPC] Skipping native file watcher (git polling mode)', {
                workspaceId: id,
              });
            } else {
              try {
                const watcher = await getUnifiedWatcher(id, worktreePath);
                registerEditorRefreshSubscriber(id, watcher);
              } catch (error) {
                logger.warn('[WorkspaceIPC] Failed to start native file watcher', error as Error, {
                  workspaceId: id,
                });
              }
            }
          } else if (isRemote) {
            logger.info(
              '[WorkspaceIPC] Skipping UnifiedWorkspaceWatcher for remote workspace',
              {
                workspaceId: id,
              },
            );
          }

          // PERFORMANCE OPTIMIZATION: Start all background initialization without blocking
          // The workspace is usable immediately - monitoring, git integration, etc. initialize
          // in the background and will be ready by the time the user needs them.

          // Start metadata watcher (fast, doesn't need to wait)
          const metadataWatcherPromise = (async () => {
            try {
              const metadataWatcher = MetadataWatcherManager.getInstance();

              // Stop any existing watcher first (in case of re-opening)
              await metadataWatcher.stopWatching(id);

              // Get the correct metadata path (not the worktree path!)
              const metadataPath = WorkspaceConfig.paths.metadata(id);

              // Start fresh watcher with the correct metadata path
              await metadataWatcher.startWatching(id, metadataPath);
              logger.info('Started metadata file watcher for workspace', {
                workspaceId: id,
                metadataPath,
                worktreePath: workspace.worktreePath,
              });
            } catch (error) {
              logger.error('Failed to start metadata watcher for workspace', error as Error, {
                workspaceId: id,
              });
              // Don't fail the workspace open, just log the error
            }
          })();

          // Start monitoring in background - DON'T WAIT for it
          // This is the main performance optimization - monitoring can take several seconds
          // but the workspace should be usable immediately
          const monitoringAndGitPromise = (async () => {
            try {
              // For remote workspaces, keep the SSH connection warmed so later
              // remote operations reuse it. The legacy deploy+serve step has
              // retired; the daemon's WSS transport will attach here later.
              // TODO(P3-5): attach daemon WSS transport via `rpc-${workspace.id}`.
              if (workspace.environmentConfig?.ssh) {
                try {
                  const ssh = workspace.environmentConfig.ssh;
                  const sshConfig: SSHConnectionConfig = {
                    host: ssh.host,
                    port: ssh.port || 22,
                    username: ssh.user,
                    privateKeyPath: ssh.key_path,
                    password: ssh.password,
                    useAgent: ssh.use_agent,
                    transport: ssh.transport as 'ssh' | 'websocket' | undefined,
                    wsUrl: ssh.ws_url,
                  };

                  const rpcConnectionId = `rpc-${workspace.id}`;
                  await sshManager.connect(rpcConnectionId, sshConfig);
                } catch (err) {
                  // Non-fatal — monitoring will still start; git integration will retry via auto-sync timer
                  logger.warn('Failed to establish SSH connection during workspace open', {
                    workspaceId: workspace.id,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              const monitoringStart = Date.now();
              logger.info('[WorkspaceIPC] Starting background monitoring for workspace', {
                workspaceId: id,
                worktreePath: workspace.worktreePath,
                repositoryPath: workspace.repositoryPath,
              });
              await manager.startMonitoring(workspaceInfo as any);
              logger.info('[WorkspaceIPC] Background monitoring started for workspace', {
                workspaceId: id,
                durationMs: Date.now() - monitoringStart,
              });

              // Activity log promise (event service removed — Redux handles events now)
              const activityLogPromise = (async () => {
                try {
                  logger.info('Activity log initialization skipped (Redux-based)', {
                    workspaceId: id,
                  });
                } catch (error) {
                  logger.error('Failed to initialize activity log', error as Error, {
                    workspaceId: id,
                  });
                }
              })();

              // Cache warming promise - pre-warm system prompt cache for faster agent creation
              const cacheWarmingPromise = (async () => {
                try {
                  const worktreePath = workspace.worktreePath || workspace.repositoryPath;
                  if (worktreePath) {
                    const instructionService = InstructionService.getInstance();
                    await instructionService.warmCache(worktreePath);
                  }
                } catch (error) {
                  // Don't fail workspace open if cache warming fails
                  logger.warn('Failed to warm system prompt cache', { error, workspaceId: id });
                }
              })();

              // Initialize notification service for this workspace
              const notificationServicePromise = (async () => {
                try {
                  const notificationService = getNotificationService(id);
                  notificationService.start();
                  logger.info('Notification service started', { workspaceId: id });
                } catch (error) {
                  logger.error('Failed to start notification service', error as Error, {
                    workspaceId: id,
                  });
                }
              })();

              // Initialize workspace scripts: clean stale PIDs and start autoStart services
              const scriptsInitPromise = (async () => {
                try {
                  const { getScriptProcessManager } =
                    await import('../../scripts/main/script-process-manager');
                  const scriptsWorkspacePath = workspace.worktreePath || workspace.repositoryPath;
                  if (!scriptsWorkspacePath) return;

                  const scriptsMetadataPath = WorkspaceConfig.paths.metadata(id);
                  const manager = getScriptProcessManager(
                    id,
                    scriptsWorkspacePath,
                    scriptsMetadataPath,
                  );

                  // Clean up stale PIDs from previous sessions
                  manager.cleanupStalePids();

                  // Load scripts and start autoStart services
                  const scripts = await readScripts(id);
                  const autoStartScripts = scripts.filter(
                    (s) => s.autoStart && s.mode === 'service',
                  );

                  if (autoStartScripts.length > 0) {
                    logger.info('[WorkspaceIPC] Starting autoStart scripts', {
                      workspaceId: id,
                      count: autoStartScripts.length,
                      names: autoStartScripts.map((s) => s.name),
                    });
                    for (const script of autoStartScripts) {
                      manager.start(script);
                    }
                  }
                } catch (error) {
                  logger.warn('[WorkspaceIPC] Failed to initialize scripts', error as Error, {
                    workspaceId: id,
                  });
                }
              })();

              // Start watching project specialist files for live reload
              const specialistWatcherPromise = (async () => {
                try {
                  const specialistWorktreePath = workspace.worktreePath || workspace.repositoryPath;
                  if (specialistWorktreePath) {
                    const { updateProjectWatcher } = await import(
                      '../../specialists/main/specialist-file-watcher'
                    );
                    await updateProjectWatcher(specialistWorktreePath, id);
                    logger.info('[WorkspaceIPC] Started project specialist file watcher', {
                      workspaceId: id,
                    });
                  }
                } catch (error) {
                  logger.warn('[WorkspaceIPC] Failed to start specialist file watcher', error as Error, {
                    workspaceId: id,
                  });
                }
              })();

              // Wait for ALL to complete in parallel
              await Promise.all([
                activityLogPromise,
                cacheWarmingPromise,
                notificationServicePromise,
                scriptsInitPromise,
                specialistWatcherPromise,
              ]);

              logger.info('[WorkspaceIPC] Background initialization complete', {
                workspaceId: id,
                totalDurationMs: Date.now() - monitoringStart,
              });
            } catch (error) {
              logger.error(
                '[WorkspaceIPC] Failed to start background monitoring for workspace',
                error as Error,
                {
                  workspaceId: id,
                  errorMessage: (error as Error).message,
                  errorStack: (error as Error).stack,
                },
              );
            }
          })();

          // Spec-note seeding is owned by the daemon (`workspace.create` runs
          // `ensure_spec_note`); the FE no longer performs FS-level orphan
          // recovery on open.

          // Only wait for metadata watcher (fast) - let monitoring run in background
          await metadataWatcherPromise;

          // Fire and forget the background initialization
          // Use void to explicitly indicate we're not awaiting this
          void monitoringAndGitPromise;

          logger.info('[WorkspaceIPC] Workspace open returning immediately', {
            workspaceId: id,
            totalDurationMs: Date.now() - startTime,
          });

          // Return in Result format for the frontend
          return resultToCommandResponse({ ok: true, data: workspace });
        } else {
          // Workspace not found or error
          return resultToCommandResponse({ ok: false, error: 'Workspace not found' });
        }
      },
      WORKSPACE_CHANNELS.OPEN,
    ),
  );

  // Update workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.UPDATE,
    createSafeValidatedHandler(
      WorkspaceUpdateSchema,
      async (_, validated) => {
        const result = await protocolAdapter.updateWorkspace(validated);

        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.UPDATE,
    ),
  );

  // Delete workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.DELETE,
    createSafeValidatedHandler(
      WorkspaceDeleteSchema,
      async (_, validated) => {
        const validatedId = validated.id;
        logger.info('Deleting workspace', { workspaceId: validatedId });

        // Stop monitoring and clear history before deleting
        const manager = changeDetectorManager;
        if (manager) {
          try {
            await manager.stopMonitoring(validatedId);
            // PERF: Clear change history for deleted workspace to prevent memory bloat
            manager.clearHistory(validatedId);
            logger.debug('Stopped monitoring and cleared history for workspace', {
              workspaceId: validatedId,
            });
          } catch (error) {
            logger.error('Failed to stop monitoring for workspace', error as Error, {
              workspaceId: validatedId,
            });
          }
        }

        // Stop metadata file watcher
        try {
          const metadataWatcher = MetadataWatcherManager.getInstance();
          await metadataWatcher.stopWatching(validatedId);
          logger.debug('Stopped metadata file watcher for workspace', { workspaceId: validatedId });
        } catch (error) {
          logger.error('Failed to stop metadata watcher for workspace', error as Error, {
            workspaceId: validatedId,
          });
        }

        // Clear MetadataFS cache for deleted workspace
        clearMetadataFSCache();

        // Shut down unified workspace watcher
        unsubscribeEditorRefreshSubscriber(validatedId);
        try {
          await shutdownUnifiedWatcher(validatedId);
          logger.debug('Shut down unified workspace watcher', { workspaceId: validatedId });
        } catch (error) {
          logger.warn('Failed to shut down unified watcher during delete', error as Error, {
            workspaceId: validatedId,
          });
        }

        // Clean up notification service
        try {
          const { disposeNotificationService } =
            await import('../../notifications/main/notification.service');
          disposeNotificationService(validatedId);
          logger.debug('Notification service cleanup before delete', {
            workspaceId: validatedId,
          });
        } catch (error) {
          logger.debug('Notification service cleanup not available before delete', { error });
        }

        // Clean up agent context registry
        try {
          const { getAgentContextRegistry } = await import('../../agent/agent-context-registry');
          const registry = getAgentContextRegistry();
          const clearedCount = registry.clearForWorkspace(validatedId);
          if (clearedCount > 0) {
            logger.debug('Agent context registry cleanup before delete', {
              workspaceId: validatedId,
              clearedCount,
            });
          }
        } catch (error) {
          logger.debug('Agent context registry cleanup not available before delete', { error });
        }

        // Stop all running scripts and dispose ScriptProcessManager before delete
        try {
          await disposeScriptProcessManager(validatedId);
          logger.debug('Script process manager disposed before delete', {
            workspaceId: validatedId,
          });
        } catch (error) {
          logger.warn('Failed to dispose script process manager before delete', error as Error, {
            workspaceId: validatedId,
          });
        }

        // Clean up cached EventStore (flush pending writes, free events + indexes)
        try {
          await deleteEventStoreForWorkspace(validatedId);
          logger.debug('EventStore cache cleanup before delete', { workspaceId: validatedId });
        } catch (error) {
          logger.warn('Failed to cleanup EventStore cache before delete', error as Error, {
            workspaceId: validatedId,
          });
        }

        const result = await protocolAdapter.deleteWorkspace(validatedId);
        logger.debug('Delete result', { workspaceId: validatedId, result });

        // Clean up workspace terminals AFTER successful delete
        // (disposes PTY processes and notifies renderer)
        if (result.ok) {
          try {
            await cleanupWorkspaceTerminals(validatedId as WorkspaceId);
            logger.debug('Terminal cleanup after delete', { workspaceId: validatedId });
          } catch (error) {
            logger.warn('Failed to cleanup terminals after delete', error as Error, {
              workspaceId: validatedId,
            });
          }
        }

        const response = resultToCommandResponse(result);
        return response;
      },
      WORKSPACE_CHANNELS.DELETE,
    ),
  );

  // Duplicate workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.DUPLICATE,
    createSafeValidatedHandler(
      WorkspaceDuplicateSchema,
      async (_, validated) => {
        logger.info('Duplicating workspace', {
          workspaceId: validated.id,
          newTitle: validated.newTitle,
        });
        const result = await protocolAdapter.duplicateWorkspace({
          id: validated.id,
          newTitle: validated.newTitle,
        });
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.DUPLICATE,
    ),
  );

  // Archive workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.ARCHIVE,
    createSafeValidatedHandler(
      WorkspaceArchiveSchema,
      async (_, validated) => {
        const validatedId = validated.id;
        logger.info('Archiving workspace', { workspaceId: validatedId });

        // Stop monitoring for archived workspace to save resources
        const manager = changeDetectorManager;
        if (manager) {
          try {
            await manager.stopMonitoring(validatedId);
            logger.debug('Stopped monitoring for archived workspace', {
              workspaceId: validatedId,
            });
          } catch (error) {
            logger.error('Failed to stop monitoring for workspace', error as Error, {
              workspaceId: validatedId,
            });
          }
        }

        // Clean up cached EventStore (flush pending writes, free events + indexes)
        try {
          await deleteEventStoreForWorkspace(validatedId);
          logger.debug('EventStore cache cleanup for archived workspace', {
            workspaceId: validatedId,
          });
        } catch (error) {
          logger.warn('Failed to cleanup EventStore cache during archive', error as Error, {
            workspaceId: validatedId,
          });
        }

        const result = await protocolAdapter.archiveWorkspace(validatedId);

        // Clean up workspace terminals AFTER successful archive
        // (disposes PTY processes and notifies renderer)
        if (result.ok) {
          try {
            await cleanupWorkspaceTerminals(validatedId as WorkspaceId);
            logger.debug('Terminal cleanup after archive', { workspaceId: validatedId });
          } catch (error) {
            logger.warn('Failed to cleanup terminals after archive', error as Error, {
              workspaceId: validatedId,
            });
          }
        }

        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.ARCHIVE,
    ),
  );

  // Unarchive workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.UNARCHIVE,
    createSafeValidatedHandler(
      WorkspaceUnarchiveSchema,
      async (_, validated) => {
        const result = await protocolAdapter.unarchiveWorkspace(validated.id);
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.UNARCHIVE,
    ),
  );

  // Cleanup workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.CLEANUP,
    createSafeValidatedHandler(
      WorkspaceCleanupSchema,
      async (_, validated) => {
        const id = validated.id;
        // Cleanup activity log and git tracking
        try {
          // Clean up event service if needed
          // Note: Event service cleanup is handled automatically
          logger.info('Cleaned up activity log and git tracking', { workspaceId: id });
        } catch (error) {
          logger.error('Failed to cleanup activity log', error as Error, {
            workspaceId: id,
          });
        }

        const result = await protocolAdapter.cleanupWorkspace(id);
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.CLEANUP,
    ),
  );

  // Purge deleted workspaces - permanently removes deleted workspaces and orphan directories
  ipcMain.handle(
    WORKSPACE_CHANNELS.PURGE,
    createSafeValidatedHandler(
      WorkspacePurgeSchema,
      async () => {
        logger.info('Purging deleted workspaces');
        const result = await protocolAdapter.purgeDeletedWorkspaces();
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.PURGE,
    ),
  );

  // Save workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.SAVE,
    createSafeValidatedHandler(
      WorkspaceSaveSchema,
      async (_, validated) => {
        logger.warn('workspace:save not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.SAVE,
    ),
  );

  // Activate workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.ACTIVATE,
    createSafeValidatedHandler(
      WorkspaceActivateSchema,
      async (_, validated) => {
        logger.warn('workspace:activate not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.ACTIVATE,
    ),
  );

  // Rename workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.RENAME,
    createSafeValidatedHandler(
      WorkspaceRenameSchema,
      async (_, validated) => {
        logger.warn('workspace:rename not yet implemented', {
          id: validated.id,
          newName: validated.newName,
        });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.RENAME,
    ),
  );

  // Rename workspace branch
  ipcMain.handle(
    WORKSPACE_CHANNELS.RENAME_BRANCH,
    createSafeValidatedHandler(
      WorkspaceRenameBranchSchema,
      async (_, validated) => {
        const workspaceId = validated.id;
        const newBranchName = validated.newBranchName?.trim();

        logger.info('Renaming workspace branch', {
          workspaceId,
          newBranchName,
        });

        // Early validation: check branch name format before doing any work
        if (!newBranchName) {
          return resultToCommandResponse({
            ok: false,
            error: 'Branch name cannot be empty',
          });
        }

        if (!isValidBranchName(newBranchName)) {
          const validationError = getBranchNameValidationError(newBranchName);
          return resultToCommandResponse({
            ok: false,
            error: validationError || 'Invalid branch name format',
          });
        }

        try {
          // Get the current workspace to find the old branch name
          const workspace = await protocolAdapter.getWorkspace(workspaceId);
          if (!workspace) {
            return resultToCommandResponse({ ok: false, error: 'Workspace not found' });
          }

          const oldBranchName = workspace.branch;
          if (!oldBranchName) {
            return resultToCommandResponse({ ok: false, error: 'Workspace has no branch' });
          }

          // No-op if renaming to the same name
          if (oldBranchName === newBranchName) {
            return resultToCommandResponse({ ok: true, data: workspace });
          }

          // Create GitService instance to rename the branch
          const gitService = new GitService();

          // Get the ACTUAL current git branch name from the worktree
          // (The workspace.branch is the display name, which may differ from the actual git branch)
          const currentBranchResult = await gitService.getCurrentBranch(workspaceId as WorkspaceId);
          if (!currentBranchResult.ok) {
            return resultToCommandResponse({
              ok: false,
              error: currentBranchResult.error || 'Failed to get current git branch',
            });
          }
          const actualGitBranch = currentBranchResult.data;

          logger.info('Git branch info', {
            workspaceId,
            displayBranch: oldBranchName,
            actualGitBranch,
            newBranchName,
          });

          // Rename the git branch (includes duplicate/worktree checks)
          const renameResult = await gitService.renameBranch(
            workspaceId as WorkspaceId,
            actualGitBranch,
            newBranchName,
          );

          if (!renameResult.ok) {
            return resultToCommandResponse({
              ok: false,
              error: renameResult.error,
            });
          }

          // Update the workspace metadata with the new branch name
          const updateResult = await protocolAdapter.updateWorkspace({
            id: workspaceId,
            branch: newBranchName,
          });

          if (!updateResult.ok) {
            logger.error('Failed to update workspace branch metadata', {
              workspaceId,
              error: updateResult.error,
            });
            return resultToCommandResponse({
              ok: false,
              error: `Failed to update workspace metadata: ${updateResult.error}`,
            });
          }

          logger.info('Workspace branch renamed successfully', {
            workspaceId,
            oldBranch: oldBranchName,
            newBranch: newBranchName,
          });

          return resultToCommandResponse({ ok: true, data: updateResult.data });
        } catch (error) {
          logger.error('Failed to rename workspace branch', error as Error, {
            workspaceId: validated.id,
          });
          return resultToCommandResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to rename workspace branch',
          });
        }
      },
      WORKSPACE_CHANNELS.RENAME_BRANCH,
    ),
  );

  // Export workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.EXPORT,
    createSafeValidatedHandler(
      WorkspaceExportSchema,
      async (_, validated) => {
        logger.warn('workspace:export not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.EXPORT,
    ),
  );

  // Import workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.IMPORT,
    createSafeValidatedHandler(
      WorkspaceImportSchema,
      async (_, validated) => {
        logger.warn('workspace:import not yet implemented', { data: validated.data });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.IMPORT,
    ),
  );

  // Get workspace metadata (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_METADATA,
    createSafeValidatedHandler(
      WorkspaceGetMetadataSchema,
      async (_, validated) => {
        logger.warn('workspace:get-metadata not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.GET_METADATA,
    ),
  );

  // Update workspace metadata (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.UPDATE_METADATA,
    createSafeValidatedHandler(
      WorkspaceUpdateMetadataSchema,
      async (_, validated) => {
        logger.warn('workspace:update-metadata not yet implemented', {
          id: validated.id,
          metadata: validated.metadata,
        });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.UPDATE_METADATA,
    ),
  );

  // Get recent workspaces (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_RECENT,
    createSafeValidatedHandler(
      WorkspaceGetRecentSchema,
      async () => {
        logger.warn('workspace:get-recent not yet implemented');
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.GET_RECENT,
    ),
  );

  // Clear recent workspaces (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.CLEAR_RECENT,
    createSafeValidatedHandler(
      WorkspaceClearRecentSchema,
      async () => {
        logger.warn('workspace:clear-recent not yet implemented');
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.CLEAR_RECENT,
    ),
  );

  // Get workspace stats (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_STATS,
    createSafeValidatedHandler(
      WorkspaceGetStatsSchema,
      async (_, validated) => {
        logger.warn('workspace:get-stats not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.GET_STATS,
    ),
  );

  // Get workspace hover status for hover cards
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_HOVER_STATUS,
    createSafeValidatedHandler(
      WorkspaceGetHoverStatusSchema,
      async (_, validated) => {
        try {
          const workspaceId = validated.workspaceId as WorkspaceId;

          // Get git status for file changes - route to remote if needed
          let changesStats = { uncommitted: 0, staged: 0, unstaged: 0 };
          const lineStats = { additions: 0, deletions: 0 };

          const gitInfo = await getWorkspaceGitInfo(workspaceId);
          if (gitInfo?.isRemote) {
            // Remote hover git status retired in P3-5; leave the default zero
            // counts so remote-configured workspaces don't attempt to route
            // through the deleted remote stack.
          } else {
            // Local workspace: use GitService
            const gitService = new GitService();
            const gitResult = await gitService.getStatus(workspaceId);

            if (gitResult.ok && gitResult.data) {
              const gitStatus = gitResult.data;
              // Count files by staged status
              const files = gitStatus.files || [];
              const stagedFiles = files.filter((f) => f.staged);
              const unstagedFiles = files.filter((f) => !f.staged);

              changesStats = {
                uncommitted: files.length,
                staged: stagedFiles.length,
                unstaged: unstagedFiles.length,
              };
            }
          }

          // Line stats require a separate diff call - for now return 0
          // as we don't have additions/deletions on GitStatus

          // Return the status summary
          const status = {
            workspaceId,
            taskStats: {
              total: 0,
              completed: 0,
              inProgress: 0,
            },
            changesStats,
            lineStats,
            notesStats: {
              total: 0,
              hasSpecContent: false,
            },
            computedAt: new Date().toISOString(),
          };

          return resultToCommandResponse({ ok: true, data: status });
        } catch (error) {
          logger.error('Failed to get hover status', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return resultToCommandResponse({ ok: false, error: 'Failed to get hover status' });
        }
      },
      WORKSPACE_CHANNELS.GET_HOVER_STATUS,
    ),
  );

  // Validate workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.VALIDATE,
    createSafeValidatedHandler(
      WorkspaceValidateSchema,
      async (_, validated) => {
        logger.warn('workspace:validate not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.VALIDATE,
    ),
  );

  // Repair workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.REPAIR,
    createSafeValidatedHandler(
      WorkspaceRepairSchema,
      async (_, validated) => {
        logger.warn('workspace:repair not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.REPAIR,
    ),
  );

  // Backup workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.BACKUP,
    createSafeValidatedHandler(
      WorkspaceBackupSchema,
      async (_, validated) => {
        logger.warn('workspace:backup not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.BACKUP,
    ),
  );

  // Restore workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.RESTORE,
    createSafeValidatedHandler(
      WorkspaceRestoreSchema,
      async (_, validated) => {
        logger.warn('workspace:restore not yet implemented', {
          id: validated.id,
          backupPath: validated.backupPath,
        });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.RESTORE,
    ),
  );

  // Get workspace settings
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_SETTINGS,
    createSafeValidatedHandler(
      WorkspaceGetSettingsSchema,
      async (_, validated) => {
        const { getWorkspaceSettings } = await import('./workspace-settings.service');
        const settings = getWorkspaceSettings(validated.id);
        return resultToCommandResponse({ ok: true, data: settings });
      },
      WORKSPACE_CHANNELS.GET_SETTINGS,
    ),
  );

  // Update workspace settings
  ipcMain.handle(
    WORKSPACE_CHANNELS.UPDATE_SETTINGS,
    createSafeValidatedHandler(
      WorkspaceUpdateSettingsSchema,
      async (_, validated) => {
        const { updateWorkspaceSettings } = await import('./workspace-settings.service');
        const updated = updateWorkspaceSettings(validated.id, validated.settings);
        return resultToCommandResponse({ ok: true, data: updated });
      },
      WORKSPACE_CHANNELS.UPDATE_SETTINGS,
    ),
  );

  // Get recent repositories (persistent repo registry)
  // On first call, kicks off a background sync of workspace repos into the registry
  let repoRegistrySynced = false;
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
    createSafeValidatedHandler(
      WorkspaceGetRecentRepositoriesSchema,
      async () => {
        // Return known repos immediately — don't block on the sync
        const repos = getAllRepos();

        // One-time background sync: register repos from existing workspaces into the persistent registry
        // This ensures pre-existing workspaces (created before this feature) get registered
        // Runs in the background so it doesn't slow down the response
        if (!repoRegistrySynced) {
          repoRegistrySynced = true;
          protocolAdapter
            .listAllWorkspaces({ lite: true })
            .then((result) => {
              if (result.ok && result.data) {
                const reposToSync = result.data
                  .filter((ws: any) => ws.repositoryPath)
                  .map((ws: any) => ({
                    path: ws.repositoryPath,
                    name: ws.repositoryName || ws.repositoryPath.split('/').pop() || 'Unknown',
                    owner: ws.repositoryOwner,
                  }));
                if (reposToSync.length > 0) {
                  syncRepos(reposToSync);
                }
              }
            })
            .catch((err) => {
              logger.warn('Failed to sync workspace repos to registry', { error: err });
            });
        }

        return { success: true, data: repos };
      },
      WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
    ),
  );

  // Add recent repository (persistent repo registry)
  ipcMain.handle(
    WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY,
    createSafeValidatedHandler(
      WorkspaceAddRecentRepositorySchema,
      async (_, validated) => {
        addRepo({
          path: validated.repository,
          name: validated.name || validated.repository.split('/').pop() || 'Unknown',
          owner: validated.owner,
        });
        return { success: true };
      },
      WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY,
    ),
  );

  // Clear recent repositories (persistent repo registry)
  ipcMain.handle(
    WORKSPACE_CHANNELS.CLEAR_RECENT_REPOSITORIES,
    createSafeValidatedHandler(
      WorkspaceClearRecentRepositoriesSchema,
      async () => {
        clearRepos();
        return { success: true };
      },
      WORKSPACE_CHANNELS.CLEAR_RECENT_REPOSITORIES,
    ),
  );

  // Remove a single recent repository (persistent repo registry)
  ipcMain.handle(
    WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
    createSafeValidatedHandler(
      WorkspaceRemoveRecentRepositorySchema,
      async (_, validated) => {
        const removed = removeRepo(validated.repository);
        return { success: true, data: { removed } };
      },
      WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
    ),
  );

  // Update git info (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.UPDATE_GIT_INFO,
    createSafeValidatedHandler(
      WorkspaceUpdateGitInfoSchema,
      async (_, validated) => {
        logger.warn('workspace:update_git_info not yet implemented', {
          id: validated.id,
          gitInfo: validated.gitInfo,
        });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.UPDATE_GIT_INFO,
    ),
  );

  // Get settings (alternative channel - stub)
  ipcMain.handle(
    WORKSPACE_CHANNELS.GET_SETTINGS_ALT,
    createSafeValidatedHandler(
      WorkspaceGetSettingsAltSchema,
      async (_, validated) => {
        logger.warn('workspace:getSettings not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.GET_SETTINGS_ALT,
    ),
  );

  // Update settings (alternative channel - stub)
  ipcMain.handle(
    WORKSPACE_CHANNELS.UPDATE_SETTINGS_ALT,
    createSafeValidatedHandler(
      WorkspaceUpdateSettingsAltSchema,
      async (_, validated) => {
        logger.warn('workspace:updateSettings not yet implemented', {
          id: validated.id,
          settings: validated.settings,
        });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.UPDATE_SETTINGS_ALT,
    ),
  );

  // Load rules (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.LOAD_RULES,
    createSafeValidatedHandler(
      WorkspaceLoadRulesSchema,
      async (_, validated) => {
        logger.warn('workspace:load-rules not yet implemented', { id: validated.id });
        return resultToCommandResponse({ ok: false, error: 'Not yet implemented' });
      },
      WORKSPACE_CHANNELS.LOAD_RULES,
    ),
  );

  // Find repositories
  ipcMain.handle(
    WORKSPACE_CHANNELS.FIND_REPOSITORIES,
    createSafeValidatedHandler(
      WorkspaceFindRepositoriesSchema,
      async (_, validated) => {
        const result = await protocolAdapter.findRepositories(validated.directory || '');
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.FIND_REPOSITORIES,
    ),
  );

  // Discover repos from editors, CLI agents, and filesystem
  ipcMain.handle('workspace:discover-repos', async () => {
    try {
      const { discoverRepos } = await import('./repo-discovery.service');
      const repos = await discoverRepos();
      return { success: true, data: repos };
    } catch (error) {
      logger.error('Failed to discover repos', error as Error);
      return { success: false, data: [] };
    }
  });

  // Get editor selection
  ipcMain.handle(
    EDITOR_CHANNELS.GET_SELECTION,
    createSafeValidatedHandler(
      EditorGetSelectionSchema,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (event, validated) => {
        try {
          // Try to get the actual selection from the webContents
          const webContents = event.sender;

          // Execute JavaScript in the renderer to get the selected text
          const selection = await webContents
            .executeJavaScript(
              `
        (() => {
          const selection = window.getSelection();
          if (selection && selection.toString()) {
            // Try to find the active editor element
            const activeElement = document.activeElement;
            const codeEditor = document.querySelector('.monaco-editor') ||
                             document.querySelector('.code-editor') ||
                             document.querySelector('textarea');

            // Get file path from editor context if available
            let filePath = null;
            let language = null;

            // Try to get file info from the editor component
            const fileTab = document.querySelector('.tab.active .tab-title') ||
                          document.querySelector('.editor-tab.active');
            if (fileTab) {
              filePath = fileTab.getAttribute('data-path') || fileTab.textContent;
            }

            // Try to detect language from classes or data attributes
            const langElement = document.querySelector('[data-language]') ||
                              document.querySelector('[class*="language-"]');
            if (langElement) {
              const langClass = Array.from(langElement.classList).find(c => c.startsWith('language-'));
              if (langClass) {
                language = langClass.replace('language-', '');
              } else {
                language = langElement.getAttribute('data-language');
              }
            }

            return {
              text: selection.toString(),
              file: filePath,
              language: language,
              range: null // Would need more complex logic to get line numbers
            };
          }
          return null;
        })()
      `,
            )
            .catch(() => null);

          if (selection && selection.text) {
            logger.info('Got editor selection', {
              hasText: !!selection.text,
              file: selection.file,
            });
            return selection;
          }

          // No selection found, return null instead of mock data
          return null;
        } catch (error) {
          logger.error('Failed to get editor selection', error as Error);
          return null;
        }
      },
      EDITOR_CHANNELS.GET_SELECTION,
    ),
  );

  // List files in workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.LIST_FILES,
    createSafeValidatedHandler(
      WorkspaceListFilesSchema,
      async (_, validated) => {
        try {
          const { workspaceId, pattern, limit } = validated;

          if (workspaceId === ROOT_WORKSPACE_ID || workspaceId === 'new') {
            return { files: [], folders: [] };
          }

          const { promises: fs } = require('fs');
          const path = require('path');

          logger.info('workspace:list-files called with:', {
            workspaceId,
            pattern,
            limit,
          });

          // Get the workspace to find its actual path
          const res = await protocolAdapter.getWorkspace(workspaceId);
          // Accept both direct object and Result-like wrapper
          let workspace: any | null = null;
          if (res && typeof res === 'object') {
            if ('ok' in res) {
              if ((res as any).ok && (res as any).data) workspace = (res as any).data;
            } else {
              workspace = res as any;
            }
          }

          const isRemote = !!workspace?.isRemote && !!workspace?.environmentConfig?.ssh;

          if (!workspace) {
            logger.warn(
              'Workspace not found (or adapter returned unexpected shape), trying direct path',
              { workspaceId, res },
            );

            // If workspaceId is actually a path, use it directly
            if (workspaceId && (workspaceId.startsWith('/') || workspaceId.includes(':'))) {
              const workspacePath = workspaceId;

              // Check if directory exists
              try {
                await fs.access(workspacePath);

                const entries = await fs.readdir(workspacePath, { withFileTypes: true });
                logger.info('Directory entries found', {
                  path: workspacePath,
                  totalEntries: entries.length,
                  entries: entries.slice(0, 5).map((e: any) => ({
                    name: e.name,
                    isFile: e.isFile(),
                    isDir: e.isDirectory(),
                  })),
                });

                const maxResults = typeof limit === 'number' && limit > 0 ? limit : 50;

                let files: Array<{
                  name: string;
                  path: string;
                  relativePath: string;
                  type: 'file';
                }> = [];
                let folders: Array<{
                  name: string;
                  path: string;
                  relativePath: string;
                  type: 'directory';
                }> = [];

                if (pattern && String(pattern).trim().length > 0) {
                  const IGNORE = new Set([
                    '.git',
                    'node_modules',
                    'dist',
                    'build',
                    'out',
                    'coverage',
                    '.cache',
                    '.next',
                    'target',
                    'bazel-out',
                    'bazel-bin',
                    'bazel-testlogs',
                  ]);
                  const needle = String(pattern).toLowerCase();
                  const queue: string[] = [workspacePath];

                  while (queue.length && files.length < maxResults) {
                    const dir = queue.shift();
                    if (dir === undefined) break;
                    let ents: any[] = [];
                    try {
                      ents = await fs.readdir(dir, { withFileTypes: true });
                    } catch {
                      continue;
                    }
                    for (const entry of ents) {
                      const name = entry.name;
                      if (entry.isDirectory()) {
                        if (IGNORE.has(name) || name === '.' || name === '..') continue;
                        const full = path.join(dir, name);
                        if (name.startsWith('.') && name !== '.vscode') continue;
                        queue.push(full);
                      } else if (entry.isFile()) {
                        const full = path.join(dir, name);
                        const rel = full.startsWith(workspacePath + '/')
                          ? full.slice(workspacePath.length + 1)
                          : full === workspacePath
                            ? ''
                            : name;
                        const relLower = rel.toLowerCase();
                        if (
                          !needle ||
                          name.toLowerCase().includes(needle) ||
                          relLower.includes(needle)
                        ) {
                          files.push({ name, path: full, relativePath: rel, type: 'file' });
                          if (files.length >= maxResults) break;
                        }
                      }
                    }
                  }
                } else {
                  // Non-pattern: return shallow listing
                  files = entries
                    .filter((entry: any) => entry.isFile())
                    .map((entry: any) => ({
                      name: entry.name,
                      path: path.join(workspacePath, entry.name),
                      relativePath: entry.name,
                      type: 'file',
                    }));

                  folders = entries
                    .filter((entry: any) => entry.isDirectory() && !entry.name.startsWith('.'))
                    .map((entry: any) => ({
                      name: entry.name,
                      path: path.join(workspacePath, entry.name),
                      relativePath: entry.name,
                      type: 'directory',
                    }));

                  files = files.slice(0, maxResults);
                  folders = folders.slice(0, maxResults);
                }

                logger.info('Returning files/folders from direct path', {
                  path: workspacePath,
                  fileCount: files.length,
                  folderCount: folders.length,
                });

                return { files, folders };
              } catch (err) {
                logger.warn('Failed to access direct path', { workspacePath, error: err });
              }
            }

            return { files: [], folders: [] };
          }

          // Try different path options in order of preference
          const workspacePath =
            workspace.worktreePath || workspace.repositoryPath || workspace.path;

          if (!workspacePath) {
            logger.warn('No valid path found for workspace', { workspaceId, workspace });
            return { files: [] };
          }

          // Apply scope if present
          const scopePath = workspace.scope;
          let listingPath = workspacePath;
          if (scopePath) {
            listingPath = path.join(workspacePath, scopePath);
            logger.info('Applying scope to workspace path', {
              workspacePath,
              scope: scopePath,
              listingPath,
            });
          }

          const maxResults = typeof limit === 'number' && limit > 0 ? limit : 50;

          // ──── Remote workspace: legacy RPC retired ────
          // Directory listing and pattern search over the legacy remote RPC has
          // retired. Return an empty result until the daemon's WSS transport
          // lands and can serve `fs.listDir`/`fs.find`.
          // TODO(P3-5): route via daemon `fs.listDir`/`fs.find` over WSS transport.
          if (isRemote) {
            void listingPath;
            void maxResults;
            void pattern;
            logger.info(
              'workspace:list-files: skipping remote listing; legacy RPC retired',
              { workspaceId },
            );
            return { files: [], folders: [] };
          }

          // ──── Local workspace: use local fs ────
          // Check if directory exists first
          try {
            await fs.access(listingPath);
          } catch {
            logger.warn('Workspace directory does not exist, returning empty list', {
              listingPath,
            });
            return { files: [] };
          }

          const entries = await fs.readdir(listingPath, { withFileTypes: true });
          logger.info('Directory entries found (workspace lookup)', {
            path: listingPath,
            totalEntries: entries.length,
            entries: entries
              .slice(0, 5)
              .map((e: any) => ({ name: e.name, isFile: e.isFile(), isDir: e.isDirectory() })),
          });

          let files = entries
            .filter((entry: any) => entry.isFile())
            .map((entry: any) => ({
              name: entry.name,
              path: path.join(listingPath, entry.name),
              relativePath: entry.name,
              type: 'file',
            }));

          // Also get directories for the folders submenu
          let folders = entries
            .filter((entry: any) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry: any) => ({
              name: entry.name,
              path: path.join(listingPath, entry.name),
              relativePath: entry.name,
              type: 'directory',
            }));

          if (pattern && String(pattern).trim().length > 0) {
            const needle = String(pattern).toLowerCase();
            const filteredFiles = files.filter(
              (file: any) =>
                (file.name || '').toLowerCase().includes(needle) ||
                (file.relativePath || '').toLowerCase().includes(needle),
            );
            const filteredFolders = folders.filter(
              (folder: any) =>
                (folder.name || '').toLowerCase().includes(needle) ||
                (folder.relativePath || '').toLowerCase().includes(needle),
            );

            // If shallow listing didn't find anything, do a fast recursive BFS filename search
            if (filteredFiles.length === 0) {
              const { promises: fs } = require('fs');
              const IGNORE = new Set([
                '.git',
                'node_modules',
                'dist',
                'build',
                'out',
                'coverage',
                '.cache',
                '.next',
                'target',
                'bazel-out',
                'bazel-bin',
                'bazel-testlogs',
              ]);
              const queue: string[] = [listingPath];
              const results: any[] = [];
              while (queue.length && results.length < maxResults) {
                const dir = queue.shift();
                if (dir === undefined) break;
                let ents: any[] = [];
                try {
                  ents = await fs.readdir(dir, { withFileTypes: true });
                } catch {
                  continue;
                }
                for (const entry of ents) {
                  const name = entry.name;
                  if (entry.isDirectory()) {
                    if (IGNORE.has(name) || name === '.' || name === '..') continue;
                    if (name.startsWith('.') && name !== '.vscode') continue;
                    queue.push(require('path').join(dir, name));
                  } else if (entry.isFile()) {
                    const full = require('path').join(dir, name);
                    const rel = require('path').relative(listingPath, full);
                    const relLower = (rel || '').toLowerCase();
                    if ((name || '').toLowerCase().includes(needle) || relLower.includes(needle)) {
                      results.push({ name, path: full, relativePath: rel, type: 'file' });
                      if (results.length >= maxResults) break;
                    }
                  }
                }
              }
              files = results;
              folders = [];
            } else {
              files = filteredFiles.slice(0, maxResults);
              folders = filteredFolders.slice(0, maxResults);
            }
          } else {
            files = files.slice(0, maxResults);
            folders = folders.slice(0, maxResults);
          }

          logger.info('Returning files/folders from workspace lookup', {
            workspaceId,
            path: listingPath,
            scope: scopePath,
            fileCount: files.length,
            folderCount: folders.length,
            firstFiles: files.slice(0, 3).map((f: any) => f.name),
            firstFolders: folders.slice(0, 3).map((f: any) => f.name),
          });

          return { files, folders };
        } catch (error) {
          logger.error('Failed to list workspace files', error as Error);
          return { files: [], folders: [] };
        }
      },
      WORKSPACE_CHANNELS.LIST_FILES,
    ),
  );

  // Search text in workspace files
  ipcMain.handle(
    WORKSPACE_CHANNELS.SEARCH_IN_FILES,
    createSafeValidatedHandler(
      WorkspaceSearchInFilesSchema,
      async (_, validated) => {
        try {
          const { workspaceId, query, limit } = validated;

          // Validate query
          const queryValidation = validateIPCString(query, 'Search query', 500);
          if (!queryValidation.valid) {
            logger.warn('Invalid search query', { query, error: queryValidation.error });
            return [];
          }

          const path = require('path');

          const maxResults = typeof limit === 'number' && limit > 0 ? limit : 50;

          // Resolve workspace path and check if remote
          const res = await protocolAdapter.getWorkspace(workspaceId);
          let workspacePath: string | null = null;
          let isRemote = false;

          if (res && typeof res === 'object') {
            let w: any = res;
            if ('ok' in (w as any)) {
              w = (w as any).ok ? (w as any).data : null;
            }
            if (w) {
              workspacePath = w.worktreePath || w.repositoryPath || w.path || null;
              isRemote = !!w.isRemote && !!w.environmentConfig?.ssh;
            }
          }
          if (
            !workspacePath &&
            workspaceId &&
            (workspaceId.startsWith('/') || workspaceId.includes(':'))
          ) {
            workspacePath = workspaceId;
          }

          if (!workspacePath) {
            logger.warn('workspace:search-in-files: no workspace path', { workspaceId });
            return [];
          }

          // Try ripgrep first; fallback to grep/findstr
          const sanitize = (s: string) => String(s).replace(/"/g, '\\"');
          const q = sanitize(query || '');
          if (!q) return [];

          let stdout = '';

          // Remote in-files search over the legacy RPC has retired. Skip the
          // remote branch and return an empty result until the daemon's WSS
          // transport lands.
          // TODO(P3-5): route via daemon `fs.grep` over WSS transport.
          if (isRemote && workspaceId) {
            logger.info(
              'workspace:search-in-files: skipping remote search; legacy RPC retired',
              { workspaceId },
            );
            return [];
          }

          const execSearchCommand = async (cmd: string): Promise<string> => {
            const result = await execAsync(cmd, {
              cwd: workspacePath,
              maxBuffer: 20 * 1024 * 1024,
            });
            return result.stdout || '';
          };

          try {
            const cmd = `rg -n --hidden --no-ignore -S -F -g "!node_modules" -g "!.git" "${q}" "${workspacePath}"`;
            stdout = await execSearchCommand(cmd);
          } catch {
            // Fallbacks - for remote, only use grep (no Windows findstr)
            try {
              const grepCmd = `grep -RIn --exclude-dir={.git,node_modules} -e "${q}" "${workspacePath}"`;
              stdout = await execSearchCommand(grepCmd);
            } catch (e2: any) {
              stdout = e2?.stdout || '';
            }
          }

          const lines = String(stdout).split(/\r?\n/).filter(Boolean);
          const out: Array<{ path: string; fileName: string; line: number; match: string }> = [];

          for (const line of lines) {
            // Match "path:line:content" (rg/grep) or "path(line):content" (some findstr variants)
            let m = /^(.+?):(\d+):(.*)$/.exec(line);
            if (!m) m = /^(.+?)\((\d+)\):(.*)$/.exec(line);
            if (!m) continue;
            const filePath = m[1];
            const lineNum = parseInt(m[2], 10);
            const match = (m[3] || '').trim();
            const absPath = path.isAbsolute(filePath)
              ? filePath
              : path.join(workspacePath, filePath);
            out.push({ path: absPath, fileName: path.basename(absPath), line: lineNum, match });
            if (out.length >= maxResults) break;
          }

          return out;
        } catch (error) {
          logger.error('Failed workspace:search-in-files', error as Error);
          return [];
        }
      },
      WORKSPACE_CHANNELS.SEARCH_IN_FILES,
    ),
  );

  ipcMain.handle(
    WORKSPACE_CHANNELS.UPDATE_SPEC_WATCHER_TIMESTAMP,
    createSafeValidatedHandler(
      WorkspaceUpdateSpecWatcherTimestampSchema,
      async (_, validated) => {
        try {
          logger.debug('Updating spec watcher timestamp', { workspaceId: validated.workspaceId });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
      WORKSPACE_CHANNELS.UPDATE_SPEC_WATCHER_TIMESTAMP,
    ),
  );

  // Trigger immediate git check when workspace gains focus or files are edited
  ipcMain.handle(
    WORKSPACE_CHANNELS.TRIGGER_CHECK,
    createSafeValidatedHandler(
      WorkspaceTriggerCheckSchema,
      async (_, validated) => {
        const { workspaceId, reason } = validated;
        logger.info('[WorkspaceIPC] workspace:trigger-check called:', { workspaceId, reason });
        try {
          const manager = initializeChangeDetectorManager();
          if (manager) {
            // Check if detector exists for this workspace
            const detector = manager.getChangeDetector(workspaceId);
            if (!detector) {
              // Detector doesn't exist - need to start monitoring first
              logger.info('[WorkspaceIPC] No detector for workspace, starting monitoring', {
                workspaceId,
              });

              // Get workspace info to start monitoring
              const workspace = await protocolAdapter.getWorkspace(workspaceId);
              if (workspace && (workspace.worktreePath || workspace.repositoryPath)) {
                const workspaceInfo = {
                  id: workspace.id,
                  worktreePath: workspace.worktreePath || workspace.repositoryPath,
                  repositoryPath: workspace.repositoryPath || workspace.worktreePath,
                  environmentConfig: workspace.environmentConfig,
                };

                // Start monitoring (this will initialize the detector)
                await manager.startMonitoring(workspaceInfo as any);
                logger.info('[WorkspaceIPC] Started monitoring for workspace', { workspaceId });
              } else {
                logger.warn('[WorkspaceIPC] Cannot start monitoring - workspace has no path', {
                  workspaceId,
                  hasWorkspace: !!workspace,
                });
                return { ok: false, error: 'Workspace has no path' };
              }
            }

            logger.info('[WorkspaceIPC] Calling manager.triggerImmediateCheck');
            manager.triggerImmediateCheck(workspaceId, reason || 'manual');
          } else {
            logger.warn('[WorkspaceIPC] No change detector manager available');
          }
          return { ok: true };
        } catch (error) {
          logger.error('[WorkspaceIPC] Failed to trigger immediate check', error as Error, {
            workspaceId,
            reason,
          });
          return { ok: false, error: (error as Error).message };
        }
      },
      WORKSPACE_CHANNELS.TRIGGER_CHECK,
    ),
  );

  // Update current context
  ipcMain.handle(
    WORKSPACE_CHANNELS.UPDATE_CURRENT_CONTEXT,
    createSafeValidatedHandler(
      WorkspaceUpdateCurrentContextSchema,
      async (_, validated) => {
        try {
          // Removed debug log - too frequent
          const result = await protocolAdapter.updateCurrentContext({
            workspaceId: validated.workspaceId,
            context: validated.context,
          });
          return result.ok ? { ok: true } : { ok: false, error: result.error };
        } catch (error) {
          logger.error('Failed to update current context', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return { ok: false, error: (error as Error).message };
        }
      },
      WORKSPACE_CHANNELS.UPDATE_CURRENT_CONTEXT,
    ),
  );

  logger.info('Workspace IPC handlers setup complete');
}
