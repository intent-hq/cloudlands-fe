/**
 * Events IPC Handlers
 *
 * IPC handlers for the unified event bus system.
 * Provides communication between renderer and main process.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { Logger } from '../../../shared/logger';
import { unifiedEventBus } from './unified-event-bus';
import { getWorkspaceEventBus } from './workspace-event-bus';
import { EVENTS_CHANNELS } from '../../../shared/ipc/channels';
import type { WorkspaceEvent, EventFilter } from '../types';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  EventsEmitSchema,
  EventsSubscribeSchema,
  EventsUnsubscribeSchema,
  EventsQuerySchema,
  EventsGetLastEventSchema,
  EventsGetStatisticsSchema,
} from '../../../main/ipc-schemas';
import { getBlob } from '../../../shared/git/git-blob-storage';

const logger = new Logger('EventsIPC');

// Track renderer subscriptions
const rendererSubscriptions = new Map<
  string,
  {
    windowId: number;
    filters: EventFilter[];
  }
>();

/**
 * Setup IPC handlers for events system
 */
export function setupEventsIPC(): void {
  // Emit event from renderer
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

          // Emit through WorkspaceEventBus (which handles persistence and forwards to UnifiedEventBus)
          const workspaceId = validated.event.workspaceId;
          if (workspaceId) {
            const bus = getWorkspaceEventBus(workspaceId);
            bus.emitEvent(validated.event);
          } else {
            // Fall back to unified bus for events without workspaceId
            // NOTE: These events are broadcast-only (no persistence) since there's no workspace
            logger.debug('Event without workspaceId - broadcast only, no persistence', {
              eventType: validated.event.type,
              eventId: validated.event.id,
            });
            unifiedEventBus.emitEvent(validated.event, {
              broadcast: validated.options?.broadcast,
            });
          }

          return { success: true };
        } catch (error) {
          logger.error('Failed to emit event from renderer', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.EMIT,
    ),
  );

  // Subscribe to events from renderer
  ipcMain.handle(
    EVENTS_CHANNELS.SUBSCRIBE,
    createSafeValidatedHandler(
      EventsSubscribeSchema,
      async (event, validated) => {
        try {
          const windowId = event.sender.id;

          // Track renderer subscription
          rendererSubscriptions.set(validated.subscriptionId, {
            windowId,
            filters: validated.filters,
          });

          // Create subscription on unified event bus
          const subscription = unifiedEventBus.subscribe({
            filters: validated.filters,
            includeHistorical: validated.includeHistorical,
            historicalLimit: validated.historicalLimit,
            callback: (event: WorkspaceEvent) => {
              // Send event to specific renderer window
              const window = BrowserWindow.fromId(windowId);
              if (window && !window.isDestroyed()) {
                window.webContents.send('workspace:event', event);
              }
            },
          });

          logger.debug('Renderer subscription created', {
            windowId,
            subscriptionId: validated.subscriptionId,
            filterCount: validated.filters.length,
          });

          return { success: true, subscriptionId: subscription.id };
        } catch (error) {
          logger.error('Failed to create subscription', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.SUBSCRIBE,
    ),
  );

  // Unsubscribe from events
  ipcMain.handle(
    EVENTS_CHANNELS.UNSUBSCRIBE,
    createSafeValidatedHandler(
      EventsUnsubscribeSchema,
      async (_event, validated) => {
        try {
          // Remove from tracking
          rendererSubscriptions.delete(validated.subscriptionId);

          // Unsubscribe from unified event bus
          unifiedEventBus.unsubscribe(validated.subscriptionId);

          logger.debug('Renderer subscription removed', {
            subscriptionId: validated.subscriptionId,
          });

          return { success: true };
        } catch (error) {
          logger.error('Failed to unsubscribe', {
            error,
            subscriptionId: validated.subscriptionId,
          });
          throw error;
        }
      },
      EVENTS_CHANNELS.UNSUBSCRIBE,
    ),
  );

  // Query events
  ipcMain.handle(
    EVENTS_CHANNELS.QUERY,
    createSafeValidatedHandler(
      EventsQuerySchema,
      async (_event, validated) => {
        try {
          // Use WorkspaceEventBus for queries when workspaceId is provided
          const bus = getWorkspaceEventBus(validated.workspaceId);
          const events = await bus.queryEvents(validated.filters);
          const limitedEvents = validated.limit ? events.slice(0, validated.limit) : events;

          // Resolve blob SHAs to inline content for file:changed events
          let repoPath: string | undefined;
          const resolvedEvents = await Promise.all(
            limitedEvents.map(async (event) => {
              if (event.type !== 'file:changed') return event;

              const data = event.data as {
                oldContentSha?: string;
                oldContent?: string;
                newContentSha?: string;
                newContent?: string;
              };
              if (!data) return event;

              // Lazily get repoPath only if we need it
              if ((data.oldContentSha || data.newContentSha) && repoPath === undefined) {
                try {
                  const { workspaceService } = await import(
                    '../../workspace/main/workspace.service'
                  );
                  const result = await workspaceService.getWorkspace(
                    validated.workspaceId as import('../../../shared/types').WorkspaceId,
                  );
                  if (result.ok && result.data) {
                    const workspace = result.data as {
                      worktreePath?: string;
                      repositoryPath?: string;
                      path?: string;
                    };
                    repoPath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
                  } else {
                    repoPath = '';
                  }
                } catch {
                  repoPath = '';
                }
              }

              if (!repoPath) return event;

              // Resolve oldContentSha
              if (data.oldContentSha && !data.oldContent) {
                const content = await getBlob(data.oldContentSha, repoPath);
                if (content !== null) data.oldContent = content;
              }

              // Resolve newContentSha
              if (data.newContentSha && !data.newContent) {
                const content = await getBlob(data.newContentSha, repoPath);
                if (content !== null) data.newContent = content;
              }

              return event;
            }),
          );

          logger.debug('Events queried', {
            workspaceId: validated.workspaceId,
            filterCount: validated.filters.length,
            resultCount: resolvedEvents.length,
          });

          return resolvedEvents;
        } catch (error) {
          logger.error('Failed to query events', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.QUERY,
    ),
  );

  // Get last event
  ipcMain.handle(
    EVENTS_CHANNELS.GET_LAST_EVENT,
    createSafeValidatedHandler(
      EventsGetLastEventSchema,
      async (_event, validated) => {
        try {
          // Use WorkspaceEventBus for getting last event if workspaceId is provided
          if (validated.workspaceId) {
            const bus = getWorkspaceEventBus(validated.workspaceId);
            const events = await bus.getLastEvents(validated.type, 1);
            return events[0] || null;
          } else {
            // Fall back to UnifiedEventBus for global queries
            const event = unifiedEventBus.getLastEvent(validated.type);
            return event || null;
          }
        } catch (error) {
          logger.error('Failed to get last event', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.GET_LAST_EVENT,
    ),
  );

  // Get statistics
  ipcMain.handle(
    EVENTS_CHANNELS.GET_STATISTICS,
    createSafeValidatedHandler(
      EventsGetStatisticsSchema,
      async () => {
        try {
          const stats = unifiedEventBus.getStatistics();
          return stats;
        } catch (error) {
          logger.error('Failed to get statistics', { error }, EVENTS_CHANNELS.GET_STATISTICS);
          throw error;
        }
      },
      EVENTS_CHANNELS.GET_STATISTICS,
    ),
  );

  // Get agent event subscriptions
  ipcMain.handle(
    EVENTS_CHANNELS.GET_AGENT_SUBSCRIPTIONS,
    async (_event, params: { workspaceId: string; agentId: string }) => {
      try {
        const { getAgentEventSubscriptionService } =
          await import('./agent-event-subscription.service');
        const subscriptionService = getAgentEventSubscriptionService(params.workspaceId);
        const subscriptions = subscriptionService.getAgentSubscriptions(params.agentId);
        const delegationGroups = subscriptionService.getDelegationGroupsForParent(params.agentId);

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
          agentStatuses[agentId] = subscriptionService.getAgentStatus(agentId);
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
          delegationGroups: delegationGroups.map((group) => ({
            groupId: group.groupId,
            awaitMode: group.awaitMode,
            expectedAgentIds: group.expectedAgentIds,
            completedAgentIds: group.completedAgentIds,
            agentStatuses: group.agentStatuses,
          })),
          // Include real-time status for all watched agents (for 'any' mode subscriptions)
          agentStatuses,
          // Monotonically increasing version for stale response detection
          version: subscriptionService.version,
        };
      } catch (error) {
        logger.error('Failed to get agent subscriptions', { error, params });
        return { success: false, error: String(error) };
      }
    },
  );

  // Unsubscribe all agent event subscriptions for an agent
  // This is used when stopping all agents to prevent the parent from being woken up
  ipcMain.handle(
    EVENTS_CHANNELS.UNSUBSCRIBE_AGENT,
    async (_event, params: { workspaceId: string; agentId: string }) => {
      try {
        const { getAgentEventSubscriptionService } =
          await import('./agent-event-subscription.service');
        const subscriptionService = getAgentEventSubscriptionService(params.workspaceId);
        const count = subscriptionService.unsubscribeAll(params.agentId);

        logger.info('Unsubscribed all agent event subscriptions', {
          agentId: params.agentId,
          workspaceId: params.workspaceId,
          count,
        });

        return { success: true, count };
      } catch (error) {
        logger.error('Failed to unsubscribe agent', { error, params });
        return { success: false, error: String(error) };
      }
    },
  );

  // Clean up subscriptions when window closes
  ipcMain.on('browser-window-closed', (_event, windowId: number) => {
    // Remove all subscriptions for this window
    const toRemove: string[] = [];
    for (const [subscriptionId, info] of rendererSubscriptions.entries()) {
      if (info.windowId === windowId) {
        toRemove.push(subscriptionId);
      }
    }

    for (const subscriptionId of toRemove) {
      rendererSubscriptions.delete(subscriptionId);
      unifiedEventBus.unsubscribe(subscriptionId);
    }

    if (toRemove.length > 0) {
      logger.info('Cleaned up renderer subscriptions', {
        windowId,
        count: toRemove.length,
      });
    }
  });

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
    parts.push(`Waiting for: ${types}`);
  }

  if (sub.filter.actorIds && sub.filter.actorIds.length > 0) {
    parts.push(`from ${sub.filter.actorIds.length} agent(s)`);
  }

  return parts.length > 0 ? parts.join(' ') : 'Subscribed to events';
}

/**
 * Cleanup IPC handlers
 */
export function cleanupEventsIPC(): void {
  // Remove all IPC handlers
  ipcMain.removeHandler(EVENTS_CHANNELS.EMIT);
  ipcMain.removeHandler(EVENTS_CHANNELS.SUBSCRIBE);
  ipcMain.removeHandler(EVENTS_CHANNELS.UNSUBSCRIBE);
  ipcMain.removeHandler(EVENTS_CHANNELS.QUERY);
  ipcMain.removeHandler(EVENTS_CHANNELS.GET_LAST_EVENT);
  ipcMain.removeHandler(EVENTS_CHANNELS.GET_STATISTICS);
  ipcMain.removeHandler(EVENTS_CHANNELS.GET_AGENT_SUBSCRIPTIONS);
  ipcMain.removeHandler(EVENTS_CHANNELS.UNSUBSCRIBE_AGENT);

  // Clear subscriptions
  rendererSubscriptions.clear();

  logger.info('Events IPC handlers cleaned up');
}
