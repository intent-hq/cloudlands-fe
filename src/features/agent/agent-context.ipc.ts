/**
 * Agent Context IPC
 *
 * Handles IPC communication for agent context between renderer and main processes.
 * This allows the main process (HTTP MCP bridge) to access agent context
 * that is set in the renderer process by agent context utilities.
 */

import {
  ipcMain,
  IpcMainInvokeEvent,
} from 'electron';
import { getAgentContextRegistry } from './agent-context-registry';
import { Logger } from '../../shared/logger';
import { createSafeValidatedHandler } from '../../main/ipc-validation-middleware';
import {
  AgentContextUpdateSchema,
  AgentContextGetByWorkspaceSchema,
  AgentContextGetBySessionSchema,
} from '../../main/ipc-schemas';

const logger = new Logger('AgentContextIPC');

// Track if handlers have been registered to prevent duplicates
let handlersRegistered = false;

/**
 * Agent context update payload structure.
 * Contains all necessary information to track agent state across processes.
 */
interface AgentContextUpdate {
  /** Unique identifier for the agent instance */
  agentId: string;
  /** Human-readable name of the agent */
  agentName: string;
  /** Session identifier for the current conversation */
  sessionId: string;
  /** Optional turn number in the conversation */
  turnNumber?: number;
  /** Workspace identifier where the agent is operating */
  workspaceId: string;
}

/**
 * Register IPC handlers for agent context management.
 * Sets up communication channels between renderer and main processes
 * for sharing agent context information needed by the HTTP MCP bridge.
 *
 * @example
 * ```typescript
 * // In main process initialization
 * registerAgentContextHandlers();
 * ```
 */
export function registerAgentContextHandlers(): void {
  // Prevent duplicate registration
  if (handlersRegistered) {
    logger.warn('Agent context handlers already registered, skipping duplicate registration');
    return;
  }

  // Remove any existing handlers first to be safe
  const handlers = [
    'agent:context:update',
    'agent:context:getByWorkspace',
    'agent:context:getBySession',
  ];

  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // Update agent context from renderer
  ipcMain.handle(
    'agent:context:update',
    createSafeValidatedHandler(
      AgentContextUpdateSchema,
      async (_event: IpcMainInvokeEvent, validated) => {
        try {
          const context = validated as AgentContextUpdate;
          const registry = getAgentContextRegistry();

          logger.info('Updating agent context from renderer', {
            agentId: context.agentId,
            agentName: context.agentName,
            turnNumber: context.turnNumber,
            workspaceId: context.workspaceId,
          });

          registry.register({
            ...context,
            updatedAt: new Date(),
          });

          return { success: true };
        } catch (error) {
          logger.error('Failed to update agent context', { error: (error as Error).message });
          return { success: false, error: (error as Error).message };
        }
      },
      'agent:context:update',
    ),
  );

  // Get agent context by workspace ID
  ipcMain.handle(
    'agent:context:getByWorkspace',
    createSafeValidatedHandler(
      AgentContextGetByWorkspaceSchema,
      async (_event: IpcMainInvokeEvent, validated) => {
        try {
          const workspaceId = validated;
          const registry = getAgentContextRegistry();
          const context = registry.getByWorkspaceId(workspaceId);

          logger.debug('Getting agent context for workspace', {
            workspaceId,
            found: !!context,
            turnNumber: context?.turnNumber,
          });

          return { success: true, context };
        } catch (error) {
          logger.error('Failed to get agent context', { error: (error as Error).message });
          return { success: false, error: (error as Error).message };
        }
      },
      'agent:context:getByWorkspace',
    ),
  );

  // Get agent context by session ID - more reliable than workspace ID
  ipcMain.handle(
    'agent:context:getBySession',
    createSafeValidatedHandler(
      AgentContextGetBySessionSchema,
      async (_event: IpcMainInvokeEvent, validated) => {
        try {
          const sessionId = validated;
          const registry = getAgentContextRegistry();
          const context = registry.getBySessionId(sessionId);

          logger.debug('Retrieved agent context by session ID', {
            sessionId,
            found: !!context,
            turnNumber: context?.turnNumber,
          });

          return { success: true, context };
        } catch (error) {
          logger.error('Failed to get agent context by session', {
            error: (error as Error).message,
          });
          return { success: false, error: (error as Error).message };
        }
      },
      'agent:context:getBySession',
    ),
  );

  // Mark handlers as registered
  handlersRegistered = true;
  logger.info('Agent context IPC handlers registered');
}
