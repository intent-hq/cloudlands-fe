/**
 * Event System Client
 *
 * Client-side API for interacting with the event system.
 * Replaces the old activity-log client.
 *
 * NOTE: For advanced event queries (recent files, agent activity, workspace summary),
 * use AgentEventTools via WorkspaceEventService on the main process side.
 * This client only provides basic event query and subscription functionality.
 */

import type { WorkspaceEvent, EventFilter } from './types';
import { Logger } from '$shared/logger';
import { EVENTS_CHANNELS } from '$shared/ipc/channels';
import { listenSync } from '$lib/electron-bridge';

const logger = new Logger('EventsClient');

/**
 * Invoke IPC method
 */
async function invoke<T>(channel: string, data?: unknown): Promise<T> {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return await window.electronAPI.invoke(channel, data);
  }
  throw new Error('Electron IPC not available');
}

/**
 * Query events with filters
 */
export async function queryEvents(
  workspaceId: string,
  filters: EventFilter[] = [],
  limit?: number,
): Promise<WorkspaceEvent[]> {
  try {
    const result = await invoke<WorkspaceEvent[] | { data: WorkspaceEvent[] }>(
      EVENTS_CHANNELS.QUERY,
      {
        workspaceId,
        filters,
        limit,
      },
    );
    // The handler returns the events directly, not wrapped in data
    return Array.isArray(result) ? result : result?.data || [];
  } catch (error) {
    logger.error(
      'Failed to query events',
      error instanceof Error ? error : new Error(String(error)),
    );
    return [];
  }
}

/**
 * Listen for new events
 * Uses listenSync for synchronous cleanup to avoid race conditions on unmount
 */
export function onEventCreated(
  callback: (data: { workspaceId: string; event: WorkspaceEvent }) => void,
): () => void {
  logger.debug('[events.client] Set up listener for events:new channel');
  return listenSync('events:new', (event: any) => {
    const data = event.payload || event;
    logger.debug('[events.client] Received events:new IPC message:', data);
    callback(data);
  });
}

/**
 * Listen for events cleared
 * Uses listenSync for synchronous cleanup to avoid race conditions on unmount
 */
export function onEventsCleared(callback: (workspaceId: string) => void): () => void {
  return listenSync('events:cleared', (event: any) => {
    const data = event.payload || event;
    callback(data.workspaceId);
  });
}
