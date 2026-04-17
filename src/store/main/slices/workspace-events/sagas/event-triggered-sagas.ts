/**
 * Event-triggered sagas.
 *
 * Replaces the legacy event handler registry + event-triggered-agents pattern
 * with sagas that watch `workspaceEventAccepted` and filter by event type.
 *
 * Handles:
 * 1. agent:message:sent → message delivery between agents
 * 2. agent:idle → auto-commit of agent changes
 * 3. agent:idle → OS notification + bell (NotificationService)
 */

import { call, takeEvery } from "typed-redux-saga";
import { workspaceEventAccepted } from "../workspace-events-slice";
import type {
  AgentIdleEvent,
  AgentMessageSentEvent,
} from "../../../../../features/events/types";

// ---------------------------------------------------------------------------
// 1. Message delivery: agent:message:sent
//
// Moved here from event-triggered-agents.ts during Redux migration cleanup.
// ---------------------------------------------------------------------------

function* handleMessageSentEvent(
  action: ReturnType<typeof workspaceEventAccepted>,
) {
  const [event] = action.payload;
  if (event.type !== "agent:message:sent") return;

  yield* call(async () => {
    await deliverAgentMessage(event as AgentMessageSentEvent);
  });
}

/**
 * Deliver a message from one agent to another.
 * If the target is streaming, the message is queued.
 * If idle, it's sent directly.
 * Interrupt priority stops the current stream first.
 */
async function deliverAgentMessage(event: AgentMessageSentEvent): Promise<void> {
  const { AgentBackendHandler } = await import(
    "../../../../../features/agent/main/agent-backend-handler.service"
  );
  const { Logger } = await import("../../../../../shared/logger");
  const logger = new Logger("EventTriggeredAgents");

  const { workspaceId, data } = event;
  const { fromAgentId, fromAgentName, toAgentId, message, priority } = data;

  logger.info('[MESSAGE-DELIVERY] ▶ Handler triggered for agent:message:sent', {
    workspaceId, fromAgentId, fromAgentName, toAgentId, priority,
    messageLength: message?.length,
  });

  try {
    const handler = AgentBackendHandler.getInstance();
    const targetAgent = await handler.getAgent(toAgentId);
    if (!targetAgent) {
      logger.warn('[MESSAGE-DELIVERY] Target agent not found', { toAgentId, fromAgentId });
      return;
    }
    if (handler.isAgentDeleted(toAgentId)) {
      logger.warn('[MESSAGE-DELIVERY] Target agent has been deleted', { toAgentId, fromAgentId });
      return;
    }

    const priorityLabel = priority === 'interrupt' ? ' (INTERRUPT)' : priority === 'high' ? ' (HIGH PRIORITY)' : '';
    const formattedMessage = `**Message from agent "${fromAgentName}"${priorityLabel}:**\n\n${message}`;

    const activeStreams = handler.getActiveStreams();
    const isStreaming = activeStreams.some((s) => s.agentId === toAgentId);

    if (priority === 'interrupt' && isStreaming) {
      try {
        await handler.stopAgent(toAgentId, 'agent_interrupt_message');
        const sendResult = await handler.sendBackendInitiatedMessage({
          sessionId: toAgentId, message: formattedMessage, workspaceId,
          messageMetadata: { type: 'agent_message', fromAgentId, fromAgentName, priority },
        });
        if (!sendResult.success) {
          const queueResult = await handler.handleQueueMessage(null, { agentId: toAgentId, content: formattedMessage });
          if (!queueResult.success) {
            handler.clearInterruptedFlag(toAgentId);
            await emitMessageDeliveryFailure(workspaceId, fromAgentId, fromAgentName, toAgentId, sendResult.error || 'Failed to send interrupt message and queue fallback failed');
          } else {
            handler.clearInterruptedFlag(toAgentId);
          }
        }
      } catch  {
        const queueResult = await handler.handleQueueMessage(null, { agentId: toAgentId, content: formattedMessage });
        if (!queueResult.success) {
          handler.clearInterruptedFlag(toAgentId);
          await emitMessageDeliveryFailure(workspaceId, fromAgentId, fromAgentName, toAgentId, `Failed to stop agent and queue fallback failed: ${queueResult.error}`);
        } else {
          handler.clearInterruptedFlag(toAgentId);
        }
      }
    } else if (isStreaming) {
      const queueResult = await handler.handleQueueMessage(null, { agentId: toAgentId, content: formattedMessage });
      if (!queueResult.success) {
        await emitMessageDeliveryFailure(workspaceId, fromAgentId, fromAgentName, toAgentId, queueResult.error || 'Failed to queue message');
      }
    } else {
      const sendResult = await handler.sendBackendInitiatedMessage({
        sessionId: toAgentId, message: formattedMessage, workspaceId,
        messageMetadata: { type: 'agent_message', fromAgentId, fromAgentName, priority },
      });
      if (!sendResult.success) {
        if (sendResult.errorCode === 'QUEUE_PENDING' || sendResult.errorCode === 'ALREADY_STREAMING') {
          const queueResult = await handler.handleQueueMessage(null, { agentId: toAgentId, content: formattedMessage });
          if (!queueResult.success) {
            await emitMessageDeliveryFailure(workspaceId, fromAgentId, fromAgentName, toAgentId, queueResult.error || 'Failed to queue message');
          }
        } else {
          await emitMessageDeliveryFailure(workspaceId, fromAgentId, fromAgentName, toAgentId, sendResult.error || 'Failed to send message');
        }
      }
    }
  } catch (error) {
    logger.error('[MESSAGE-DELIVERY] Error handling agent:message:sent event', error as Error, { workspaceId, fromAgentId, toAgentId });
    try {
      await emitMessageDeliveryFailure(workspaceId, fromAgentId, fromAgentName, toAgentId, error instanceof Error ? error.message : 'Unknown error');
    } catch { /* ignore */ }
  }
}

