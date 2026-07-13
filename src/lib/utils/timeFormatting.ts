/**
 * Time formatting utilities for modern chat interfaces
 */

/**
 * Format a date to a relative time string
 * @param date - The date to format
 * @returns A relative time string like "Just now", "2 minutes ago", etc.
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 4) return `${weeks} weeks ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(days / 365);
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
}

/**
 * Format a date for display in chat
 * @param date - The date to format
 * @returns A formatted time string
 */
export function formatChatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date for a date separator
 * @param date - The date to format
 * @returns A formatted date string
 */
export function formatDateSeparator(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();

  // Check if it's today
  if (isSameDay(d, now)) {
    return 'Today';
  }

  // Check if it's yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) {
    return 'Yesterday';
  }

  // Check if it's within the last week
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (d > weekAgo) {
    return d.toLocaleDateString([], { weekday: 'long' });
  }

  // Otherwise, show the full date
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Check if two dates are on the same day
 */
function isSameDay(date1: Date | undefined, date2: Date | undefined): boolean {
  if (!date1 || !date2) return false;
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Group messages by time periods
 */
export interface MessageGroup<T> {
  date: Date;
  label: string;
  messages: T[];
}

export function groupMessagesByDate<T extends { timestamp?: Date | string | null }>(
  messages: T[],
): MessageGroup<T>[] {
  if (messages.length === 0) return [];

  const groups: MessageGroup<T>[] = [];
  let currentGroup: MessageGroup<T> | null = null;

  for (const message of messages) {
    // Handle undefined or null timestamps - use current date as fallback
    const messageDate = message.timestamp
      ? typeof message.timestamp === 'string'
        ? new Date(message.timestamp)
        : message.timestamp
      : new Date();

    if (!currentGroup || !isSameDay(currentGroup.date, messageDate)) {
      currentGroup = {
        date: messageDate,
        label: formatDateSeparator(messageDate),
        messages: [],
      };
      groups.push(currentGroup);
    }

    currentGroup.messages.push(message);
  }

  return groups;
}

/**
 * Check if a timestamp should show a time separator
 * (e.g., if more than 5 minutes have passed since the last message)
 */
export function shouldShowTimeSeparator(
  currentTimestamp: Date | string | undefined | null,
  previousTimestamp: Date | string | undefined | null,
  thresholdMinutes = 5,
): boolean {
  if (!previousTimestamp || !currentTimestamp) return false;

  const current =
    typeof currentTimestamp === 'string' ? new Date(currentTimestamp) : currentTimestamp;
  const previous =
    typeof previousTimestamp === 'string' ? new Date(previousTimestamp) : previousTimestamp;

  // Additional safety check after conversion
  if (!current || !previous) return false;

  const diffMinutes = (current.getTime() - previous.getTime()) / (1000 * 60);
  return diffMinutes > thresholdMinutes;
}

/**
 * Format a timestamp for hover tooltip
 */
export function formatFullTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Get a smart timestamp that shows relative time for recent messages
 * and absolute time for older ones
 */
export function getSmartTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60);

  // Show relative time for messages less than 24 hours old
  if (diffHours < 24) {
    return formatRelativeTime(d);
  }

  // Show "Yesterday" for messages from yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) {
    return `Yesterday at ${formatChatTime(d)}`;
  }

  // Show weekday and time for messages from the last week
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (d > weekAgo) {
    return `${d.toLocaleDateString([], { weekday: 'long' })} at ${formatChatTime(d)}`;
  }

  // Show full date for older messages
  return `${d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })} at ${formatChatTime(d)}`;
}
