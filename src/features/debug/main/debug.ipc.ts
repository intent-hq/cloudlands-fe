/**
 * Debug IPC Handlers
 *
 * Development-only handlers for testing backend-initiated flows.
 * These handlers are NOT registered in production.
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
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

      // messageMetadata was FE-only bookkeeping on the retired
      // sendBackendInitiatedMessage path; the daemon `agent.sendMessage`
      // (PROTOCOL.md §5.5) has no such param, so it stays log-only here.
      const messageMetadata = {
        type: 'debug_test',
        source: 'debug:trigger-backend-resume',
        timestamp: new Date().toISOString(),
      };
      logger.debug('Debug: wake messageMetadata (log-only, not sent on the wire)', {
        agentId,
        workspaceId,
        messageMetadata,
      });

      const content =
        message ||
        // i18n-ignore (dev-only debug test message)
        `[DEBUG] Backend-initiated wake test at ${new Date().toISOString()}. ` +
          // i18n-ignore (dev-only debug test message)
          'This message was sent to test the frontend handshake flow. ' +
          // i18n-ignore (dev-only debug test message)
          'Please acknowledge receipt.';

      try {
        // Route through the daemon (PROTOCOL.md §5.5 `agent.sendMessage`): the
        // daemon auto-queues when the target is mid-turn, returning
        // `{ success, queued, messageId? }`. Per the §5.5 migration note,
        // `queued: true` replaces the FE-only `errorCode: "ALREADY_STREAMING"`
        // signal — treat it as the "already streaming" case for the debug flow
        // (still a successful delivery, just queued behind the in-flight turn).
        const result = (await getBackendClient().request('agent.sendMessage', {
          agentId,
          content,
          workspaceId,
        })) as { success?: boolean; queued?: boolean; messageId?: string };

        logger.info('Debug: Backend-initiated resume result', {
          agentId,
          workspaceId,
          success: result?.success ?? false,
          queued: result?.queued ?? false,
          messageId: result?.messageId,
        });

        return {
          success: result?.success ?? false,
          queued: result?.queued ?? false,
          messageId: result?.messageId,
        };
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
