/**
 * Initialize Unified Backend
 *
 * Sets up the consolidated backend service with IPC handlers.
 * This is now the single source of truth for all agent operations.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { ConsolidatedBackendService } from './consolidated-backend.service';
import { Logger } from '../../../shared/logger';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { WorkspaceCleanupAgentsSchema } from '../../../main/ipc-schemas';
import { unifiedEventBus } from '../../events/main/unified-event-bus';

const logger = new Logger('InitUnifiedBackend');

// Get the consolidated backend instance
const consolidatedBackend = ConsolidatedBackendService.getInstance();

/**
 * Initialize the unified backend with IPC handlers
 */
export async function initializeUnifiedBackend(mainWindow: BrowserWindow): Promise<void> {
  logger.info('Initializing consolidated agent backend');

  try {
    // Setup IPC handlers
    await consolidatedBackend.setupIPCHandlers(mainWindow);

    // Load persisted sessions for active workspace
    setupWorkspaceHandlers();

    // Listen for workspace deletion to cleanup agents
    setupWorkspaceDeletionListener();

    // Listen for workspace archiving to cleanup agents
    setupWorkspaceArchiveListener();

    logger.info('Consolidated agent backend initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize consolidated backend', { error });
    throw error;
  }
}

/**
 * Setup listener for workspace deletion to cleanup running agents
 */
function setupWorkspaceDeletionListener(): void {
  unifiedEventBus.onDomainEvent('workspace:deleting', async ({ workspaceId }) => {
    logger.info('Workspace deleting - cleaning up agents', { workspaceId });

    try {
      // CRITICAL: Stop all providers in AgentBackendHandler first
      // These hold the actual auggie processes and are not tracked in ConsolidatedBackendService.sessions
      const { agentBackendHandler } = await import('./agent-backend-handler.service');
      const providersStopped = await agentBackendHandler.stopProvidersForWorkspace(workspaceId);
      logger.info('Stopped AgentBackendHandler providers for workspace', {
        workspaceId,
        providersStopped,
      });

      // Also stop any agents tracked in ConsolidatedBackendService.sessions
      const sessions = await consolidatedBackend.listAgents(workspaceId);

      if (sessions.length > 0) {
        logger.info('Stopping agents in ConsolidatedBackendService for deleted workspace', {
          workspaceId,
          agentCount: sessions.length,
          agentIds: sessions.map((s) => s.id),
        });

        // Kill each agent process (not just interrupt - fully stop and kill the process)
        for (const session of sessions) {
          try {
            await consolidatedBackend.backendStop({
              agentId: session.id.toString(),
              killProcess: true, // Kill the auggie process, not just interrupt
              _stopTrigger: 'workspace_deletion',
              _stopReason: 'workspace:deleting event',
            });
            logger.info('Killed agent for deleted workspace', {
              agentId: session.id,
              workspaceId,
            });
          } catch (error) {
            logger.warn('Failed to kill agent during workspace deletion', {
              agentId: session.id,
              workspaceId,
              error,
            });
          }
        }
      }

      // Invalidate main-process agent caches to prevent stale data from being
      // returned after workspace deletion. This must happen even if no agents
      // were running, because cached disk-read results would still be served.
      agentBackendHandler.invalidatePersistenceListCache(workspaceId);

      const { unifiedPersistence } = await import('./agent-persistence');
      unifiedPersistence.invalidateLoadCachesForWorkspace(workspaceId);

      logger.info('Completed agent cleanup for deleted workspace', {
        workspaceId,
        providersStopped,
        sessionsStopped: sessions.length,
      });
    } catch (error) {
      logger.error('Failed to cleanup agents for deleted workspace', {
        workspaceId,
        error,
      });
    }
  });

  logger.info('Workspace deletion listener registered for agent cleanup');
}

/**
 * Setup listener for workspace archiving to cleanup running agents
 */
