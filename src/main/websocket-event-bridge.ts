/**
 * WebSocket Event Bridge
 *
 * Transport adapter for external WebSocket API event subscriptions.
 * Accepts JSON-RPC subscribe/unsubscribe requests and forwards matching
 * events as JSON-RPC notifications.
 *
 * The subscription maps below are transport-local runtime state, not domain
 * state. Accepted workspace events remain Redux-canonical; delivery happens
 * only when `renderer-subscription-saga` calls
 * `deliverEventToWebSocketSubscriptions()` for `workspaceEventAccepted`.
 *
 * This module is standalone — the WebSocket server (Task 1) registers
 * a "send to client" callback and calls the exported handler functions.
 */

import { Logger } from '../shared/logger';
import {
  createEventTypeSubscriptionFilters,
  eventMatchesSubscription,
} from '../features/events/event-filter-engine';
import type { EventFilter, WorkspaceEvent } from '../features/events/types';

const logger = new Logger('WebSocketEventBridge');

// ============================================================================
// Types
// ============================================================================

/** Callback the WebSocket server registers to send data to a specific client */
export type SendToClientFn = (clientId: string, message: string) => void;

export interface SubscribeParams {
  eventTypes: string[];
  workspaceId?: string;
  /** When set, any existing subscription from the same client with the same replaceGroup is removed first. */
  replaceGroup?: string;
}

export interface UnsubscribeParams {
  subscriptionId: string;
}

export interface SubscribeResult {
  subscriptionId: string;
}

interface ClientSubscription {
  subscriptionId: string;
  filters: EventFilter[];
  replaceGroup?: string;
}

// ============================================================================
// State
// ============================================================================

/** Per-client subscription tracking: clientId -> subscriptionId[] */
const clientSubscriptions = new Map<string, ClientSubscription[]>();

/** All active subscriptions keyed by subscriptionId for event delivery */
const allSubscriptions = new Map<string, { clientId: string; filters: EventFilter[] }>();

/** Auto-incrementing subscription counter */
let subCounter = 0;

/** Registered send callback (set by the WebSocket server) */
let sendToClient: SendToClientFn | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Register the callback used to send messages to WebSocket clients.
 * Returns an idempotent unregister function so a stopped WebSocket server does
 * not remain reachable through this process-global callback.
 */
export function registerSendCallback(fn: SendToClientFn): () => void {
  sendToClient = fn;
  logger.info('Send callback registered');

  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    clearSendCallback(fn);
  };
}

/**
 * Clear the registered send callback. When `expectedFn` is provided, only clear
 * the callback if it is still the same registration; this prevents an older
 * server's stop() from clobbering a newer server's callback.
 */
export function clearSendCallback(expectedFn?: SendToClientFn): boolean {
  if (!sendToClient || (expectedFn && sendToClient !== expectedFn)) {
    return false;
  }

  sendToClient = null;
  logger.info('Send callback cleared');
  return true;
}

/**
 * Handle an `events.subscribe` JSON-RPC request.
 *
 * Creates a local subscription that forwards matching events
 * to the requesting client as JSON-RPC notifications.
 * Events are delivered via `deliverEventToWebSocketSubscriptions()`,
 * which is called from the workspace events saga.
 */
export function handleSubscribe(clientId: string, params: SubscribeParams): SubscribeResult {
  const { eventTypes, workspaceId, replaceGroup } = params;

  if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
    throw new Error('eventTypes must be a non-empty array of event type strings');
  }

  // If replaceGroup is set, remove any existing subscription from this client with the same group
  if (replaceGroup) {
    const existing = clientSubscriptions.get(clientId);
    if (existing) {
      const toReplace = existing.filter((s) => s.replaceGroup === replaceGroup);
      for (const sub of toReplace) {
        allSubscriptions.delete(sub.subscriptionId);
        const idx = existing.indexOf(sub);
        if (idx !== -1) existing.splice(idx, 1);
      }
      if (existing.length === 0) {
        clientSubscriptions.delete(clientId);
      }
    }
  }

  const filters = createEventTypeSubscriptionFilters({ eventTypes, workspaceId });

  logger.info('Creating subscription with filters', {
    clientId,
    eventTypes,
    workspaceId,
    filterCount: filters.length,
    filters: filters.map((f) => ({ field: f.field, operator: f.operator, value: f.value })),
  });

  // Generate a local subscription ID
  const subscriptionId = `ws-sub-${++subCounter}`;

  // Track the subscription for this client
  const entry: ClientSubscription = {
    subscriptionId,
    filters,
    replaceGroup,
  };

  const currentSubs = clientSubscriptions.get(clientId);
  if (currentSubs) {
    currentSubs.push(entry);
  } else {
    clientSubscriptions.set(clientId, [entry]);
  }

  // Track in global map for event delivery
  allSubscriptions.set(subscriptionId, { clientId, filters });

  logger.info('Client subscribed', {
    clientId,
    subscriptionId,
    eventTypes,
    workspaceId,
  });

  return { subscriptionId };
}

