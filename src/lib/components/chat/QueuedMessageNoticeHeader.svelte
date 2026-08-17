<script lang="ts">
  /**
   * QueuedMessageNoticeHeader
   *
   * Compact queued-delivery notice for user messages drained from the pending
   * queue: clock icon + "Waited in queue for <duration>". Driven by
   * `metadata.queueInfo` (PROTOCOL.md §5.5); the raw
   * `[SYSTEM NOTE]` line stays in the persisted content for the agent and is
   * hidden from the displayed body instead. Non-clickable; visually matches
   * AgentMessageAttributionHeader.
   */
  import Fa from 'svelte-fa';
  import { faClock } from '@fortawesome/free-solid-svg-icons';
  import type { QueueInfo } from '$lib/utils/queue-info';
  import { formatCompactDuration, formatFullDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    queueInfo: QueueInfo;
    /** Whether the containing user message is currently pinned. */
    isSticky?: boolean;
    /** Optional class name */
    class?: string;
  }

  let { queueInfo, isSticky = false, class: className = '' }: Props = $props();

  // The canonical formatter rounds to the nearest second and supplies
  // locale-aware singular/plural units. A rounded zero delay has no notice.
  const durationLabel = $derived(
    Math.round(queueInfo.waitedMs / 1000) > 0 ? formatCompactDuration(queueInfo.waitedMs) : '',
  );
</script>

{#if durationLabel}
  <div
    class="type-caption flex items-center gap-1.5 rounded-md text-subtle {isSticky
      ? 'min-w-0 overflow-hidden'
      : ''} {className}"
    title={formatFullDateTime(queueInfo.queuedAt)}
    data-testid="queued-message-notice"
  >
    <Fa icon={faClock} size="12" class="shrink-0 opacity-70" />
    <span
      data-testid="queued-message-notice-text"
      class:min-w-0={isSticky}
      class:truncate={isSticky}>{m.chat_queuedNotice_label({ duration: durationLabel })}</span
    >
  </div>
{/if}