function setupWorkspaceArchiveListener(): void {
  unifiedEventBus.onDomainEvent('workspace:archived', async ({ workspaceId }) => {
    logger.info('Workspace archived - cleaning up agents', { workspaceId });

    try {
      // CRITICAL: Stop all providers in AgentBackendHandler first
      // These hold the actual auggie processes and are not tracked in ConsolidatedBackendService.sessions
      const { agentBackendHandler } = await import('./agent-backend-handler.service');
      const providersStopped = await agentBackendHandler.stopProvidersForWorkspace(workspaceId);
      logger.info('Stopped AgentBackendHandler providers for archived workspace', {
        workspaceId,
        providersStopped,
      });

      // Also stop any agents tracked in ConsolidatedBackendService.sessions
      const sessions = await consolidatedBackend.listAgents(workspaceId);

      if (sessions.length === 0 && providersStopped === 0) {
        logger.info('No agents to cleanup for archived workspace', { workspaceId });
        return;
      }

      if (sessions.length > 0) {
        logger.info('Stopping agents in ConsolidatedBackendService for archived workspace', {
          workspaceId,
          agentCount: sessions.length,
          agentIds: sessions.map((s) => s.id),
        });

        // Kill each agent process (not just interrupt - fully stop and kill the process)
        for (const session of sessions) {
          try {
            await consolidatedBackend.backendStop({
              agentId: session.id.toString(),
              killProcess: true, // Kill the auggie process, not just interrupt
              _stopTrigger: 'workspace_archival',
              _stopReason: 'workspace:archived event',
            });
            logger.info('Killed agent for archived workspace', {
              agentId: session.id,
              workspaceId,
            });
          } catch (error) {
            logger.warn('Failed to kill agent during workspace archiving', {
              agentId: session.id,
              workspaceId,
              error,
            });
          }
        }
      }

      logger.info('Completed agent cleanup for archived workspace', {
        workspaceId,
        providersStopped,
        sessionsStopped: sessions.length,
      });
    } catch (error) {
      logger.error('Failed to cleanup agents for archived workspace', {
        workspaceId,
        error,
      });
    }
  });

  logger.info('Workspace archive listener registered for agent cleanup');
}

/**
 * Setup workspace-related handlers
 */
function setupWorkspaceHandlers(): void {
  // Load sessions when workspace changes
  // DUPLICATE_HANDLER:   ipcMain.handle("workspace:load-agents", async (_, workspaceId: WorkspaceId) => {
  // DUPLICATE_HANDLER:     logger.info("Loading agents for workspace", { workspaceId });
  // DUPLICATE_HANDLER:
  // DUPLICATE_HANDLER:     try {
  // DUPLICATE_HANDLER:       const count = await consolidatedBackend.loadPersistedSessions(workspaceId);
  // DUPLICATE_HANDLER:       logger.info("Loaded persisted sessions", { count, workspaceId });
  // DUPLICATE_HANDLER:       return { success: true, count };
  // DUPLICATE_HANDLER:     } catch (error) {
  // DUPLICATE_HANDLER:       logger.error("Failed to load persisted sessions", { error });
  // DUPLICATE_HANDLER:       return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  // DUPLICATE_HANDLER:     }
  // DUPLICATE_HANDLER:   });

  // Clean up when workspace closes
  ipcMain.handle(
    'workspace:cleanup-agents',
    createSafeValidatedHandler(
      WorkspaceCleanupAgentsSchema,
      async (_, { workspaceId }) => {
        logger.info('Cleaning up agents for workspace', { workspaceId });

        try {
          const sessions = await consolidatedBackend.listAgents(workspaceId);
          for (const session of sessions) {
            await consolidatedBackend.deleteAgent(session.id.toString());
          }
          return { success: true, count: sessions.length };
        } catch (error) {
          logger.error('Failed to cleanup agents', { error });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'workspace:cleanup-agents',
    ),
  );
}

/**
 * Shutdown the unified backend
 */
export async function shutdownUnifiedBackend(): Promise<void> {
  logger.info('Shutting down consolidated backend');

  try {
    // Shutdown consolidated backend (kills active agent processes)
    await consolidatedBackend.shutdown();
    logger.info('Consolidated backend shutdown complete');
  } catch (error) {
    logger.error('Error during consolidated backend shutdown', { error });
  }

  // Also cleanup agent pool (kills warm/pre-warmed agent processes)
  try {
    const { agentPoolService } = await import('./agent-pool.service');
    await agentPoolService.disposeAll();
    logger.info('Agent pool cleanup complete');
  } catch (error) {
    logger.error('Error during agent pool cleanup', { error });
  }
}

// Export for use in main process
export { consolidatedBackend };