/**
 * Handle an `events.unsubscribe` JSON-RPC request.
 */
export function handleUnsubscribe(clientId: string, params: UnsubscribeParams): boolean {
  const { subscriptionId } = params;

  if (!subscriptionId) {
    throw new Error('subscriptionId is required');
  }

  const subs = clientSubscriptions.get(clientId);
  if (!subs) {
    logger.warn('No subscriptions found for client', { clientId, subscriptionId });
    return false;
  }

  const idx = subs.findIndex((s) => s.subscriptionId === subscriptionId);
  if (idx === -1) {
    logger.warn('Subscription not found for client', { clientId, subscriptionId });
    return false;
  }

  // Remove from tracking
  allSubscriptions.delete(subscriptionId);
  subs.splice(idx, 1);

  // Clean up empty client entry
  if (subs.length === 0) {
    clientSubscriptions.delete(clientId);
  }

  logger.info('Client unsubscribed', { clientId, subscriptionId });
  return true;
}

/**
 * Clean up all subscriptions for a disconnected client.
 */
export function cleanupClient(clientId: string): void {
  const subs = clientSubscriptions.get(clientId);
  if (!subs || subs.length === 0) {
    clientSubscriptions.delete(clientId);
    return;
  }

  for (const sub of subs) {
    allSubscriptions.delete(sub.subscriptionId);
  }

  clientSubscriptions.delete(clientId);
  logger.info('Client cleaned up', { clientId, subscriptionCount: subs.length });
}

/**
 * Clean up all transport-local subscriptions. Intended for full WebSocket API
 * transport shutdown and tests; individual disconnects should use cleanupClient.
 */
export function cleanupAllClients(): void {
  const clientCount = clientSubscriptions.size;
  const subscriptionCount = allSubscriptions.size;
  clientSubscriptions.clear();
  allSubscriptions.clear();

  if (clientCount > 0 || subscriptionCount > 0) {
    logger.info('All WebSocket event subscriptions cleaned up', {
      clientCount,
      subscriptionCount,
    });
  }
}

/**
 * Get the number of active subscriptions for a client (for diagnostics).
 */
export function getClientSubscriptionCount(clientId: string): number {
  return clientSubscriptions.get(clientId)?.length ?? 0;
}

/**
 * Get total number of tracked clients (for diagnostics).
 */
export function getTrackedClientCount(): number {
  return clientSubscriptions.size;
}

/**
 * Deliver a workspace event to all matching WebSocket subscriptions.
 *
 * Called by the workspace events saga (renderer-subscription-saga) on each
 * accepted event, replacing the old UnifiedEventBus callback mechanism.
 */
export function deliverEventToWebSocketSubscriptions(event: WorkspaceEvent): void {
  if (!sendToClient || allSubscriptions.size === 0) return;

  for (const [subscriptionId, sub] of allSubscriptions.entries()) {
    try {
      if (!eventMatchesSubscription(event, sub.filters)) continue;

      // Delivery is gated *only* by shared subscription filter matching
      // above — the bridge does not allow-list or deny-list event types.
      // The trace log below is intentionally restricted to agent lifecycle
      // events (excluding the high-volume `agent:stream:*` family) to keep
      // log volume manageable; it does not affect delivery semantics.
      if (event.type.startsWith('agent:') && !event.type.startsWith('agent:stream:')) {
        logger.debug('Forwarding agent event to WebSocket client', {
          clientId: sub.clientId,
          subscriptionId,
          eventType: event.type,
          eventId: event.id,
          workspaceId: event.workspaceId,
          agentId: event.data?.agentId,
        });
      }

      const notification = JSON.stringify({
        jsonrpc: '2.0',
        method: 'events.event',
        params: {
          subscriptionId,
          event: {
            type: event.type,
            workspaceId: event.workspaceId,
            id: event.id,
            timestamp: event.timestamp,
            actor: event.actor,
            data: event.data,
          },
        },
      });

      sendToClient(sub.clientId, notification);
    } catch (err) {
      logger.error('Failed to send event to client', {
        clientId: sub.clientId,
        subscriptionId,
        error: err,
      });
    }
  }
}

