/**
 * Workspace IPC
 *
 * Thin IPC layer for workspace operations.
 * Handles communication between renderer and main process.
 */

import { createRequire } from 'module';
import { ipcMain, BrowserWindow } from 'electron';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';
import type { Result, CommandResponse, WorkspaceId } from '../../../shared/types';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';
import { changeDetectorManager as singletonChangeDetectorManager } from './change-detector-manager';
import { MetadataWatcherManager } from './metadata-watcher-manager';
import * as fs from 'fs/promises';

import { Logger } from '../../../shared/logger';
import { unifiedEventBus } from '../../events/main/unified-event-bus';
import { getWorkspaceEventService, cleanupWorkspaceEventService } from '../../events/main';
import { WorkspaceConfig } from '../../../shared/main/config.js';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import { RemoteRPCError } from '../../../shared/main/remote-rpc-client';
import { getAttributionEngine } from './provenance/attribution-engine';
import { InstructionService } from '../../agent/main/instruction-service';
import { execAsync } from '../../../shared/git/git-env';
import { getNotificationService } from '../../notifications/main/notification.service';
import { GitService } from '../../git/main/git.service';
import { getWorkspaceGitInfo, getRemoteGitManager } from '../../git/main/git-router';
import { cleanupWorkspaceTerminals } from '../../terminal/main/terminal.ipc';
import { getUnifiedWatcher, shutdownUnifiedWatcher } from './unified-workspace-watcher';
import { initRepoRegistry, getAllRepos, addRepo, syncRepos, clearRepos } from './repo-registry';
import { sshManager, type SSHConnectionConfig } from '../../../shared/main/ssh-manager';
import { getIntentServerPath, escapeShellArg } from '../../agent/main/agent-providers/acp-provider';

