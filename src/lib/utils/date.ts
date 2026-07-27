/**
 * Date formatting helpers — thin wrappers over the canonical locale-aware
 * formatters in `$lib/i18n/format`, kept for API stability at existing call
 * sites. Prefer importing from `$lib/i18n/format` directly in new code.
 */
import { formatDateTime, formatRelativeTime } from '$lib/i18n/format';

/**
 * Format a date as a human-readable relative time string in the active
 * locale (e.g., "now", "2 hours ago", "yesterday", "3 months ago").
 */
export function formatDistanceToNow(date: string | Date): string {
  return formatRelativeTime(date);
}

/**
 * Format a date as a localized date and time string in the active locale
 * (e.g., "Jan 15, 2024, 2:30 PM").
 */
export function formatDate(date: string | Date): string {
  return formatDateTime(date);
}

/**
 * Format a date as a compact relative time string in the active locale
 * (e.g., "now", "5h ago", "3d ago"); nullish dates format as "Never".
 */
export function formatRelativeTimeCompact(date?: string | Date | null): string {
  if (!date) return 'Never';
  return formatRelativeTime(date, { style: 'narrow' });
}
