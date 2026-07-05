/**
 * Debug IPC Handlers
 *
 * Development-only handlers for testing backend-initiated flows.
 * These handlers are NOT registered in production.
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { AgentBackendHandler } from '../../agent/main/agent-backend-handler.service';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger('DebugIPC');

/**
 * Setup debug IPC handlers (development only)
 */
export function setupDebugIPC(): void {
  // Only enable in development
  if (process.env.NODE_ENV !== 'development') {
    logger.info('Debug IPC handlers disabled in production');
    return;
  }

  logger.info('Setting up debug IPC handlers');

  // List all agents for a workspace
  ipcMain.handle(
    IPC_CHANNELS.DEBUG.LIST_AGENTS,
    async (_event, { workspaceId }: { workspaceId: string }) => {
      logger.info('Debug: Listing agents for workspace', { workspaceId });

      try {
        // Route through the daemon (PROTOCOL.md 5.5): agent.list returns the
        // AgentLite projection with messageCount already, so we no longer need
        // to list ids and load each session individually.
        const result = (await getBackendClient().request('agent.list', { workspaceId })) as {
          agents?: Array<{
            id: string;
            name?: string;
            status?: string;
            messageCount?: number;
            createdAt?: string;
          }>;
        };
        const agents = (result?.agents ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          messageCount: a.messageCount ?? 0,
          createdAt: a.createdAt,
        }));

        return { success: true, agents };
      } catch (error) {
        logger.error('Debug: Failed to list agents', { workspaceId, error });
        return { success: false, error: String(error) };
      }
    },
  );

  // Trigger backend-initiated resume with a message
  ipcMain.handle(
    IPC_CHANNELS.DEBUG.TRIGGER_BACKEND_RESUME,
    async (
      _event,
      {
        workspaceId,
        agentId,
        message,
      }: {
        workspaceId: string;
        agentId: string;
        message?: string;
      },
    ) => {
      logger.info('Debug: Triggering backend-initiated resume', {
        workspaceId,
        agentId,
        hasMessage: !!message,
      });

      try {
        const handler = AgentBackendHandler.getInstance();

        // Use the sendBackendInitiatedMessage flow
        const result = await handler.sendBackendInitiatedMessage({
          sessionId: agentId,
          workspaceId,
          message:
            message ||
            `[DEBUG] Backend-initiated wake test at ${new Date().toISOString()}. ` +
              'This message was sent to test the frontend handshake flow. ' +
              'Please acknowledge receipt.',
          messageMetadata: {
            type: 'debug_test',
            source: 'debug:trigger-backend-resume',
            timestamp: new Date().toISOString(),
          },
        });

        logger.info('Debug: Backend-initiated resume result', {
          agentId,
          workspaceId,
          success: result.success,
          error: result.error,
        });

        return result;
      } catch (error) {
        logger.error('Debug: Backend-initiated resume failed', {
          agentId,
          workspaceId,
          error,
        });
        return { success: false, error: String(error) };
      }
    },
  );

  logger.info('Debug IPC handlers registered', {
    channels: Object.values(IPC_CHANNELS.DEBUG),
  });
}