const require = createRequire(import.meta.url);
import {
  validateIPCWorkspaceId,
  validateIPCPath,
  validateIPCString,
} from '../../ipc/ipc-validation';
import { isValidBranchName, getBranchNameValidationError } from './workspace-validation';
import { WORKSPACE_CHANNELS, AGENT_CHANNELS, EDITOR_CHANNELS } from '$shared/ipc/channels';
import {
  createSafeValidatedHandler,
  registerValidationSchema,
} from '../../../main/ipc-validation-middleware';
import {
  WorkspaceGetSchema,
  WorkspaceGetByIdSchema,
  WorkspaceCreateSchema,
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
  WorkspaceRepairSchema,
  WorkspaceBackupSchema,
  WorkspaceRestoreSchema,
  WorkspaceGetSettingsSchema,
  WorkspaceUpdateSettingsSchema,
  WorkspaceGetRecentRepositoriesSchema,
  WorkspaceAddRecentRepositorySchema,
  WorkspaceClearRecentRepositoriesSchema,
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

// Global storage for git integrations
declare global {
  var gitIntegrations: Map<string, any> | undefined;
  var gitIntegrationLocks: Map<string, Promise<void>> | undefined;
}

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
      unifiedEventBus.emitDomainEvent('workspace:file-changes', {
        workspaceId,
        diffChunk,
      });

      // Also send to renderer processes for this workspace
      sendToWorkspaceWindows(workspaceId, 'workspace-changes', {
        workspaceId,
        diffChunk,
      });
    });

    // Note: activity-log-event events are handled directly by WorkspaceEventService
    // which gets the detector instance via getChangeDetector() method.
    // The ChangeDetectorManager does NOT forward activity-log-event from individual detectors.
    // See workspace-event-service.ts setupChangeDetectorIntegration() for the event handling.

    // Listen for git:commit-created events to handle post-commit file tracking transitions
    // This is triggered by AcceptChangesService after a commit is made
    unifiedEventBus.on(
      'git:commit-created',
      async (data: { workspaceId: string; commitSha: string; postCommitHandled?: boolean }) => {
        const { workspaceId, commitSha, postCommitHandled } = data;
        logger.info('Received git:commit-created event', {
          workspaceId,
          commitSha: commitSha?.substring(0, 8),
          postCommitHandled,
        });

        // If post-commit was already handled by the caller, skip redundant work
        // This prevents double-processing when AcceptChangesService calls handlePostCommit directly
        if (postCommitHandled) {
          logger.debug('Skipping post-commit handling - already done by caller', { workspaceId });
          return;
        }

        try {
          // Initialize global gitIntegrations map if needed
          if (!global.gitIntegrations) {
            global.gitIntegrations = new Map();
          }

          const gitIntegration = global.gitIntegrations.get(workspaceId);
          if (gitIntegration) {
            // Handle post-commit transition (staged -> committed)
            await gitIntegration.handlePostCommit(commitSha);

            // Then sync the current state
            await gitIntegration.syncCurrentState(true); // Force sync
            logger.info('Post-commit transition complete via event', { workspaceId });
          } else {
            logger.warn('No git integration found for workspace in git:commit-created handler', {
              workspaceId,
              availableWorkspaces: Array.from(global.gitIntegrations.keys()),
            });
          }
        } catch (error) {
          logger.error('Failed to handle git:commit-created event', error as Error, {
            workspaceId,
          });
        }
      },
    );
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

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupWorkspaceIPC(): void {
  // Initialize the persistent repo registry
  initRepoRegistry().catch((err) => logger.error('Failed to init repo registry', err as Error));

  // Register validation schemas for all workspace channels
  registerValidationSchema(WORKSPACE_CHANNELS.GET, WorkspaceGetSchema);
  registerValidationSchema(WORKSPACE_CHANNELS.CREATE, WorkspaceCreateSchema);
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

  // Create workspace
  ipcMain.handle(
    WORKSPACE_CHANNELS.CREATE,
    createSafeValidatedHandler(
      WorkspaceCreateSchema,
      async (_, validated) => {
        const result = await protocolAdapter.createWorkspace(validated);
        return resultToCommandResponse(result);
      },
      WORKSPACE_CHANNELS.CREATE,
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
          // Clean up git integration first
          if (global.gitIntegrations?.has(id)) {
            try {
              const gitIntegration = global.gitIntegrations.get(id);
              if (gitIntegration) {
                gitIntegration.stopListening();
                gitIntegration.removeAllListeners();
                global.gitIntegrations.delete(id);
                logger.info('[WorkspaceIPC] Cleaned up git integration', { workspaceId: id });
              }
            } catch (error) {
              logger.warn('[WorkspaceIPC] Failed to cleanup git integration', error as Error, {
                workspaceId: id,
              });
            }
          }

          // Clean up any pending initialization locks
          if (global.gitIntegrationLocks?.has(id)) {
            global.gitIntegrationLocks.delete(id);
          }

          // Stop file tracking storage cleanup timer
          try {
            const { FileTrackingStorage } = await import(
              '../../file-tracking/main/file-tracking-storage'
            );
            // Cleanup the specific workspace instance to stop cleanup timers
            FileTrackingStorage.cleanupWorkspace(id);
            logger.debug('[WorkspaceIPC] File tracking storage cleanup', { workspaceId: id });
          } catch (error) {
            logger.warn('[WorkspaceIPC] Failed to cleanup file tracking storage', error as Error, {
              workspaceId: id,
            });
          }

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

          // Shut down unified workspace watcher (after other watchers that depend on it)
          try {
            await shutdownUnifiedWatcher(id);
            logger.info('[WorkspaceIPC] Shut down unified workspace watcher', { workspaceId: id });
          } catch (error) {
            logger.warn('[WorkspaceIPC] Failed to shut down unified watcher', error as Error, {
              workspaceId: id,
            });
          }

          // Stop workspace event service
          try {
            await cleanupWorkspaceEventService(id);
            logger.info('[WorkspaceIPC] Workspace event service cleanup', { workspaceId: id });
          } catch (error) {
            logger.warn('[WorkspaceIPC] Failed to cleanup event service', error as Error, {
              workspaceId: id,
            });
          }

          // Clean up agent event subscription service to prevent memory leaks
          try {
            const { disposeAgentEventSubscriptionService } = await import(
              '../../events/main/agent-event-subscription.service'
            );
            disposeAgentEventSubscriptionService(id);
            logger.debug('[WorkspaceIPC] Agent subscription service cleanup', { workspaceId: id });
          } catch (error) {
            logger.debug('[WorkspaceIPC] Agent subscription service cleanup not available', {
              error,
            });
          }

          // Clean up any pre-warmed agent providers (no-op if none exist)
          // NOTE: Agent pre-warming is currently disabled, but we keep cleanup for safety
          try {
            const { agentPoolService } = await import('../../agent/main/agent-pool.service');
            await agentPoolService.disposeWorkspace(id);
            logger.debug('[WorkspaceIPC] Agent pool cleanup', { workspaceId: id });
          } catch (error) {
            logger.debug('[WorkspaceIPC] Agent pool cleanup not available', { error });
          }

          // Clean up notification service
          try {
            const { disposeNotificationService } = await import(
              '../../notifications/main/notification.service'
            );
            disposeNotificationService(id);
            logger.debug('[WorkspaceIPC] Notification service cleanup', { workspaceId: id });
          } catch (error) {
            logger.debug('[WorkspaceIPC] Notification service cleanup not available', { error });
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

          // Clean up HTTP MCP bridge cached servers for this workspace
          try {
            const httpMcpBridge = (global as any).__httpMcpBridgeInstance;
            if (httpMcpBridge && typeof httpMcpBridge.clearMcpServersForWorkspace === 'function') {
              const clearedCount = httpMcpBridge.clearMcpServersForWorkspace(id);
              if (clearedCount > 0) {
                logger.debug('[WorkspaceIPC] HTTP MCP bridge cache cleanup', {
                  workspaceId: id,
                  clearedCount,
                });
              }
            }
          } catch (error) {
            logger.debug('[WorkspaceIPC] HTTP MCP bridge cache cleanup failed', { error });
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
  //    2. Initializes GitIntegrationService (emits file-tracking:changes-updated events)
  //    3. Sets up activity log event service integration
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
          // Load agent writes for this workspace (for content-based attribution)
          const attributionEngine = getAttributionEngine();
          await attributionEngine.ensureWorkspaceLoaded(id);
          logger.info('[WorkspaceIPC] Loaded agent writes for workspace', { workspaceId: id });

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
          const worktreePath = workspace.worktreePath || workspace.repositoryPath;
          if (worktreePath) {
            try {
              const unifiedWatcher = await getUnifiedWatcher(id, worktreePath);
              const stats = unifiedWatcher.getStats();
              logger.info('[WorkspaceIPC] Unified workspace watcher ready', {
                workspaceId: id,
                mode: stats.mode,
                subscribers: stats.subscribers,
                isRunning: stats.isRunning,
              });
            } catch (error) {
              logger.error('[WorkspaceIPC] Failed to start unified workspace watcher', error as Error, {
                workspaceId: id,
              });
              // Non-fatal: file watching will be unavailable for this workspace
            }
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
              // For remote workspaces, ensure RPC daemon is running BEFORE monitoring starts.
              // Monitoring, file explorer, and git state checks all need the RPC socket.
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

                  // Establish SSH connection for RPC (reuse existing connection if available)
                  const rpcConnectionId = `rpc-${workspace.id}`;
                  await sshManager.connect(rpcConnectionId, sshConfig);

                  // Deploy intent-server if needed
                  const localBundlePath = getIntentServerPath();
                  await sshManager.deployIntentServer(rpcConnectionId, localBundlePath);

                  // Start RPC-only daemon (idempotent — exits with success if already running)
                  const serveResult = await sshManager.executeCommand(
                    rpcConnectionId,
                    `node ~/.intent-server/server.js serve --workspace ${escapeShellArg(workspace.id)}`,
                    { timeout: 15000 },
                  );

                  if (serveResult.exitCode !== 0) {
                    logger.warn('Failed to start RPC serve daemon', {
                      workspaceId: workspace.id,
                      exitCode: serveResult.exitCode,
                      stderr: serveResult.stderr,
                    });
                  } else {
                    logger.info('RPC serve daemon ready', { workspaceId: workspace.id });
                  }
                } catch (err) {
                  // Non-fatal — monitoring will still start; git integration will retry via auto-sync timer
                  logger.warn('Failed to start RPC daemon during workspace open', {
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

              // Get the detector once for both git integration and activity log
              const detector = manager.getChangeDetector(id);

              // Start BOTH git integration and activity log in PARALLEL
              // They both only need the detector and don't depend on each other
              const gitIntegrationStart = Date.now();
              const activityLogStart = Date.now();

              // Git integration promise
              const gitIntegrationPromise = (async () => {
                try {
                  if (detector) {
                    // Initialize global gitIntegrations map if needed
                    if (!global.gitIntegrations) {
                      global.gitIntegrations = new Map();
                    }
                    if (!global.gitIntegrationLocks) {
                      global.gitIntegrationLocks = new Map();
                    }

                    // Use a lock to prevent concurrent initialization
                    const initLock = global.gitIntegrationLocks.get(id);
                    if (initLock) {
                      logger.debug('Waiting for existing git integration initialization', {
                        workspaceId: id,
                      });
                      await initLock;
                      // Check if it was successfully initialized
                      if (global.gitIntegrations.has(id)) {
                        logger.debug('Git integration already initialized', { workspaceId: id });
                        return;
                      }
                    }

                    // Create initialization promise
                    const initPromise = initializeGitIntegration(
                      id,
                      workspace.worktreePath,
                      detector,
                      {
                        baseRef: workspace.baseRef,
                        baseCommitSha: workspace.baseCommitSha,
                        createdAt: workspace.createdAt,
                      },
                      !!workspace.environmentConfig?.ssh,
                    );
                    global.gitIntegrationLocks.set(id, initPromise);

                    try {
                      await initPromise;
                      logger.info('Git integration initialized successfully', { workspaceId: id });
                    } catch (error) {
                      logger.error('Failed to initialize git integration', error as Error, {
                        workspaceId: id,
                      });
                    } finally {
                      global.gitIntegrationLocks.delete(id);
                    }

                    // Send an initial event to notify the frontend that the listener is ready
                    sendToWorkspaceWindows(id, 'file-tracking:listener-ready', { workspaceId: id });
                  } else {
                    logger.warn('No change detector available for git integration', {
                      workspaceId: id,
                    });
                  }

                  logger.info('Initialized file tracking system', {
                    workspaceId: id,
                    durationMs: Date.now() - gitIntegrationStart,
                  });
                } catch (error) {
                  logger.error('Failed to initialize file tracking', error as Error, {
                    workspaceId: id,
                    durationMs: Date.now() - gitIntegrationStart,
                  });
                }
              })();

              // Activity log promise
              const activityLogPromise = (async () => {
                try {
                  logger.info('Initializing activity log', {
                    workspaceId: id,
                    hasDetector: !!detector,
                  });
                  const eventService = getWorkspaceEventService({
                    workspaceId: id,
                    changeDetector: detector || undefined,
                  });
                  await eventService.initialize();
                  logger.info('Initialized activity log successfully', {
                    workspaceId: id,
                    durationMs: Date.now() - activityLogStart,
                    hasDetector: !!detector,
                  });
                } catch (error) {
                  logger.error('Failed to initialize activity log', error as Error, {
                    workspaceId: id,
                    errorMessage: (error as Error).message,
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

              // Wait for ALL to complete in parallel
              await Promise.all([
                gitIntegrationPromise,
                activityLogPromise,
                cacheWarmingPromise,
                notificationServicePromise,
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

        // If baseCommitSha or baseRef changed, update the GitIntegrationService's metadata
        // so that loadCommittedChanges() uses the new boundary on next sync.
        // Wrapped in try-catch: this is a side-effect — it must not break the update response.
        if (
          result.ok &&
          validated.id &&
          (validated.baseCommitSha !== undefined || validated.baseRef !== undefined)
        ) {
          try {
            const gitIntegration = global.gitIntegrations?.get(validated.id);
            if (gitIntegration && typeof gitIntegration.updateWorkspaceMetadata === 'function') {
              // Fetch fresh workspace data to get the complete metadata
              const wsResult = await protocolAdapter.getWorkspace(validated.id);
              if (wsResult) {
                gitIntegration.updateWorkspaceMetadata({
                  baseRef: wsResult.baseRef,
                  baseCommitSha: wsResult.baseCommitSha,
                  createdAt: wsResult.createdAt,
                });
              }
            }
          } catch (metadataError) {
            // Non-fatal: the update succeeded, metadata sync can retry on next sync cycle
            logger.warn('Failed to sync GitIntegration metadata after workspace update', {
              workspaceId: validated.id,
              error: (metadataError as Error).message,
            });
          }
        }

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

        // Shut down unified workspace watcher
        try {
          await shutdownUnifiedWatcher(validatedId);
          logger.debug('Shut down unified workspace watcher', { workspaceId: validatedId });
        } catch (error) {
          logger.warn('Failed to shut down unified watcher during delete', error as Error, {
            workspaceId: validatedId,
          });
        }

        // Cleanup activity log and git tracking
        try {
          // Clean up event service if needed
          // Note: Event service cleanup is handled automatically
          logger.info('Cleaned up activity log and git tracking before delete', {
            workspaceId: validatedId,
          });
        } catch (error) {
          logger.error('Failed to cleanup activity log before delete', error as Error, {
            workspaceId: validatedId,
          });
        }

        // Clean up agent event subscription service to prevent memory leaks
        try {
          const { disposeAgentEventSubscriptionService } = await import(
            '../../events/main/agent-event-subscription.service'
          );
          disposeAgentEventSubscriptionService(validatedId);
          logger.debug('Agent subscription service cleanup before delete', {
            workspaceId: validatedId,
          });
        } catch (error) {
          logger.debug('Agent subscription service cleanup not available before delete', {
            error,
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
          let lineStats = { additions: 0, deletions: 0 };

          const gitInfo = await getWorkspaceGitInfo(workspaceId);
          if (gitInfo?.isRemote) {
            // Remote workspace: use RemoteGitManager
            try {
              const remoteGit = getRemoteGitManager(
                workspaceId,
                gitInfo.repositoryPath || gitInfo.worktreePath,
              );
              const remoteStatus = await remoteGit.getStatus(gitInfo.worktreePath);
              const stagedCount = remoteStatus.staged.length;
              const unstagedCount =
                remoteStatus.modified.length +
                remoteStatus.untracked.length +
                remoteStatus.deleted.length;
              changesStats = {
                uncommitted: stagedCount + unstagedCount,
                staged: stagedCount,
                unstaged: unstagedCount,
              };
            } catch (error) {
              logger.error('Failed to get remote git status for hover', error as Error, {
                workspaceId,
              });
            }
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
                    name:
                      ws.repositoryName || ws.repositoryPath.split('/').pop() || 'Unknown',
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

  // Get editor selection
  ipcMain.handle(
    EDITOR_CHANNELS.GET_SELECTION,
    createSafeValidatedHandler(
      EditorGetSelectionSchema,
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
                    const dir = queue.shift()!;
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

          const maxResults = typeof limit === 'number' && limit > 0 ? limit : 50;

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
                const dir = queue.shift()!;
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

          // Helper to execute search command (local or remote)
          const execSearchCommand = async (cmd: string): Promise<string> => {
            if (isRemote && workspaceId) {
              const rpcClient = await remoteRPCManager.getClient(workspaceId);
              const fullCommand = `cd "${workspacePath}" && ${cmd}`;
              try {
                const result = await rpcClient.exec({ command: fullCommand, timeout: 30000 });
                return result.stdout || '';
              } catch (error) {
                if (error instanceof RemoteRPCError && error.code === -32000) {
                  const data = error.data as { stdout?: string } | undefined;
                  return data?.stdout || '';
                }
                throw error;
              }
            }
            const result = await execAsync(cmd, {
              cwd: workspacePath,
              maxBuffer: 20 * 1024 * 1024,
            });
            return result.stdout || '';
          };

          try {
            const cmd = `rg -n --hidden --no-ignore -S -F -g "!node_modules" -g "!.git" "${q}" "${workspacePath}"`;
            stdout = await execSearchCommand(cmd);
          } catch (err: any) {
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

/**
 * Initialize git integration for a workspace
 */
async function initializeGitIntegration(
  workspaceId: string,
  worktreePath: string,
  detector: any,
  workspaceMetadata?: { baseRef?: string; baseCommitSha?: string; createdAt?: string },
  isRemote?: boolean,
): Promise<void> {
  // Ensure global maps are initialized
  if (!global.gitIntegrations) {
    global.gitIntegrations = new Map();
  }

  // Check if we already have a git integration for this workspace
  let gitIntegration = global.gitIntegrations.get(workspaceId);

  if (gitIntegration) {
    // Stop the existing listener before setting up a new one
    logger.info('Stopping existing git integration before reinitializing', { workspaceId });
    gitIntegration.stopListening();
    gitIntegration.removeAllListeners();
  }

  // Create new git integration
  const { GitIntegrationService } = await import(
    '../../file-tracking/main/git-integration.service'
  );
  const { FileTrackingService } = await import('../../file-tracking/main/file-tracking.service');
  const { gitService } = await import('../../git/main/git.service');

  const fileTrackingService = new FileTrackingService(workspaceId, worktreePath, isRemote);
  gitIntegration = new GitIntegrationService(
    workspaceId,
    fileTrackingService,
    isRemote ? undefined : gitService,
    workspaceMetadata,
    isRemote,
  );

  // Listen for changes tracked event and notify frontend
  const changeHandler = (data: any) => {
    // PERF: Changed from INFO to DEBUG - called for every file tracking change
    logger.debug('[WorkspaceIPC] Forwarding changes-tracked event to frontend', {
      workspaceId: data.workspaceId,
      changeCount: data.changeCount,
      source: data.source,
    });
    // Send to windows viewing this workspace
    sendToWorkspaceWindows(data.workspaceId, 'file-tracking:changes-updated', {
      workspaceId: data.workspaceId,
      changeCount: data.changeCount,
      source: data.source,
    });
  };

  // NOTE: We only listen for 'changes-tracked' here.
  // File change events for the activity log are emitted via EventCoordinator -> activity-log-event -> WorkspaceEventService
  // Adding a 'file-changed' listener here was causing duplicate events in the activity log.
  gitIntegration.on('changes-tracked', changeHandler);

  await gitIntegration.startListening(detector);

  // Store the git integration for cleanup later
  global.gitIntegrations.set(workspaceId, gitIntegration);

  logger.info('Set up git integration', { workspaceId });
}
