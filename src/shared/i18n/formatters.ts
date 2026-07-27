/**
 * Locale-aware formatting core — the single implementation behind all
 * date/time/number formatting in the app. Pure and cross-process safe: the
 * active locale is injected via `createFormatters(getLocale)`, so the renderer
 * binds it to the i18n locale service while tests (and the main process) can
 * pin any locale explicitly.
 *
 * Absolute dates/times and numbers use cached `Intl.DateTimeFormat` /
 * `Intl.NumberFormat` instances; relative times use `Intl.RelativeTimeFormat`;
 * "3 days ago"-style distances and pattern formatting wrap date-fns v4, whose
 * locale data is loaded on demand via `loadDateFnsLocale()` (the base `en`
 * needs no data — it is date-fns' default).
 */
import {
  format as dateFnsFormat,
  formatDistanceToNow as dateFnsFormatDistanceToNow,
  type Locale as DateFnsLocale,
} from 'date-fns';

// ── Intl instance caches ────────────────────────────────────────────────────

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let cached = numberFormats.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, cached);
  }
  return cached;
}

function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let cached = dateTimeFormats.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    dateTimeFormats.set(key, cached);
  }
  return cached;
}

function relativeTimeFormat(
  locale: string,
  options: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let cached = relativeTimeFormats.get(key);
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, options);
    relativeTimeFormats.set(key, cached);
  }
  return cached;
}

// ── date-fns dynamic locale loading ─────────────────────────────────────────

const dateFnsLocales = new Map<string, DateFnsLocale | undefined>();

/**
 * Load the date-fns locale data for a BCP-47 tag into the registry.
 * `en` (date-fns' default) is a no-op. The full locale index is imported
 * lazily as one chunk, so no per-locale loader map has to be maintained —
 * any catalog locale date-fns ships works automatically.
 */
export async function loadDateFnsLocale(tag: string): Promise<void> {
  if (tag === 'en' || dateFnsLocales.has(tag)) return;
  const index = (await import('date-fns/locale')) as Record<string, unknown>;
  const [language] = tag.split('-');
  const candidates = [tag.replace(/-/g, ''), language];
  const found = candidates
    .map((key) => index[key])
    .find((entry): entry is DateFnsLocale => entry != null && typeof entry === 'object');
  dateFnsLocales.set(tag, found);
}

