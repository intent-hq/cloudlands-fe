<script lang="ts">
  /**
   * QueuedMessageNoticeHeader
   *
   * Inline delivery metadata in the message's hover/focus action toolbar:
   * clock icon + localized wait duration. Driven by
   * `metadata.queueInfo` (PROTOCOL.md §5.5); the raw
   * `[SYSTEM NOTE]` line stays in the persisted content for the agent and is
   * hidden from the displayed body instead. The tooltip preserves the full
   * duration and queued time on hover or keyboard focus even in narrow panels.
   */
  import Fa from 'svelte-fa';
  import { faClock } from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import type { QueueInfo } from '$lib/utils/queue-info';
  import { formatCompactDuration, formatFullDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    queueInfo: QueueInfo;
  }

  let { queueInfo }: Props = $props();

  // The canonical formatter rounds to the nearest second and supplies
  // locale-aware singular/plural units. A rounded zero delay has no notice.
  const durationLabel = $derived(
    Math.round(queueInfo.waitedMs / 1000) > 0 ? formatCompactDuration(queueInfo.waitedMs) : '',
  );
  const waitLabel = $derived(m.chat_queuedNotice_label({ duration: durationLabel }));
  const queuedTime = $derived(formatFullDateTime(queueInfo.queuedAt));
</script>

{#if durationLabel}
  <Tooltip class="min-w-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
    {#snippet content()}
      <span>{waitLabel}</span>
      <span class="block">{queuedTime}</span>
    {/snippet}
    <span
      class="type-caption flex min-w-0 items-center gap-1 px-1 text-muted-foreground"
      title={queuedTime}
      data-testid="queued-message-notice"
    >
      <Fa icon={faClock} size="12" class="shrink-0 opacity-70" />
      <span data-testid="queued-message-notice-text" class="sr-only">{waitLabel}</span>
      <span class="truncate tabular-nums" aria-hidden="true">{durationLabel}</span>
    </span>
  </Tooltip>
{/if}
