/**
 * Timeline utilities for creating beautiful, functional timelines
 */

import type { WorkspaceEvent } from '$features/events/types';

/**
 * Group events by time period for better visual organization
 */
export interface TimelineGroup {
  id: string;
  label: string;
  timestamp: Date;
  events: WorkspaceEvent[];
  isToday: boolean;
  isYesterday: boolean;
  isThisWeek: boolean;
  isCollapsed?: boolean;
}

/**
 * Group events by smart time periods
 */
export function groupEventsByTimePeriod(events: WorkspaceEvent[]): TimelineGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const groups: Map<string, TimelineGroup> = new Map();

  events.forEach((event) => {
    const eventDate = new Date(event.timestamp);
    const eventDateOnly = new Date(
      eventDate.getFullYear(),
      eventDate.getMonth(),
      eventDate.getDate(),
    );

    let groupId: string;
    let label: string;
    let isToday = false;
    let isYesterday = false;
    let isThisWeek = false;

    if (eventDateOnly.getTime() === today.getTime()) {
      groupId = 'today';
      label = 'Today';
      isToday = true;
    } else if (eventDateOnly.getTime() === yesterday.getTime()) {
      groupId = 'yesterday';
      label = 'Yesterday';
      isYesterday = true;
    } else if (eventDate > weekAgo) {
      // Group by day for this week
      groupId = eventDateOnly.toISOString().split('T')[0];
      label = eventDate.toLocaleDateString([], {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
      isThisWeek = true;
    } else if (eventDate > monthAgo) {
      // Group by week for this month
      const weekNumber = Math.floor(
        (today.getTime() - eventDate.getTime()) / (7 * 24 * 60 * 60 * 1000),
      );
      groupId = `week-${weekNumber}`;
      label = `${weekNumber} week${weekNumber > 1 ? 's' : ''} ago`;
    } else {
      // Group by month for older events
      groupId = `${eventDate.getFullYear()}-${eventDate.getMonth()}`;
      label = eventDate.toLocaleDateString([], {
        month: 'long',
        year: 'numeric',
      });
    }

    if (!groups.has(groupId)) {
      groups.set(groupId, {
        id: groupId,
        label,
        timestamp: eventDate,
        events: [],
        isToday,
        isYesterday,
        isThisWeek,
      });
    }

    groups.get(groupId)!.events.push(event);
  });

  // Sort groups by timestamp (newest first)
  return Array.from(groups.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Check if two events happened within a short time period
 */
export function areEventsInSameBurst(event1: WorkspaceEvent, event2: WorkspaceEvent): boolean {
  const timeString1 = formatTimelineTimestamp(event1.timestamp, undefined, {
    relative: true,
  });
  const timeString2 = formatTimelineTimestamp(event2.timestamp, undefined, {
    relative: true,
  });
  return timeString1 === timeString2;
}

/**
 * Check if events are from the same actor
 */
export function haveSameActor(event1: WorkspaceEvent, event2: WorkspaceEvent): boolean {
  const actor1 = event1.actor;
  const actor2 = event2.actor;

  if (actor1.type !== actor2.type) return false;

  if (actor1.type === 'agent' && actor2.type === 'agent') {
    return actor1.id === actor2.id;
  }

  if (actor1.type === 'user' && actor2.type === 'user') {
    return actor1.email === actor2.email;
  }

  return false;
}

/**
 * Group consecutive events from the same actor
 */
export function groupConsecutiveActorEvents(events: WorkspaceEvent[]): WorkspaceEvent[][] {
  if (events.length === 0) return [];

  const groups: WorkspaceEvent[][] = [];
  let currentGroup: WorkspaceEvent[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const prevEvent = events[i - 1];
    const currEvent = events[i];

    if (haveSameActor(prevEvent, currEvent) && areEventsInSameBurst(prevEvent, currEvent)) {
      currentGroup.push(currEvent);
    } else {
      groups.push(currentGroup);
      currentGroup = [currEvent];
    }
  }

  groups.push(currentGroup);
  return groups;
}

/**
 * Format timestamp for timeline display
 */
export function formatTimelineTimestamp(
  timestamp: string | Date,
  previousTimestamp?: string | Date,
  options: {
    showDate?: boolean;
    showTime?: boolean;
    relative?: boolean;
  } = {},
): string {
  const { showDate = true, showTime = true, relative = false } = options;
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const prevDate = previousTimestamp
    ? typeof previousTimestamp === 'string'
      ? new Date(previousTimestamp)
      : previousTimestamp
    : null;

  // If relative time is requested
  if (relative) {
    return formatRelativeTimelineTime(date);
  }

  // Check if we should show the date
  const shouldShowDate = showDate && (!prevDate || !isSameDay(date, prevDate));

  // Check if we should show the time
  const shouldShowTime = showTime && (!prevDate || !isSameMinute(date, prevDate));

  if (shouldShowDate && shouldShowTime) {
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } else if (shouldShowTime) {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } else if (shouldShowDate) {
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }

  return '';
}

/**
 * Format relative time for timeline
 */
function formatRelativeTimelineTime(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Check if two dates are on the same day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if two dates are in the same minute
 */
function isSameMinute(date1: Date, date2: Date): boolean {
  return (
    isSameDay(date1, date2) &&
    date1.getHours() === date2.getHours() &&
    date1.getMinutes() === date2.getMinutes()
  );
}

/**
 * Determine if an event should be highlighted
 */
export function shouldHighlightEvent(event: WorkspaceEvent): boolean {
  // Highlight important events
  const importantTypes = [
    'GoalCompleted',
    'DiffApplied',
    'FileCreated',
    'AgentCompleted',
    'WorkspaceCreated',
  ];

  return importantTypes.includes(event.type);
}

/**
 * Get visual weight for timeline rendering
 */
export function getEventVisualWeight(event: WorkspaceEvent): 'light' | 'medium' | 'heavy' {
  // Heavy weight for major events
  if (event.type === 'goal:updated' || event.type === 'workspace:created') {
    return 'heavy';
  }

  // Medium weight for file changes with significant impact
  if (event.codeChange) {
    const totalChanges = (event.codeChange.additions || 0) + (event.codeChange.deletions || 0);
    if (totalChanges > 50) return 'heavy';
    if (totalChanges > 10) return 'medium';
  }

  return 'light';
}

/**
 * Calculate timeline density for smart collapsing
 */
export function calculateTimelineDensity(events: WorkspaceEvent[]): number {
  if (events.length < 2) return 0;

  const timeRange =
    new Date(events[0].timestamp).getTime() -
    new Date(events[events.length - 1].timestamp).getTime();
  const hours = timeRange / (1000 * 60 * 60);

  return events.length / Math.max(hours, 1);
}

/**
 * Determine if a group should be initially collapsed
 */
export function shouldCollapseGroup(group: TimelineGroup): boolean {
  // Never collapse today or yesterday
  if (group.isToday || group.isYesterday) return false;

  // Collapse if group has many events
  if (group.events.length > 20) return true;

  // Collapse older groups
  const daysOld = (Date.now() - group.timestamp.getTime()) / (1000 * 60 * 60 * 24);
  return daysOld > 7;
}
