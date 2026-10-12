// Source: src/lib/components/chat/QueuedMessageNoticeHeader.svelte.
import { ClockIcon } from '@phosphor-icons/react';
import { Tooltip } from '@/components/ui/tooltip';
import type { QueueInfo } from '$lib/utils/queue-info';
import { formatCompactDuration, formatFullDateTime } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

export interface QueuedMessageNoticeHeaderProps {
  queueInfo: QueueInfo;
}

export function QueuedMessageNoticeHeader({ queueInfo }: QueuedMessageNoticeHeaderProps) {
  const durationLabel =
    Math.round(queueInfo.waitedMs / 1000) > 0 ? formatCompactDuration(queueInfo.waitedMs) : '';
  const waitLabel = m.chat_queuedNotice_label({ duration: durationLabel });
  const queuedTime = formatFullDateTime(queueInfo.queuedAt);

  if (!durationLabel) return null;

  return (
    <Tooltip
      className="min-w-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      content={
        <>
          <span>{waitLabel}</span>
          <span className="block">{queuedTime}</span>
        </>
      }
    >
      <span
        className="type-caption flex min-w-0 items-center gap-1 px-1 text-muted-foreground"
        title={queuedTime}
        data-testid="queued-message-notice"
      >
        <ClockIcon size={12} weight="regular" className="shrink-0 opacity-70" aria-hidden="true" />
        <span data-testid="queued-message-notice-text" className="sr-only">
          {waitLabel}
        </span>
        <span className="truncate tabular-nums" aria-hidden="true">
          {durationLabel}
        </span>
      </span>
    </Tooltip>
  );
}

export default QueuedMessageNoticeHeader;