async function emitMessageDeliveryFailure(workspaceId: string, fromAgentId: string, fromAgentName: string, toAgentId: string, errorMessage: string): Promise<void> {
  try {
    const { mainDispatch } = await import("../../../../../store/main/redux-store-bridge");
    const { emitWorkspaceEvent } = await import("../workspace-events-slice");
    const { createWorkspaceEvent } = await import("../../../../../features/events/types");
    mainDispatch(emitWorkspaceEvent(
      createWorkspaceEvent('agent:message:delivery-failed', workspaceId, { type: 'agent', id: fromAgentId, name: fromAgentName }, { fromAgentId, toAgentId, error: errorMessage, timestamp: new Date().toISOString() }),
    ));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 2. Auto-commit: agent:idle
// ---------------------------------------------------------------------------

function* handleAgentIdleAutoCommit(
  action: ReturnType<typeof workspaceEventAccepted>,
) {
  const [event] = action.payload;
  if (event.type !== "agent:idle") return;

  yield* call(async () => {
    const { handleAgentIdleAutoCommit: handler } = await import(
      "../../../../../features/agent/main/auto-commit.service"
    );
    await handler(event as any);
  });
}

// ---------------------------------------------------------------------------
// 3. OS notification + bell: agent:idle
//
// Runs in parallel with handleAgentIdleAutoCommit. Errors here must never
// affect auto-commit or message delivery, so we swallow and log them.
// ---------------------------------------------------------------------------

export function* handleAgentIdleNotification(
  action: ReturnType<typeof workspaceEventAccepted>,
) {
  const [event] = action.payload;
  if (event.type !== "agent:idle") return;

  yield* call(async () => {
    try {
      const { getNotificationService } = await import(
        "../../../../../features/notifications/main/notification.service"
      );
      await getNotificationService(event.workspaceId).handleAgentIdle(
        event as AgentIdleEvent,
      );
    } catch (error) {
      const { Logger } = await import("../../../../../shared/logger");
      const logger = new Logger("EventTriggeredAgents");
      logger.error(
        "[NOTIFICATION] Error handling agent:idle notification",
        error as Error,
        { workspaceId: event.workspaceId },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* eventTriggeredSagas() {
  yield* takeEvery(workspaceEventAccepted, handleMessageSentEvent);
  yield* takeEvery(workspaceEventAccepted, handleAgentIdleAutoCommit);
  yield* takeEvery(workspaceEventAccepted, handleAgentIdleNotification);
}

