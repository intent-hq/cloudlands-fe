import { formatInteger, formatRelativeTime } from '$lib/i18n/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

export interface WorkspaceHoverCardTimestamp {
  compact: string;
  accessible: string;
  dateTime: string;
}

export function formatWorkspaceHoverCardTimestamp(
  input: string | number | Date | null | undefined,
  now: Date = new Date(),
): WorkspaceHoverCardTimestamp | null {
  if (input === null || input === undefined) return null;
  const date = input instanceof Date ? input : new Date(input);
  const timestamp = date.getTime();
  const nowTime = now.getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTime)) return null;

  const elapsed = Math.max(0, nowTime - timestamp);
  let compact: string;
  // i18n-ignore (compact elapsed-time suffixes are technical notation)
  if (elapsed < MINUTE) compact = '<1m';
  else if (elapsed < HOUR) compact = `${formatInteger(Math.floor(elapsed / MINUTE))}m`;
  else if (elapsed < DAY) compact = `${formatInteger(Math.floor(elapsed / HOUR))}h`;
  else if (elapsed < MONTH) compact = `${formatInteger(Math.floor(elapsed / DAY))}d`;
  else compact = `${formatInteger(Math.floor(elapsed / MONTH))}mo`;

  const accessibleDate = timestamp > nowTime ? now : date;
  const accessible = formatRelativeTime(accessibleDate, { now });
  if (!accessible) return null;
  return { compact, accessible, dateTime: date.toISOString() };
}
