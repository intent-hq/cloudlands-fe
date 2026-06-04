/**
 * Renderer subscription registry.
 *
 * Holds the set of active renderer event subscriptions and provides a
 * `deliverEventToSubscriptions` function that the saga can call on each
 * accepted workspace event.
 *
 * Extracted from events.ipc.ts so both the IPC handler (add/remove) and
 * the saga (deliver) can share the same data without circular imports.
 * The maps in this module are transport-local runtime state only; Redux owns
 * accepted workspace events and `renderer-subscription-saga` is the sole
 * downstream delivery owner.
 */

import { BrowserWindow } from 'electron';
import { Logger } from '../../../shared/logger';
import type { WorkspaceEvent, EventFilter } from '../types';
import { eventMatchesSubscription } from '../event-filter-engine';

const logger = new Logger('RendererSubscriptionRegistry');

export interface RendererSubscription {
  windowId: number;
  filters: EventFilter[];
}

/** Active renderer subscriptions keyed by subscriptionId */
export const rendererSubscriptions = new Map<string, RendererSubscription>();

// Track window close listeners so they can be removed on explicit unsubscribe
export const windowCloseListeners = new Map<
  string,
  { window: BrowserWindow; listener: () => void }
>();

/**
 * Deliver a single event to all matching renderer subscriptions.
 *
 * Called by the renderer-subscription saga on each `workspaceEventAccepted`.
 * Performance is O(S) where S = number of active subscriptions, and only
 * fires when an event is actually emitted — not on every Redux action.
 */
export function deliverEventToSubscriptions(event: WorkspaceEvent): void {
  for (const [subId, sub] of rendererSubscriptions.entries()) {
    try {
      const window = BrowserWindow.fromId(sub.windowId);
      if (!window || window.isDestroyed()) continue;

      if (eventMatchesSubscription(event, sub.filters)) {
        window.webContents.send('workspace:event', event);
      }
    } catch (error) {
      logger.error('Failed to deliver event to subscription', {
        subscriptionId: subId,
        eventId: event.id,
        error,
      });
    }
  }
}

