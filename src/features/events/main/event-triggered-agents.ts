/**
 * Event-Triggered Background Agents
 *
 * Handlers that spawn background agents in response to workspace events.
 *
 * This follows the BackgroundAgentExecutor pattern but triggered by
 * system events rather than UI interactions.
 */

import { Logger } from '../../../shared/logger';
import { eventHandlerRegistry, type EventHandler } from './event-handler-registry';
import { AgentBackendHandler } from '../../agent/main/agent-backend-handler.service';
import type { AgentMessageSentEvent } from '../types';

const logger = new Logger('EventTriggeredAgents');

/**
 * Handle agent:message:sent event
 *
 * When an agent sends a message to another agent, this handler delivers
 * the message to the target agent. If the target is currently streaming,
 * the message is queued. If idle, it's sent directly.
 */
export const handleAgentMessageSent: EventHandler<AgentMessageSentEvent> = async (event) => {
  const { workspaceId, data } = event;
  const { fromAgentId, fromAgentName, toAgentId, message, priority } = data;

  logger.info('[MESSAGE-DELIVERY] ▶ Handler triggered for agent:message:sent', {
    workspaceId,
    fromAgentId,
    fromAgentName,
    toAgentId,
    priority,
    messageLength: message?.length,
  });

  try {
    const handler = AgentBackendHandler.getInstance();

    // Check if target agent exists
    const targetAgent = await handler.getAgent(toAgentId);
    if (!targetAgent) {
      logger.warn('[MESSAGE-DELIVERY] Target agent not found', {
        toAgentId,
        fromAgentId,
      });
      return;
    }

    // Format the message with context about the sender
    const formattedMessage = `**Message from agent "${fromAgentName}"${priority === 'high' ? ' (HIGH PRIORITY)' : ''}:**\n\n${message}`;

    // Check if the target agent is currently streaming
    const activeStreams = handler.getActiveStreams();
    const isStreaming = activeStreams.some((s) => s.agentId === toAgentId);

    if (isStreaming) {
      // Agent is busy - queue the message
      logger.info('[MESSAGE-DELIVERY] Target agent is streaming, queueing message', {
        toAgentId,
        fromAgentId,
      });

      const queueResult = await handler.handleQueueMessage(null, {
        agentId: toAgentId,
        content: formattedMessage,
      });

      if (queueResult.success) {
        logger.info('[MESSAGE-DELIVERY] ✓ Message queued successfully', {
          toAgentId,
          messageId: queueResult.queuedMessage?.id,
        });
      } else {
        logger.error('[MESSAGE-DELIVERY] ✗ Failed to queue message', {
          toAgentId,
          error: queueResult.error,
        });
        // ROBUSTNESS: Emit failure event so the sending agent can be notified
        await emitMessageDeliveryFailure(
          workspaceId,
          fromAgentId,
          fromAgentName,
          toAgentId,
          queueResult.error || 'Failed to queue message',
        );
      }
    } else {
      // Agent is idle - send the message directly
      logger.info('[MESSAGE-DELIVERY] Target agent is idle, sending message directly', {
        toAgentId,
        fromAgentId,
      });

      const sendResult = await handler.sendBackendInitiatedMessage({
        sessionId: toAgentId,
        message: formattedMessage,
        workspaceId,
        messageMetadata: {
          type: 'agent_message',
          fromAgentId,
          fromAgentName,
          priority,
        },
      });

      if (sendResult.success) {
        logger.info('[MESSAGE-DELIVERY] ✓ Message sent successfully', {
          toAgentId,
          fromAgentId,
        });
      } else if ((sendResult as any).errorCode === 'QUEUE_PENDING' || (sendResult as any).errorCode === 'ALREADY_STREAMING') {
        // Agent has queued messages being processed or is streaming — fall back to queuing
        // so the message is delivered after the current stream completes.
        logger.info('[MESSAGE-DELIVERY] Agent busy (queue pending or streaming), falling back to queue', {
          toAgentId,
          fromAgentId,
          errorCode: (sendResult as any).errorCode,
        });
        const queueResult = await handler.handleQueueMessage(null, {
          agentId: toAgentId,
          content: formattedMessage,
        });
        if (!queueResult.success) {
          logger.error('[MESSAGE-DELIVERY] ✗ Fallback queue also failed', {
            toAgentId,
            error: queueResult.error,
          });
          await emitMessageDeliveryFailure(
            workspaceId,
            fromAgentId,
            fromAgentName,
            toAgentId,
            queueResult.error || 'Failed to queue message',
          );
        } else {
          logger.info('[MESSAGE-DELIVERY] ✓ Message queued via fallback', {
            toAgentId,
            messageId: queueResult.queuedMessage?.id,
          });
        }
      } else {
        logger.error('[MESSAGE-DELIVERY] ✗ Failed to send message', {
          toAgentId,
          error: sendResult.error,
        });
        // ROBUSTNESS: Emit failure event so the sending agent can be notified
        await emitMessageDeliveryFailure(
          workspaceId,
          fromAgentId,
          fromAgentName,
          toAgentId,
          sendResult.error || 'Failed to send message',
        );
      }
    }
  } catch (error) {
    logger.error('[MESSAGE-DELIVERY] Error handling agent:message:sent event', error as Error, {
      workspaceId,
      fromAgentId,
      toAgentId,
    });
    // ROBUSTNESS: Emit failure event for unexpected errors too
    try {
      await emitMessageDeliveryFailure(
        workspaceId,
        fromAgentId,
        fromAgentName,
        toAgentId,
        error instanceof Error ? error.message : 'Unknown error',
      );
    } catch {
      // Ignore errors emitting failure event
    }
  }
};