/** Loaded date-fns locale for `tag`, or undefined (→ date-fns default enUS). */
export function getDateFnsLocale(tag: string): DateFnsLocale | undefined {
  return dateFnsLocales.get(tag);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export type DateInput = Date | string | number;

function toDate(input: DateInput): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

type RelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/**
 * Pick the natural unit for a signed offset (negative = past). Mirrors the
 * thresholds the app has always used: seconds → minutes → hours → days (<7)
 * → weeks (<~1 month) → months (<12) → years. Offsets under 10s become
 * "now" (value 0 with numeric:"auto").
 */
function selectRelativeUnit(diffMs: number): { value: number; unit: RelativeUnit } {
  const seconds = Math.round(diffMs / 1000);
  const abs = Math.abs(seconds);
  if (abs < 10) return { value: 0, unit: 'second' };
  if (abs < 60) return { value: seconds, unit: 'second' };
  const minutes = Math.trunc(seconds / 60);
  if (Math.abs(minutes) < 60) return { value: minutes, unit: 'minute' };
  const hours = Math.trunc(seconds / 3600);
  if (Math.abs(hours) < 24) return { value: hours, unit: 'hour' };
  const days = Math.trunc(seconds / 86400);
  if (Math.abs(days) < 7) return { value: days, unit: 'day' };
  if (Math.abs(days) < 30) return { value: Math.trunc(days / 7), unit: 'week' };
  const months = Math.trunc(days / 30);
  if (Math.abs(months) < 12) return { value: months, unit: 'month' };
  return { value: Math.trunc(days / 365), unit: 'year' };
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export interface RelativeTimeOptions {
  /** "long" → "5 minutes ago" (default); "narrow" → "5m ago". */
  style?: 'long' | 'narrow';
  /** Reference instant, defaults to now. */
  now?: Date;
}

export type Formatters = ReturnType<typeof createFormatters>;

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build the formatting API around a locale getter. All functions read the
 * locale at call time, so output follows the active locale as it changes.
 * Invalid date inputs format to the empty string — callers keep their own
 * placeholder semantics ("Never", "--:--:--", …).
 */
export function createFormatters(getLocale: () => string) {
  /** Locale-grouped number, e.g. 1234567.89 → "1,234,567.89" / "1.234.567,89". */
  function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return numberFormat(getLocale(), options ?? {}).format(value);
  }

  /** Locale-grouped integer (rounds); NaN-safe → "0". */
  function formatInteger(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return numberFormat(getLocale(), { maximumFractionDigits: 0 }).format(value);
  }

  /** Relative time in the natural unit: "now", "5 minutes ago", "yesterday", "in 2 days". */
  function formatRelativeTime(input: DateInput, options?: RelativeTimeOptions): string {
    const date = toDate(input);
    if (!date) return '';
    const now = options?.now ?? new Date();
    const { value, unit } = selectRelativeUnit(date.getTime() - now.getTime());
    const rtf = relativeTimeFormat(getLocale(), {
      numeric: 'auto',
      style: options?.style === 'narrow' ? 'narrow' : 'long',
    });
    return rtf.format(value, unit);
  }

  /** Unit-only compact age for badges: "now", "5m", "3h", "2d", "3w", then a short date. */
  function formatCompactRelativeTime(input: DateInput, options?: { now?: Date }): string {
    const date = toDate(input);
    if (!date) return '';
    const now = options?.now ?? new Date();
    const locale = getLocale();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (diffMinutes < 1) {
      return relativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
    }
    const unitOf = (unit: string, value: number) =>
      numberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value);
    if (diffMinutes < 60) return unitOf('minute', diffMinutes);
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return unitOf('hour', diffHours);
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return unitOf('day', diffDays);
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks < 5) return unitOf('week', diffWeeks);
    return formatShortDate(date, { now });
  }

  /** Clock time, e.g. "2:30 PM" / "14:30"; `seconds` → "02:30:05 PM". */
  function formatTime(input: DateInput, options?: { seconds?: boolean }): string {
    const date = toDate(input);
    if (!date) return '';
    const dtfOptions: Intl.DateTimeFormatOptions = options?.seconds
      ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: 'numeric', minute: '2-digit' };
    return dateTimeFormat(getLocale(), dtfOptions).format(date);
  }

  /** Medium date, e.g. "Jan 15, 2024" / "15.01.2024". */
  function formatDate(input: DateInput): string {
    const date = toDate(input);
    if (!date) return '';
    return dateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(date);
  }

  /** Short month + day, adding the year when it differs from now: "Jan 5" / "Jan 5, 2023". */
  function formatShortDate(input: DateInput, options?: { now?: Date }): string {
    const date = toDate(input);
    if (!date) return '';
    const now = options?.now ?? new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    return dateTimeFormat(getLocale(), {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(date);
  }

  /** Medium date + short time, e.g. "Jan 15, 2024, 2:30 PM". */
  function formatDateTime(input: DateInput): string {
    const date = toDate(input);
    if (!date) return '';
    return dateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  /** Tooltip timestamp: "Sat, Dec 13, 2025, 10:00:00 AM". */
  function formatFullDateTime(input: DateInput): string {
    const date = toDate(input);
    if (!date) return '';
    return dateTimeFormat(getLocale(), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  }

  /** Long weekday name, e.g. "Monday". */
  function formatWeekday(input: DateInput): string {
    const date = toDate(input);
    if (!date) return '';
    return dateTimeFormat(getLocale(), { weekday: 'long' }).format(date);
  }

  /** Chat date-separator label: "Today", "Yesterday", a weekday, or the full date. */
  function formatDaySeparator(input: DateInput, options?: { now?: Date }): string {
    const date = toDate(input);
    if (!date) return '';
    const now = options?.now ?? new Date();
    const locale = getLocale();
    const rtf = relativeTimeFormat(locale, { numeric: 'auto' });
    if (isSameDay(date, now)) return capitalize(rtf.format(0, 'day'), locale);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (isSameDay(date, yesterday)) return capitalize(rtf.format(-1, 'day'), locale);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    if (date > weekAgo && date < now) return formatWeekday(date);
    return dateTimeFormat(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
  }

  /** date-fns distance to now with suffix: "3 days ago", "about 1 hour ago". */
  function formatDistanceToNow(input: DateInput, options?: { addSuffix?: boolean }): string {
    const date = toDate(input);
    if (!date) return '';
    return dateFnsFormatDistanceToNow(date, {
      addSuffix: options?.addSuffix ?? true,
      locale: getDateFnsLocale(getLocale()),
    });
  }

  /** date-fns pattern formatting ("MMM d", "PPpp", …) in the active locale. */
  function formatDatePattern(input: DateInput, pattern: string): string {
    const date = toDate(input);
    if (!date) return '';
    return dateFnsFormat(date, pattern, { locale: getDateFnsLocale(getLocale()) });
  }

  return {
    formatNumber,
    formatInteger,
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
  };
}
