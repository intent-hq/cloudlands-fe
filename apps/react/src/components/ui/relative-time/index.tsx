import { useCallback, useSyncExternalStore } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { sharedTimeManager } from '$lib/utils/shared-time-manager.svelte';
import { createFormatters } from '$shared/i18n/formatters';
import { getLocale } from '$shared/paraglide/runtime.js';
import { m } from '$shared/paraglide/messages.js';

const { formatRelativeTime, formatCompactRelativeTime, formatFullDateTime } =
  createFormatters(getLocale);

export interface RelativeTimeProps {
  date: Date | string | number;
  compact?: boolean;
  className?: string;
  title?: string;
}

/** Uses the source shared frequency buckets, with no Svelte reactive wrapper. */
export function RelativeTime({ date, compact = false, className = '', title }: RelativeTimeProps) {
  const timestamp = new Date(date).getTime();
  const subscribe = useCallback(
    (update: () => void) =>
      Number.isNaN(timestamp) ? () => {} : sharedTimeManager.subscribe(new Date(timestamp), update),
    [timestamp],
  );
  const read = useCallback(() => {
    if (Number.isNaN(timestamp)) {
      return compact ? m.ui_relativeTime_invalidCompact_label() : m.ui_time_invalidDate_label();
    }
    return compact ? formatCompactRelativeTime(timestamp) : formatRelativeTime(timestamp);
  }, [timestamp, compact]);
  const relativeTime = useSyncExternalStore(subscribe, read, read);
  const fullTimestamp =
    title ||
    (Number.isNaN(timestamp) ? m.ui_relativeTime_invalid_label() : formatFullDateTime(timestamp));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{relativeTime}</span>
      </TooltipTrigger>
      <TooltipContent>{fullTimestamp}</TooltipContent>
    </Tooltip>
  );
}
