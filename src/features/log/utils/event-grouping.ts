/**
 * Event Grouping Utilities
 *
 * Groups related workspace events for cleaner display in the activity log.
 * Events are grouped by:
 * - Same agent turn
 * - Same file within a time window
 * - Related git operations
 */

import type { WorkspaceEvent } from '../../events/types';

// Time window for grouping events (5 seconds)
const GROUP_TIME_WINDOW_MS = 5000;

export interface EventGroup {
  id: string;
  type: 'single' | 'multi-file' | 'agent-turn' | 'git-operation';
  events: WorkspaceEvent[];
  primaryEvent: WorkspaceEvent;
  timestamp: string;
  actor: WorkspaceEvent['actor'];
}

/**
 * Group events by related activities
 */
export function groupEvents(events: WorkspaceEvent[]): EventGroup[] {
  if (!events || events.length === 0) return [];

  const groups: EventGroup[] = [];
  const processedIds = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (processedIds.has(event.id)) continue;

    // Try to find related events
    const relatedEvents = findRelatedEvents(event, events, i, processedIds);

    if (relatedEvents.length > 1) {
      // Create a group
      const group = createGroup(relatedEvents);
      groups.push(group);
      relatedEvents.forEach((e) => processedIds.add(e.id));
    } else {
      // Single event
      groups.push({
        id: event.id,
        type: 'single',
        events: [event],
        primaryEvent: event,
        timestamp: event.timestamp,
        actor: event.actor,
      });
      processedIds.add(event.id);
    }
  }

  return groups;
}

/**
 * Find events related to the given event
 */
function findRelatedEvents(
  event: WorkspaceEvent,
  allEvents: WorkspaceEvent[],
  startIndex: number,
  processedIds: Set<string>,
): WorkspaceEvent[] {
  const related: WorkspaceEvent[] = [event];
  const eventTime = new Date(event.timestamp).getTime();

  // Check for agent turn grouping
  if (isAgentEvent(event)) {
    const turnNumber = getAgentTurnNumber(event);
    const agentId = getAgentId(event);

    if (turnNumber && agentId) {
      for (let i = startIndex + 1; i < allEvents.length; i++) {
        const other = allEvents[i];
        if (processedIds.has(other.id)) continue;

        const otherTime = new Date(other.timestamp).getTime();
        if (Math.abs(otherTime - eventTime) > GROUP_TIME_WINDOW_MS * 10) break;

        if (
          isAgentEvent(other) &&
          getAgentTurnNumber(other) === turnNumber &&
          getAgentId(other) === agentId
        ) {
          related.push(other);
        }
      }
    }
  }

  // Check for file event grouping (same actor, same type, within time window)
  if (event.type.startsWith('file:')) {
    for (let i = startIndex + 1; i < allEvents.length; i++) {
      const other = allEvents[i];
      if (processedIds.has(other.id)) continue;

      const otherTime = new Date(other.timestamp).getTime();
      if (Math.abs(otherTime - eventTime) > GROUP_TIME_WINDOW_MS) break;

      if (
        other.type.startsWith('file:') &&
        other.actor.id === event.actor.id &&
        other.type === event.type
      ) {
        related.push(other);
      }
    }
  }

  return related;
}

/**
 * Create a group from related events
 */
function createGroup(events: WorkspaceEvent[]): EventGroup {
  const primary = events[0];
  const allFileEvents = events.every((e) => e.type.startsWith('file:'));
  const allAgentEvents = events.every((e) => isAgentEvent(e));

  let type: EventGroup['type'] = 'single';
  if (allFileEvents && events.length > 1) {
    type = 'multi-file';
  } else if (allAgentEvents && events.length > 1) {
    type = 'agent-turn';
  } else if (events.some((e) => e.type.startsWith('git:'))) {
    type = 'git-operation';
  }

  return {
    id: `group-${primary.id}`,
    type,
    events,
    primaryEvent: primary,
    timestamp: primary.timestamp,
    actor: primary.actor,
  };
}

function isAgentEvent(event: WorkspaceEvent): boolean {
  return event.actor.type === 'agent' || event.actor.type === 'external';
}

function getAgentTurnNumber(event: WorkspaceEvent): number | null {
  return event.actor.metadata?.turnNumber || null;
}

function getAgentId(event: WorkspaceEvent): string | null {
  const data = event.data as any;
  return data?.agentId || event.actor.id || null;
}
