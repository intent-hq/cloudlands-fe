import type { DateInput } from '$lib/i18n/format';

export const MESSAGE_ACTION_SURFACE_CLASS =
  'message-actions flex max-w-full items-center gap-0.5 rounded-md border border-border bg-sidebar/95 p-0 text-foreground backdrop-blur-sm';

export const MESSAGE_ACTION_REVEAL_CLASS =
  'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100';

export const MESSAGE_ACTION_TIME_CLASS =
  'type-caption pointer-events-none shrink-0 select-none whitespace-nowrap pl-1.5 pr-1 tabular-nums text-muted-foreground';

export function resolveMessageActionDate(
  timestamp: DateInput | null | undefined,
  createdAt: DateInput | null | undefined,
): Date | null {
  for (const candidate of [timestamp, createdAt]) {
    if (candidate == null || candidate === '') continue;
    const date = candidate instanceof Date ? new Date(candidate.getTime()) : new Date(candidate);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}
