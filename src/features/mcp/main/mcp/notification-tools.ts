/**
 * MCP Notification Tools
 *
 * Provides an MCP tool for emitting notification events via Redux dispatch.
 * Used by external services (e.g. notification-daemon) to deliver notifications to subscribed agents.
 */

import { Tool } from './tool';
import { ToolCall, ToolResult } from './protocol';
import { createWorkspaceEvent } from '../../../events/types';
import { Logger } from '../../../../shared/logger';
import { mainDispatch } from '../../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent as reduxEmitWorkspaceEvent } from '../../../../store/main/slices/workspace-events/workspace-events-slice';

const logger = new Logger('MCPNotificationTools');

/**
 * Tool to emit a notification event via Redux dispatch.
 */
export class EmitNotificationTool extends Tool {
  constructor(private workspaceId: string) {
    super();
  }

  getDefinition() {
    return {
      name: 'emit_notification',
      description:
        'Emit a notification event into the workspace event system. Used by external services to deliver notifications to subscribed agents.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topic: {
            type: 'string',
            description: 'Notification topic (e.g. "notifications.spec-implement")',
          },
          message: {
            type: 'string',
            description: 'Notification message content',
          },
          metadata: {
            type: 'string',
            description:
              'Optional JSON-encoded metadata object. Pre-parsed objects are also accepted at runtime.',
          },
        },
        required: ['topic', 'message'],
        additionalProperties: false,
      },
    };
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { topic, message, metadata: metadataStr } = call.arguments;

      if (!topic || !message) {
        return this.error('Both "topic" and "message" are required');
      }

      // Validate workspace exists before emitting
      const { protocolAdapter } = await import(
        '../../../../features/protocol/main/protocol-adapter'
      );
      const workspace = await protocolAdapter.getWorkspace(this.workspaceId);
      if (!workspace) {
        return this.error(`Workspace "${this.workspaceId}" not found`);
      }

      let parsedMetadata: Record<string, any> | undefined;
      if (metadataStr) {
        try {
          let candidate: unknown;
          if (typeof metadataStr === 'object') {
            // Already parsed (MCPServer doesn't validate against inputSchema)
            candidate = metadataStr;
          } else if (typeof metadataStr === 'string') {
            candidate = JSON.parse(metadataStr);
          }
          // Validate it's a non-null plain object (Record<string, any>)
          if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
            parsedMetadata = candidate as Record<string, any>;
          } else {
            logger.warn('Metadata is not a plain object, discarding', { metadata: metadataStr });
            parsedMetadata = undefined;
          }
        } catch (parseError) {
          logger.warn('Failed to parse metadata JSON, continuing with empty metadata', {
            metadataStr,
            error: (parseError as Error).message,
          });
          parsedMetadata = undefined;
        }
      }

      // Try to wake the source agent directly if specified in metadata
      let agentWoken = false;
      const rawSourceAgent = parsedMetadata?.source_agent;
      const sourceAgent = typeof rawSourceAgent === 'string' && rawSourceAgent.length > 0
        ? rawSourceAgent
        : undefined;

      if (sourceAgent) {
        try {
          const { AgentBackendHandler } =
            await import('../../../agent/main/agent-backend-handler.service');
          const handler = AgentBackendHandler.getInstance();
          const resumability = await handler.getAgentResumability(sourceAgent, this.workspaceId);

          if (resumability.canWake) {
            // Format as [WORKSPACE EVENTS] message — same format agents receive from event subscriptions
            const notificationMessage = [
              '[WORKSPACE EVENTS]',
              'You have received 1 workspace event while you were working:',
              '',
              `1. [mcp:notification] Notification on topic "${topic}"`,
              `   - Message: ${message}`,
              ...(parsedMetadata ? [`   - Metadata: ${JSON.stringify(parsedMetadata)}`] : []),
              '',
              'Consider these events and take appropriate action if needed.',
            ].join('\n');

            const wakeResult = await handler.sendBackendInitiatedMessage({
              sessionId: sourceAgent,
              workspaceId: this.workspaceId,
              message: notificationMessage,
              messageMetadata: {
                type: 'mcp_notification',
                topic,
                source: 'emit_notification',
              },
            });

            if (wakeResult.success) {
              agentWoken = true;
              logger.info('Successfully woke source agent for notification', {
                agentId: sourceAgent,
                topic,
                workspaceId: this.workspaceId,
              });
            } else {
              logger.warn('Failed to wake source agent for notification, falling back to event dispatch only', {
                agentId: sourceAgent,
                topic,
                workspaceId: this.workspaceId,
                error: wakeResult.error,
              });
            }
          } else {
            logger.warn('Source agent is not resumable, falling back to event dispatch only', {
              agentId: sourceAgent,
              topic,
              workspaceId: this.workspaceId,
              status: resumability.status,
            });
          }
        } catch (wakeError) {
          logger.warn('Error attempting to wake source agent, falling back to event dispatch only', {
            agentId: sourceAgent,
            topic,
            workspaceId: this.workspaceId,
            error: (wakeError as Error).message,
          });
        }
      }

      // Always emit the event via Redux dispatch (broadcast for any other subscribers)
      const event = createWorkspaceEvent(
        'mcp:notification',
        this.workspaceId,
        { type: 'external', name: 'notification-daemon' },
        {
          topic,
          message,
          ...(parsedMetadata !== undefined && { metadata: parsedMetadata }),
        },
      );

      mainDispatch(reduxEmitWorkspaceEvent(event));

      logger.debug('Emitted mcp:notification event', { topic, workspaceId: this.workspaceId });

      return this.success(
        JSON.stringify({
          ok: true,
          eventId: event.id,
          topic,
          ...(sourceAgent && { agentWoken, agentId: sourceAgent }),
        }, null, 2),
        {
          topic,
          eventId: event.id,
          ...(sourceAgent && { agentWoken, agentId: sourceAgent }),
        },
      );
    } catch (error) {
      logger.error('Failed to emit notification', error as Error);
      return this.error(`Failed to emit notification: ${(error as Error).message}`);
    }
  }
}

