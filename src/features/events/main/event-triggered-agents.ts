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

    // Guard: check if agent was recently deleted (prevents resurrection from persistence backup)
    if (handler.isAgentDeleted(toAgentId)) {
      logger.warn('[MESSAGE-DELIVERY] Target agent has been deleted', {
        toAgentId,
        fromAgentId,
      });
      return;
    }

    // Format the message with context about the sender
    const priorityLabel = priority === 'interrupt' ? ' (INTERRUPT)' : priority === 'high' ? ' (HIGH PRIORITY)' : '';
    const formattedMessage = `**Message from agent "${fromAgentName}"${priorityLabel}:**\n\n${message}`;

    // Check if the target agent is currently streaming
    const activeStreams = handler.getActiveStreams();
    const isStreaming = activeStreams.some((s) => s.agentId === toAgentId);

    if (priority === 'interrupt' && isStreaming) {
      // Interrupt priority: stop the current stream and send the message immediately
      logger.info('[MESSAGE-DELIVERY] Interrupt priority - stopping current stream to deliver message', {
        toAgentId,
        fromAgentId,
      });

      try {
        // stopAgent calls handleStopSession which marks the agent as interrupted
        // (adds to interruptedAgents set), preventing processNextQueuedMessage from
        // automatically picking up queued messages after the stream finalizes.
        // The partial response is preserved via the existing handleStreamCompletion flow.
        await handler.stopAgent(toAgentId, 'agent_interrupt_message');

        logger.info('[MESSAGE-DELIVERY] Stream stopped, sending interrupt message directly', {
          toAgentId,
          fromAgentId,
        });

        // Now send the interrupt message directly
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
          logger.info('[MESSAGE-DELIVERY] ✓ Interrupt message sent successfully', {
            toAgentId,
            fromAgentId,
          });
        } else {
          logger.error('[MESSAGE-DELIVERY] ✗ Failed to send interrupt message after stopping stream', {
            toAgentId,
            error: sendResult.error,
            errorCode: sendResult.errorCode,
          });
          // Fall back to queueing if direct send fails after interrupt
          logger.info('[MESSAGE-DELIVERY] Attempting queue fallback after failed interrupt send', {
            toAgentId,
            fromAgentId,
          });
          const queueResult = await handler.handleQueueMessage(null, {
            agentId: toAgentId,
            content: formattedMessage,
          });
          if (!queueResult.success) {
            // Both direct send and queue fallback failed — clear the interrupted flag
            // so the agent doesn't remain permanently suppressed (no idle events, no
            // queue processing). The delivery failure event will notify the sender.
            handler.clearInterruptedFlag(toAgentId);
            await emitMessageDeliveryFailure(
              workspaceId,
              fromAgentId,
              fromAgentName,
              toAgentId,
              sendResult.error || 'Failed to send interrupt message and queue fallback failed',
            );
          } else {
            // Clear the interrupted flag so processNextQueuedMessage can pick up
            // the queued message on the next cycle. Without this, the flag set by
            // stopAgent causes processNextQueuedMessage to return early, deadlocking
            // the queued message.
            handler.clearInterruptedFlag(toAgentId);
            logger.info('[MESSAGE-DELIVERY] ✓ Message queued as fallback after failed interrupt send', {
              toAgentId,
              fromAgentId,
            });
          }
        }
      } catch (stopError) {
        logger.error('[MESSAGE-DELIVERY] ✗ Failed to stop agent for interrupt delivery', stopError as Error, {
          toAgentId,
          fromAgentId,
        });
        // Fall back to queueing if we can't stop the stream
        const queueResult = await handler.handleQueueMessage(null, {
          agentId: toAgentId,
          content: formattedMessage,
        });
        if (!queueResult.success) {
          // stopAgent may have set the interrupted flag before throwing — clear it
          // so the agent doesn't remain permanently suppressed.
          handler.clearInterruptedFlag(toAgentId);
          await emitMessageDeliveryFailure(
            workspaceId,
            fromAgentId,
            fromAgentName,
            toAgentId,
            `Failed to stop agent and queue fallback failed: ${queueResult.error}`,
          );
        } else {
          // Clear the interrupted flag so processNextQueuedMessage can pick up
          // the queued message. stopAgent may have set this flag before throwing.
          handler.clearInterruptedFlag(toAgentId);
          logger.info('[MESSAGE-DELIVERY] ✓ Interrupt message queued via fallback after stop failure', {
            toAgentId,
            messageId: queueResult.queuedMessage?.id,
          });
        }
      }
    } else if (isStreaming) {
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
      } else if (sendResult.errorCode === 'QUEUE_PENDING' || sendResult.errorCode === 'ALREADY_STREAMING') {
        // Agent has queued messages being processed or is streaming — fall back to queuing
        // so the message is delivered after the current stream completes.
        logger.info('[MESSAGE-DELIVERY] Agent busy (queue pending or streaming), falling back to queue', {
          toAgentId,
          fromAgentId,
          errorCode: sendResult.errorCode,
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
