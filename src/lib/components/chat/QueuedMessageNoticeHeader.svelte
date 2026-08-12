<script lang="ts">
  /**
   * QueuedMessageNoticeHeader
   *
   * Compact queued-delivery notice for user messages drained from the pending
   * queue: clock icon + "Queued <relative time> · waited <duration> before
   * delivery". Driven by `metadata.queueInfo` (PROTOCOL.md §5.5); the raw
   * `[SYSTEM NOTE]` line stays in the persisted content for the agent and is
   * hidden from the displayed body instead. Non-clickable; visually matches
   * AgentMessageAttributionHeader.
   */
  import Fa from 'svelte-fa';
  import { faClock } from '@fortawesome/free-solid-svg-icons';
  import type { QueueInfo } from '$lib/utils/queue-info';
  import { formatFullDateTime, formatNumber } from '$lib/i18n/format';
  import { createReactiveRelativeTime } from '$lib/utils/reactive-time.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy } from 'svelte';

  interface Props {
    queueInfo: QueueInfo;
    /** Whether the containing user message is currently pinned. */
    isSticky?: boolean;
    /** Optional class name */
    class?: string;
  }

  let { queueInfo, isSticky = false, class: className = '' }: Props = $props();

  // The shared time manager keeps the visible relative timestamp current
  // without per-row timers and resubscribes if the metadata prop changes.
  let currentRelativeTime: ReturnType<typeof createReactiveRelativeTime> | null = null;
  const relativeTime = $derived.by(() => {
    currentRelativeTime?.cleanup();
    const nextRelativeTime = createReactiveRelativeTime(queueInfo.queuedAt);
    currentRelativeTime = nextRelativeTime;
    return nextRelativeTime;
  });
  onDestroy(() => currentRelativeTime?.cleanup());
  const timeLabel = $derived(relativeTime.time);

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
  class="type-caption flex items-center gap-1.5 rounded-md text-subtle {isSticky
    ? 'min-w-0 overflow-hidden'
    : ''} {className}"
  title={formatFullDateTime(queueInfo.queuedAt)}
  data-testid="queued-message-notice"
>
  <Fa icon={faClock} size="12" class="shrink-0 opacity-70" />
  <span data-testid="queued-message-notice-text" class:min-w-0={isSticky} class:truncate={isSticky}
    >{m.chat_queuedNotice_label({ time: timeLabel, duration: durationLabel })}</span
  >
</div>
