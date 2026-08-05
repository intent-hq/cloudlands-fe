/**
 * Canonical locale-aware formatting for the renderer — the single import
 * point for date, relative-time, and number formatting. Every function is
 * bound to the active Paraglide locale (`$lib/i18n/locale`), so formatted
 * output re-localizes together with `m.*()` strings when the language
 * changes (components re-render via the `{#key}` block on the resolved
 * locale in `+layout.svelte`).
 *
 * Implementation lives in `$shared/i18n/formatters` (pure, testable with an
 * explicit locale); this module only injects the active locale.
 */
import { createFormatters } from '$shared/i18n/formatters';
import { getActiveLocale } from './locale';

export const {
  formatNumber,
  formatInteger,
  formatBytesBinary,
  formatRelativeTime,
  formatCompactRelativeTime,
  formatTime,
  formatDate,
  formatShortDate,
  formatDateTime,
  formatFullDateTime,
  formatWeekday,
  formatDaySeparator,
  formatDistanceToNow,
  formatDatePattern,
} = createFormatters(getActiveLocale);

export type { DateInput, RelativeTimeOptions } from '$shared/i18n/formatters';