/**
 * Emit a message delivery failure event.
 * This notifies the sending agent that their message could not be delivered,
 * allowing them to take corrective action (e.g., retry, notify user, etc.)
 */
async function emitMessageDeliveryFailure(
  workspaceId: string,
  fromAgentId: string,
  fromAgentName: string,
  toAgentId: string,
  errorMessage: string,
): Promise<void> {
  try {
    const { getWorkspaceEventBus } = await import('./workspace-event-bus');
    const { createWorkspaceEvent } = await import('../types');

    const bus = getWorkspaceEventBus(workspaceId);
    bus.emitEvent(
      createWorkspaceEvent(
        'agent:message:delivery-failed',
        workspaceId,
        { type: 'agent', id: fromAgentId, name: fromAgentName },
        {
          fromAgentId,
          toAgentId,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        },
      ),
    );

    logger.info('[MESSAGE-DELIVERY] Emitted delivery failure event', {
      fromAgentId,
      toAgentId,
      error: errorMessage,
    });
  } catch (emitError) {
    logger.warn('[MESSAGE-DELIVERY] Failed to emit delivery failure event', {
      fromAgentId,
      toAgentId,
      emitError,
    });
  }
}

/**
 * Register all event-triggered background agents
 *
 * Call this during app initialization before EventHandlerRegistry.initialize()
 */
export function registerEventTriggeredAgents(): void {
  logger.info('Registering event-triggered agents');

  // Message delivery: deliver messages from one agent to another
  eventHandlerRegistry.register('agent:message:sent', handleAgentMessageSent, {
    name: 'handleAgentMessageSent',
  });

  // Auto-commit: commit agent changes when tasks complete
  // Import dynamically to avoid circular dependencies
  import('../../agent/main/auto-commit.service')
    .then(({ registerAutoCommitHandler }) => {
      registerAutoCommitHandler();
    })
    .catch((error) => {
      logger.error('Failed to register auto-commit handler', error as Error);
    });

  logger.info('Event-triggered agents registered', {
    stats: eventHandlerRegistry.getStats(),
  });
}
