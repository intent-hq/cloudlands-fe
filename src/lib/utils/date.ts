/**
 * Format a date as a human-readable relative time string.
 * Shows time elapsed from the given date to now.
 *
 * @param date - Date to format (string or Date object)
 * @returns Human-readable relative time (e.g., "2 hours ago", "3 days ago")
 * @example
 * ```typescript
 * formatDistanceToNow(new Date('2024-01-01'))
 * // Returns: "3 months ago"
 *
 * formatDistanceToNow(new Date(Date.now() - 30000))
 * // Returns: "just now"
 * ```
 */
export function formatDistanceToNow(date: string | Date): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  }

  const years = Math.floor(months / 12);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Format a date as a localized date and time string.
 * Uses US locale format with abbreviated month names.
 *
 * @param date - Date to format (string or Date object)
 * @returns Formatted date string (e.g., "Jan 15, 2024, 02:30 PM")
 * @example
 * ```typescript
 * formatDate(new Date('2024-01-15T14:30:00'))
 * // Returns: "Jan 15, 2024, 02:30 PM"
 * ```
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date as a relative time string with compact format
 * Examples: "Just now", "5h ago", "3d ago", or formatted date for older dates
 */
export function formatRelativeTimeCompact(date?: string | Date | null): string {
  if (!date) return 'Never';

  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  // Format as date with dots instead of slashes
  return d
    .toLocaleDateString('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .replace(/\//g, '.');
}
