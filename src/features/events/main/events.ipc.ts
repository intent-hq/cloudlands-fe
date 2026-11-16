/**
 * Events IPC Handlers
 *
 * IPC handlers for renderer event emits and agent subscription reads.
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { EVENTS_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { EventsEmitSchema } from '../../../main/ipc-schemas';
import {
  getAgentSubscriptions,
  getAgentSubscriptionStatus,
  getDelegationGroupsForParent,
} from './agent-subscription-state.service';

const logger = new Logger('EventsIPC');

/**
 * Setup IPC handlers for events system
 */
export function setupEventsIPC(): void {
  // Emit event from renderer. Event persistence and delivery are daemon-owned.
  ipcMain.handle(
    EVENTS_CHANNELS.EMIT,
    createSafeValidatedHandler(
      EventsEmitSchema,
      async (event, validated) => {
        try {
          const windowId = event.sender.id;
          logger.debug('Event received from renderer', {
            windowId,
            eventType: validated.event.type,
            eventId: validated.event.id,
          });

          return { success: true };
        } catch (error) {
          logger.error('Failed to emit event from renderer', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.EMIT,
    ),
  );

  // NOTE: the `events:subscribe` / `events:unsubscribe` handlers were removed —
  // no renderer subscribed, and renderers receive daemon events through the
  // JSON-RPC `events.subscribe` bridge instead.

  // NOTE: the `events:query` handler was removed — historical event reads are
  // daemon-owned (`event.query`, PROTOCOL §5.10) and resolve in the renderer
  // via `appClient.events.query` over the JSON-RPC bridge.

  // Get agent event subscriptions
  ipcMain.handle(
    EVENTS_CHANNELS.GET_AGENT_SUBSCRIPTIONS,
    async (_event, params: { workspaceId: string; agentId: string }) => {
      try {
        const subscriptions = getAgentSubscriptions(params.workspaceId, params.agentId);
        const delegationGroups = getDelegationGroupsForParent(params.workspaceId, params.agentId);

        // Collect all watched agent IDs from subscriptions
        const allWatchedAgentIds = new Set<string>();
        for (const sub of subscriptions) {
          for (const actorId of sub.filter.actorIds || []) {
            allWatchedAgentIds.add(actorId);
          }
        }

        // Get real-time status for all watched agents
        const agentStatuses: Record<string, string> = {};
        for (const agentId of allWatchedAgentIds) {
          agentStatuses[agentId] = getAgentSubscriptionStatus(params.workspaceId, agentId);
        }

        logger.info('Returning agent subscriptions', {
          agentId: params.agentId,
          subscriptionCount: subscriptions.length,
          delegationGroupCount: delegationGroups.length,
          watchedAgentCount: allWatchedAgentIds.size,
        });

        // Map to a simpler format for the frontend
        return {
          success: true,
          data: subscriptions.map((sub) => ({
            id: sub.id,
            agentId: sub.agentId,
            eventTypes: sub.filter.eventTypes || [],
            actorIds: sub.filter.actorIds || [],
            createdAt: sub.createdAt,
            description: describeSubscription(sub),
            // Include delegation group info if present
            delegationGroup: sub.filter.delegationGroup
              ? {
                  groupId: sub.filter.delegationGroup.groupId,
                  awaitMode: sub.filter.delegationGroup.awaitMode,
                  expectedAgentIds: sub.filter.delegationGroup.expectedAgentIds,
                }
              : undefined,
          })),
          // Include delegation group status with agent states
          delegationGroups: delegationGroups.map((group) => {
            const groupAgentStatuses: Record<string, string> = {};
            for (const aid of group.expectedAgentIds) {
              groupAgentStatuses[aid] = group.completedAgentIds.includes(aid)
                ? 'completed'
                : getAgentSubscriptionStatus(params.workspaceId, aid);
            }
            return {
              groupId: group.groupId,
              awaitMode: group.awaitMode,
              expectedAgentIds: group.expectedAgentIds,
              completedAgentIds: group.completedAgentIds,
              deletedAgentIds: group.deletedAgentIds,
              agentStatuses: groupAgentStatuses,
              delivered: group.delivered,
            };
          }),
          // Include real-time status for all watched agents (for 'any' mode subscriptions)
          agentStatuses,
        };
      } catch (error) {
        logger.error('Failed to get agent subscriptions', { error, params });
        return { success: false, error: String(error) };
      }
    },
  );

  // NOTE: the deprecated `events:unsubscribe-agent` handler was dropped —
  // agent event subscriptions are daemon-owned (PROTOCOL §5.10) and the last
  // renderer call sites were removed with it.

  logger.info('Events IPC handlers setup complete');
}

/**
 * Create a human-readable description of a subscription
 */
function describeSubscription(sub: any): string {
  const parts: string[] = [];

  if (sub.filter.eventTypes && sub.filter.eventTypes.length > 0) {
    const types = sub.filter.eventTypes
      .map((t: string) => t.replace('agent:', '').replace(':', ' '))
      .join(', ');
    parts.push(m.events_ipc_waitingFor_description({ types }));
  }

  if (sub.filter.actorIds && sub.filter.actorIds.length > 0) {
    parts.push(
      sub.filter.actorIds.length === 1
        ? m.events_ipc_fromAgents_description_one()
        : m.events_ipc_fromAgents_description_many({ count: sub.filter.actorIds.length }),
    );
  }

  return parts.length > 0 ? parts.join(' ') : m.events_ipc_subscribed_description();
}

/**
 * Cleanup IPC handlers
 */
export function cleanupEventsIPC(): void {
  // Remove all IPC handlers
  ipcMain.removeHandler(EVENTS_CHANNELS.EMIT);
  ipcMain.removeHandler(EVENTS_CHANNELS.GET_AGENT_SUBSCRIPTIONS);

  logger.info('Events IPC handlers cleaned up');
}
