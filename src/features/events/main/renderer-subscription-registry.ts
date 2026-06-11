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

/** Workspace-scoped renderer subscription ids keyed by workspaceId. */
export const rendererSubscriptionsByWorkspace = new Map<string, Set<string>>();

/** Subscriptions without a simple workspaceId filter must remain globally eligible. */
export const globalRendererSubscriptionIds = new Set<string>();

const rendererSubscriptionIndexEntries = new Map<string, { workspaceIds?: Set<string> }>();

// Track window close listeners so they can be removed on explicit unsubscribe
export const windowCloseListeners = new Map<
  string,
  { window: BrowserWindow; listener: () => void }
>();

function getSimpleWorkspaceFilterIds(filters: EventFilter[]): Set<string> | undefined {
  const workspaceIds = new Set<string>();
  let sawWorkspaceFilter = false;

  for (const filter of filters) {
    if (filter.field !== 'workspaceId') continue;
    sawWorkspaceFilter = true;

    if (filter.operator === 'equals' && typeof filter.value === 'string' && filter.value.length > 0) {
      workspaceIds.add(filter.value);
      continue;
    }

    if (filter.operator === 'in' && Array.isArray(filter.value)) {
      for (const value of filter.value) {
        if (typeof value === 'string' && value.length > 0) {
          workspaceIds.add(value);
        }
      }
      continue;
    }

    return undefined;
  }

  return sawWorkspaceFilter ? workspaceIds : undefined;
}

function removeSubscriptionFromIndexes(subscriptionId: string): void {
  const entry = rendererSubscriptionIndexEntries.get(subscriptionId);
  if (!entry) {
    globalRendererSubscriptionIds.delete(subscriptionId);
    return;
  }

  if (entry.workspaceIds) {
    for (const workspaceId of entry.workspaceIds) {
      const ids = rendererSubscriptionsByWorkspace.get(workspaceId);
      ids?.delete(subscriptionId);
      if (ids?.size === 0) {
        rendererSubscriptionsByWorkspace.delete(workspaceId);
      }
    }
  } else {
    globalRendererSubscriptionIds.delete(subscriptionId);
  }

  rendererSubscriptionIndexEntries.delete(subscriptionId);
}

export function addRendererSubscription(
  subscriptionId: string,
  subscription: RendererSubscription,
): void {
  removeRendererSubscription(subscriptionId);

  rendererSubscriptions.set(subscriptionId, subscription);
  const workspaceIds = getSimpleWorkspaceFilterIds(subscription.filters);

  rendererSubscriptionIndexEntries.set(subscriptionId, { workspaceIds });
  if (!workspaceIds || workspaceIds.size === 0) {
    globalRendererSubscriptionIds.add(subscriptionId);
    return;
  }

  for (const workspaceId of workspaceIds) {
    let ids = rendererSubscriptionsByWorkspace.get(workspaceId);
    if (!ids) {
      ids = new Set<string>();
      rendererSubscriptionsByWorkspace.set(workspaceId, ids);
    }
    ids.add(subscriptionId);
  }
}

export function clearRendererSubscriptions(): void {
  rendererSubscriptions.clear();
  rendererSubscriptionsByWorkspace.clear();
  globalRendererSubscriptionIds.clear();
  rendererSubscriptionIndexEntries.clear();
}

export function removeRendererSubscription(subscriptionId: string): boolean {
  removeSubscriptionFromIndexes(subscriptionId);
  const hadSubscription = rendererSubscriptions.delete(subscriptionId);
  const closeListener = windowCloseListeners.get(subscriptionId);

  if (closeListener) {
    closeListener.window.removeListener('closed', closeListener.listener);
    windowCloseListeners.delete(subscriptionId);
  }

  return hadSubscription || Boolean(closeListener);
}

function getCandidateSubscriptionIds(event: WorkspaceEvent): Set<string> {
  const hasIndexedSubscriptions =
    rendererSubscriptionIndexEntries.size > 0 ||
    globalRendererSubscriptionIds.size > 0 ||
    rendererSubscriptionsByWorkspace.size > 0;

  if (!hasIndexedSubscriptions) {
    return new Set(rendererSubscriptions.keys());
  }

  const candidates = new Set(globalRendererSubscriptionIds);
  if (event.workspaceId) {
    const workspaceIds = rendererSubscriptionsByWorkspace.get(event.workspaceId);
    if (workspaceIds) {
      for (const subscriptionId of workspaceIds) {
        candidates.add(subscriptionId);
      }
    }
  }

  return candidates;
}

/**
 * Deliver a single event to all matching renderer subscriptions.
 *
 * Called by the renderer-subscription saga on each `workspaceEventAccepted`.
 * Performance is O(G + W) for workspace-scoped events where G is the number of
 * global subscriptions and W is the number explicitly scoped to the event's
 * workspace. It only fires when an event is actually emitted — not on every
 * Redux action.
 */
export function deliverEventToSubscriptions(event: WorkspaceEvent): void {
  for (const subId of getCandidateSubscriptionIds(event)) {
    const sub = rendererSubscriptions.get(subId);
    if (!sub) {
      removeSubscriptionFromIndexes(subId);
      continue;
    }

    try {
      const window = BrowserWindow.fromId(sub.windowId);
      if (!window || window.isDestroyed()) {
        removeRendererSubscription(subId);
        continue;
      }

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

