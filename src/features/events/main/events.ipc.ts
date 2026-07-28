/**
 * Events IPC Handlers
 *
 * Thin Redux dispatch bridge: every IPC call either dispatches an action
 * or reads from the main-process Redux store / EventStore (I/O utility).
 *
 * No EventBus imports — persistence, broadcast, and dedup are handled by sagas.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { EVENTS_CHANNELS } from '../../../shared/ipc/channels';
import type { WorkspaceEvent } from '../types';
import { filterEventsForSubscription } from '../event-filter-engine';
import { mainDispatch, getMainState } from '../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent as reduxEmitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import {
  selectRecentEvents,
  selectEventsByType,
} from '../../../store/main/slices/workspace-events/workspace-events-selectors';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  EventsEmitSchema,
  EventsSubscribeSchema,
  EventsUnsubscribeSchema,
  EventsGetLastEventSchema,
  EventsGetStatisticsSchema,
} from '../../../main/ipc-schemas';
import {
  addRendererSubscription,
  clearRendererSubscriptions,
  removeRendererSubscription,
  rendererSubscriptions,
  windowCloseListeners,
} from './renderer-subscription-registry';

const logger = new Logger('EventsIPC');

/**
 * Setup IPC handlers for events system
 */
export function setupEventsIPC(): void {
  // Emit event from renderer — always dispatch through Redux
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

          // Dispatch through Redux — sagas handle dedup, persistence, and broadcast
          mainDispatch(reduxEmitWorkspaceEvent(validated.event));

          return { success: true };
        } catch (error) {
          logger.error('Failed to emit event from renderer', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.EMIT,
    ),
  );

  // Subscribe to events from renderer — watch Redux store for new events
  ipcMain.handle(
    EVENTS_CHANNELS.SUBSCRIBE,
    createSafeValidatedHandler(
      EventsSubscribeSchema,
      async (event, validated) => {
        try {
          const windowId = event.sender.id;
          const win = BrowserWindow.fromId(windowId);

          if (!win || win.isDestroyed()) {
            logger.debug('Skipping renderer subscription for destroyed window', {
              windowId,
              subscriptionId: validated.subscriptionId,
            });
            return { success: true, subscriptionId: validated.subscriptionId };
          }

          // Send historical events if requested
          if (validated.includeHistorical) {
            const initState = getMainState();
            const initWsSlice = initState.workspaceEvents.byWorkspaceId;

            // Collect events from all workspaces (filters will narrow down)
            const allEvents: WorkspaceEvent[] = [];
            for (const wsId of Object.keys(initWsSlice)) {
              allEvents.push(...selectRecentEvents.select(initState, wsId));
            }
            const matching = filterEventsForSubscription(allEvents, validated.filters)
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
              .slice(-(validated.historicalLimit ?? 50));

            for (const evt of matching) {
              win.webContents.send('workspace:event', evt);
            }
          }

          // Register subscription — the renderer-subscription saga delivers
          // new events via takeEvery(emitWorkspaceEvent), so no store.subscribe()
          // is needed. Performance is proportional to event rate, not action rate.
          addRendererSubscription(validated.subscriptionId, {
            windowId,
            filters: validated.filters,
          });

          // Register cleanup when the BrowserWindow closes so we don't leak
          // subscriptions after the renderer is gone.
          const subId = validated.subscriptionId;
          const onClosed = () => {
            const toRemove: string[] = [];
            for (const [id, info] of rendererSubscriptions.entries()) {
              if (info.windowId === windowId) {
                toRemove.push(id);
              }
            }
            for (const id of toRemove) {
              removeRendererSubscription(id);
            }
            if (toRemove.length > 0) {
              logger.info('Cleaned up renderer subscriptions on window close', {
                windowId,
                count: toRemove.length,
              });
            }
          };
          win.once('closed', onClosed);

          // Track the window listener so we can remove it if the subscription
          // is explicitly unsubscribed before the window closes.
          windowCloseListeners.set(subId, { window: win, listener: onClosed });

          logger.debug('Renderer subscription created', {
            windowId,
            subscriptionId: validated.subscriptionId,
            filterCount: validated.filters.length,
          });

          return { success: true, subscriptionId: validated.subscriptionId };
        } catch (error) {
          logger.error('Failed to create subscription', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.SUBSCRIBE,
    ),
  );

  // Unsubscribe from events — remove subscription from registry
  ipcMain.handle(
    EVENTS_CHANNELS.UNSUBSCRIBE,
    createSafeValidatedHandler(
      EventsUnsubscribeSchema,
      async (_event, validated) => {
        try {
          removeRendererSubscription(validated.subscriptionId);

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

  // NOTE: the `events:query` handler was removed — historical event reads are
  // daemon-owned (`event.query`, PROTOCOL §5.10) and resolve in the renderer
  // via `appClient.events.query` over the JSON-RPC bridge.

  // Get last event — use Redux selector
  ipcMain.handle(
    EVENTS_CHANNELS.GET_LAST_EVENT,
    createSafeValidatedHandler(
      EventsGetLastEventSchema,
      async (_event, validated) => {
        try {
          if (validated.workspaceId) {
            const state = getMainState();
            const events = selectEventsByType.select(state, validated.workspaceId, validated.type);
            // selectEventsByType returns events in buffer order; last element is most recent
            return events.length > 0 ? events[events.length - 1] : null;
          }
          // No workspaceId — scan all workspaces in Redux state
          const state = getMainState();
          const wsSlice = state.workspaceEvents.byWorkspaceId;
          let latest: WorkspaceEvent | null = null;
          for (const wsId of Object.keys(wsSlice)) {
            const events = selectEventsByType.select(state, wsId, validated.type);
            const last = events.length > 0 ? events[events.length - 1] : undefined;
            if (last && (!latest || last.timestamp > latest.timestamp)) {
              latest = last;
            }
          }
          return latest;
        } catch (error) {
          logger.error('Failed to get last event', { error });
          throw error;
        }
      },
      EVENTS_CHANNELS.GET_LAST_EVENT,
    ),
  );

  // Get statistics — derive from Redux state
  ipcMain.handle(
    EVENTS_CHANNELS.GET_STATISTICS,
    createSafeValidatedHandler(
      EventsGetStatisticsSchema,
      async () => {
        try {
          const state = getMainState();
          const wsSlice = state.workspaceEvents.byWorkspaceId;
          let totalCached = 0;
          for (const wsId of Object.keys(wsSlice)) {
            totalCached += selectRecentEvents.select(state, wsId).length;
          }
          return {
            subscriberCount: rendererSubscriptions.size,
            cachedEventCount: totalCached,
          };
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
        const { selectAgentSubscriptions, selectDelegationGroupsForParent, selectAgentStatus } =
          await import('../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors');
        const { getMainState } = await import('../../../store/main/redux-store-bridge');
        const state = getMainState();
        const subscriptions = selectAgentSubscriptions.select(
          state,
          params.workspaceId,
          params.agentId,
        );
        const delegationGroups = selectDelegationGroupsForParent.select(
          state,
          params.workspaceId,
          params.agentId,
        );

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
          agentStatuses[agentId] = selectAgentStatus.select(state, params.workspaceId, agentId);
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
                : selectAgentStatus.select(state, params.workspaceId, aid);
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
    parts.push(m.events_ipc_fromAgents_description({ count: sub.filter.actorIds.length }));
  }

  return parts.length > 0 ? parts.join(' ') : m.events_ipc_subscribed_description();
}

/**
 * Cleanup IPC handlers
 */
export function cleanupEventsIPC(): void {
  // Remove all IPC handlers
  ipcMain.removeHandler(EVENTS_CHANNELS.EMIT);
  ipcMain.removeHandler(EVENTS_CHANNELS.SUBSCRIBE);
  ipcMain.removeHandler(EVENTS_CHANNELS.UNSUBSCRIBE);
  ipcMain.removeHandler(EVENTS_CHANNELS.GET_LAST_EVENT);
  ipcMain.removeHandler(EVENTS_CHANNELS.GET_STATISTICS);
  ipcMain.removeHandler(EVENTS_CHANNELS.GET_AGENT_SUBSCRIPTIONS);

  // Clear all renderer subscriptions (no store.subscribe to tear down —
  // event delivery is handled by the renderer-subscription saga)
  clearRendererSubscriptions();

  // Remove all window close listeners
  for (const wcl of windowCloseListeners.values()) {
    wcl.window.removeListener('closed', wcl.listener);
  }
  windowCloseListeners.clear();

  logger.info('Events IPC handlers cleaned up');
}
