/**
 * Workspace IPC
 *
 * Thin IPC layer for workspace operations.
 * Handles communication between renderer and main process.
 */

import { createRequire } from 'module';
import { ipcMain, BrowserWindow } from 'electron';
import { getFocusedWindowWorkspaceId } from '../../system/main/system.ipc';
import { m } from '$shared/paraglide/messages.js';
import type { Result, CommandResponse, WorkspaceId } from '../../../shared/types';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';

import { Logger } from '../../../shared/logger';

import { WorkspaceConfig } from '../../../shared/main/config.js';
import { InstructionService } from '../../agent/main/instruction-service';
import { execFileAsync } from '../../../shared/git/git-env';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { cleanupWorkspaceTerminals } from '../../terminal/main/terminal.ipc';
import { disposeScriptProcessManager } from '../../scripts/main/script-process-manager';
import { readScripts } from '../../scripts/main/scripts-persistence';
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

import { clearMetadataFSCache } from '../../metadata-fs/main/metadata-fs-factory';
import { deleteEventStoreForWorkspace } from '../../../store/main/slices/workspace-events/sagas/persistence-saga';

const require = createRequire(import.meta.url);
import { validateIPCString } from '../../ipc/ipc-validation';
import {
  isValidBranchName,
  getBranchNameValidationError,
} from '../../../main/utils/workspace-validation';
import { WORKSPACE_CHANNELS, EDITOR_CHANNELS } from '$shared/ipc/channels';
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
  WorkspaceActivateSchema,
  WorkspaceGetRootSchema,
  WorkspaceGetMetadataSchema,
  WorkspaceUpdateMetadataSchema,
  WorkspaceSaveSchema,
  WorkspaceExportSchema,
  WorkspaceImportSchema,
  WorkspaceListSchema,
  WorkspaceGetRecentSchema,
  WorkspaceClearRecentSchema,
  WorkspaceGetStatsSchema,
  WorkspaceGetHoverStatusSchema,
  WorkspaceValidateSchema,
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
  WorkspaceUpdateSpecWatcherTimestampSchema,
  WorkspaceUpdateCurrentContextSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('WorkspaceIPC');

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
  initChangeHistory().catch((err) => logger.error('Failed to init change history', err as Error));

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
  registerValidationSchema(WORKSPACE_CHANNELS.ACTIVATE, WorkspaceActivateSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_ROOT, WorkspaceGetRootSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_METADATA, WorkspaceGetMetadataSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.UPDATE_METADATA, WorkspaceUpdateMetadataSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.SAVE, WorkspaceSaveSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.EXPORT, WorkspaceExportSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.IMPORT, WorkspaceImportSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.LIST, WorkspaceListSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_RECENT, WorkspaceGetRecentSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.CLEAR_RECENT, WorkspaceClearRecentSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_STATS, WorkspaceGetStatsSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.GET_HOVER_STATUS, WorkspaceGetHoverStatusSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.VALIDATE, WorkspaceValidateSchema);
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

  // Metadata watcher retired alongside the workspace disk-read path; the
  // legacy `WORKSPACE_CHANNELS.TEST_WATCHER` diagnostic handler is intentionally
  // no longer registered.

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
          return resultToCommandResponse({
            ok: false,
            error: m.workspaceIpc_workspaceNotFound_error(),
          });
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
            error: m.workspaceIpc_noActiveWorkspace_error(),
          });
        }

        const workspace = await protocolAdapter.getWorkspace(workspaceId);
        if (workspace) {
          return resultToCommandResponse({ ok: true, data: workspace });
        } else {
          return resultToCommandResponse({
            ok: false,
            error: m.workspaceIpc_workspaceNotFound_error(),
          });
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
          return resultToCommandResponse({
            ok: false,
            error: m.workspaceIpc_workspaceNotFound_error(),
          });
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
          // Metadata watcher retired; nothing to stop here.

          // Clear MetadataFS cache so it's re-created on next open
          clearMetadataFSCache();

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
          return resultToCommandResponse({ ok: false, error: m.workspaceIpc_closeFailed_error() });
        }
      },
      WORKSPACE_CHANNELS.CLOSE,
    ),
  );

  // Open workspace
  //
  // ⚠️  IMPORTANT: This handler has side effects beyond just "opening" the workspace:
  // it warms caches and starts scripts services. File-change monitoring is owned
  // by the daemon; the FE-side change-detection stack has been removed.
  //
  // The backend is IDEMPOTENT, so it's safe to call this multiple times for the
  // same workspace.
  //
  ipcMain.handle(
    WORKSPACE_CHANNELS.OPEN,
    createSafeValidatedHandler(
      WorkspaceOpenSchema,
      async (_, validated) => {
        const id = validated.id;
        const startTime = Date.now();
        logger.info('[WorkspaceIPC] Opening workspace', { workspaceId: id });

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

          // PERFORMANCE OPTIMIZATION: Start all background initialization without blocking
          // The workspace is usable immediately - caches and scripts initialize
          // in the background and will be ready by the time the user needs them.

          // Metadata watcher retired alongside the workspace disk-read path;
          // workspace metadata is served by the daemon (`workspace.get`).

          const backgroundInitPromise = (async () => {
            try {
              const initStart = Date.now();

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

              // Wait for ALL to complete in parallel
              await Promise.all([cacheWarmingPromise, scriptsInitPromise]);

              logger.info('[WorkspaceIPC] Background initialization complete', {
                workspaceId: id,
                totalDurationMs: Date.now() - initStart,
              });
            } catch (error) {
              logger.error(
                // i18n-ignore (developer log message)
                '[WorkspaceIPC] Failed background initialization for workspace',
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

          // Fire and forget the background initialization
          // Use void to explicitly indicate we're not awaiting this
          void backgroundInitPromise;

          logger.info('[WorkspaceIPC] Workspace open returning immediately', {
            workspaceId: id,
            totalDurationMs: Date.now() - startTime,
          });

          // Return in Result format for the frontend
          return resultToCommandResponse({ ok: true, data: workspace });
        } else {
          // Workspace not found or error
          return resultToCommandResponse({
            ok: false,
            error: m.workspaceIpc_workspaceNotFound_error(),
          });
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

        // Metadata watcher retired; nothing to stop here.

        // Clear MetadataFS cache for deleted workspace
        clearMetadataFSCache();

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

  // Save workspace (stub - not yet implemented)
  ipcMain.handle(
    WORKSPACE_CHANNELS.SAVE,
    createSafeValidatedHandler(
      WorkspaceSaveSchema,
      async (_, validated) => {
        logger.warn('workspace:save not yet implemented', { id: validated.id });
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
            error: m.workspaceIpc_branchNameEmpty_error(),
          });
        }

        if (!isValidBranchName(newBranchName)) {
          const validationError = getBranchNameValidationError(newBranchName);
          return resultToCommandResponse({
            ok: false,
            error: validationError || m.workspaceIpc_branchNameInvalid_error(),
          });
        }

        try {
          // Get the current workspace to find the old branch name
          const workspace = await protocolAdapter.getWorkspace(workspaceId);
          if (!workspace) {
            return resultToCommandResponse({
              ok: false,
              error: m.workspaceIpc_workspaceNotFound_error(),
            });
          }

          const oldBranchName = workspace.branch;
          if (!oldBranchName) {
            return resultToCommandResponse({
              ok: false,
              error: m.workspaceIpc_workspaceHasNoBranch_error(),
            });
          }

          // No-op if renaming to the same name
          if (oldBranchName === newBranchName) {
            return resultToCommandResponse({ ok: true, data: workspace });
          }

          // Read the ACTUAL current git branch name from the worktree via
          // the daemon `git.status` (PROTOCOL §5.6). The workspace.branch is
          // the display name, which may differ from the actual git branch.
          let actualGitBranch: string;
          try {
            const status = await getBackendClient().request<{ branch?: string }>('git.status', {
              workspaceId,
            });
            if (!status?.branch) {
              return resultToCommandResponse({
                ok: false,
                error: m.workspaceIpc_getCurrentBranchFailed_error(),
              });
            }
            actualGitBranch = status.branch;
          } catch (error) {
            return resultToCommandResponse({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : m.workspaceIpc_getCurrentBranchFailed_error(),
            });
          }

          logger.info('Git branch info', {
            workspaceId,
            displayBranch: oldBranchName,
            actualGitBranch,
            newBranchName,
          });

          // Rename the git branch via the daemon (§5.6 — includes
          // duplicate/worktree checks).
          try {
            await getBackendClient().request('git.renameBranch', {
              workspaceId,
              oldBranchName: actualGitBranch,
              newBranchName,
            });
          } catch (error) {
            return resultToCommandResponse({
              ok: false,
              error:
                error instanceof Error ? error.message : m.workspaceIpc_renameBranchFailed_error(),
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
              error: m.workspaceIpc_updateMetadataFailed_error({ error: updateResult.error }),
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
            error:
              error instanceof Error
                ? error.message
                : m.workspaceIpc_renameWorkspaceBranchFailed_error(),
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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

          // Hover git-status stats retired with GitService; this handler is
          // unreachable from the renderer (which routes through the mock IPC
          // router), so return the zero-count defaults.
          const changesStats = { uncommitted: 0, staged: 0, unstaged: 0 };
          const lineStats = { additions: 0, deletions: 0 };

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
          return resultToCommandResponse({
            ok: false,
            error: m.workspaceIpc_hoverStatusFailed_error(),
          });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
        return resultToCommandResponse({
          ok: false,
          error: m.workspaceIpc_notYetImplemented_error(),
        });
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
              // i18n-ignore (developer log message)
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
            logger.info('workspace:list-files: skipping remote listing; legacy RPC retired', {
              workspaceId,
            });
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
          // i18n-ignore (validation result only logged, never shown in UI)
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
          const q = String(query || '');
          if (!q) return [];
          const searchRoot = workspacePath;

          let stdout = '';

          // Remote in-files search over the legacy RPC has retired. Skip the
          // remote branch and return an empty result until the daemon's WSS
          // transport lands.
          // TODO(P3-5): route via daemon `fs.grep` over WSS transport.
          if (isRemote && workspaceId) {
            logger.info('workspace:search-in-files: skipping remote search; legacy RPC retired', {
              workspaceId,
            });
            return [];
          }

          // Execute the search without a shell so the query is passed as an
          // argument and never interpreted by a shell
          const execSearchCommand = async (file: string, args: string[]): Promise<string> => {
            const result = await execFileAsync(file, args, {
              cwd: searchRoot,
              maxBuffer: 20 * 1024 * 1024,
            });
            return result.stdout || '';
          };

          try {
            stdout = await execSearchCommand('rg', [
              '-n',
              '--hidden',
              '--no-ignore',
              '-S',
              '-F',
              '-g',
              '!node_modules',
              '-g',
              '!.git',
              '-e',
              q,
              '--',
              searchRoot,
            ]);
          } catch {
            // Fallbacks - for remote, only use grep (no Windows findstr)
            try {
              stdout = await execSearchCommand('grep', [
                '-RIn',
                '--exclude-dir=.git',
                '--exclude-dir=node_modules',
                '-e',
                q,
                '--',
                searchRoot,
              ]);
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
