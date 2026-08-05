/**
 * Time formatting utilities for chat interfaces. Formatting delegates to the
 * canonical locale-aware formatters in `$lib/i18n/format`; this module keeps
 * only the chat-specific composition (message grouping, separators).
 */
import {
  formatDaySeparator,
  formatDateTime,
  formatFullDateTime,
  formatRelativeTime as formatRelative,
  formatTime,
} from '$lib/i18n/format';

/**
 * Format a date to a relative time string in the active locale
 * (e.g., "now", "2 minutes ago", "yesterday").
 */
export function formatRelativeTime(date: Date | string): string {
  return formatRelative(date);
}

/**
 * Format a date for display in chat as a localized clock time
 * (e.g., "2:30 PM" / "14:30").
 */
export function formatChatTime(date: Date | string): string {
  return formatTime(date);
}

/**
 * Format a date for a date separator in the active locale
 * ("Today", "Yesterday", a weekday, or the full date).
 */
export function formatDateSeparator(date: Date | string): string {
  return formatDaySeparator(date);
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
 * Format a timestamp for hover tooltip in the active locale
 * (e.g., "Sat, Dec 13, 2025, 10:00:00 AM").
 */
export function formatFullTimestamp(date: Date | string): string {
  return formatFullDateTime(date);
}

/**
 * Get a smart timestamp that shows relative time for recent messages
 * (< 24 hours) and an absolute localized date + time for older ones.
 */
export function getSmartTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);

  if (diffHours < 24) {
    return formatRelativeTime(d);
  }

  return formatDateTime(d);
}
