<script lang="ts">
  /**
   * QueuedMessageNoticeHeader
   *
   * Compact queued-delivery notice for user messages drained from the pending
   * queue: clock icon + "Queued at <local time> · waited <duration> before
   * delivery". Driven by `metadata.queueInfo` (PROTOCOL.md §5.5); the raw
   * `[SYSTEM NOTE]` line stays in the persisted content for the agent and is
   * hidden from the displayed body instead. Non-clickable; visually matches
   * AgentMessageAttributionHeader.
   */
  import Fa from 'svelte-fa';
  import { faClock } from '@fortawesome/free-solid-svg-icons';
  import type { QueueInfo } from '$lib/utils/queue-info';
  import { formatDateTime, formatFullDateTime, formatNumber, formatTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    queueInfo: QueueInfo;
    /** Optional class name */
    class?: string;
  }

  let { queueInfo, class: className = '' }: Props = $props();

  function isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  // Same-day queue times show just the clock time; older ones the full date.
  const timeLabel = $derived(
    isSameDay(new Date(queueInfo.queuedAt), new Date())
      ? formatTime(queueInfo.queuedAt)
      : formatDateTime(queueInfo.queuedAt),
  );

  // Wait duration mirroring the daemon note's units (Ns / Nm Ss / Nh Mm),
  // locale-formatted via narrow Intl units.
  const durationLabel = $derived.by(() => {
    const unit = (u: string, v: number) =>
      formatNumber(v, { style: 'unit', unit: u, unitDisplay: 'narrow' });
    const totalSecs = Math.max(0, Math.round(queueInfo.waitedMs / 1000));
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;
    if (hours > 0) return `${unit('hour', hours)} ${unit('minute', minutes)}`;
    if (minutes > 0) return `${unit('minute', minutes)} ${unit('second', seconds)}`;
    return unit('second', seconds);
  });
</script>

<div
  class="flex items-center gap-1.5 rounded-md text-xs text-subtle {className}"
  title={formatFullDateTime(queueInfo.queuedAt)}
  data-testid="queued-message-notice"
>
  <Fa icon={faClock} size="12" class="opacity-70" />
  <span>{m.chat_queuedNotice_label({ time: timeLabel, duration: durationLabel })}</span>
</div>
