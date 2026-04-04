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
// Event listeners migrated to Redux sagas (domain-event-listener-sagas.ts)

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

    // workspace:deleting and workspace:archived listeners are now handled by sagas
    // (domain-event-listener-sagas.ts) — no need to register listeners here.

    logger.info('Consolidated agent backend initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize consolidated backend', { error });
    throw error;
  }
}

// workspace:deleting and workspace:archived listeners are now sagas
// in domain-event-listener-sagas.ts

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
