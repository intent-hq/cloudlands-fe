<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
  import type { FailureRecord } from '$features/agent/utils/failure-summary';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { formatDateTime, formatTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import ChatOperationalRow from './ChatOperationalRow.svelte';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    OPERATIONAL_EXPANDED_CONTENT_CLASS,
  } from './operational-disclosure-row';
  let {
    reason = '',
    records,
    class: className = '',
  }: { reason?: string; records?: readonly FailureRecord[]; class?: string } = $props();
  let expanded = $state(false);
  const id = $props.id();
  const entries = $derived(records ?? [{ messageId: '', reason, timestamp: '' }]);
  const label = m.chat_streamingStatus_responseFailed_label();
  const details = $derived(
    entries
      .map((record) =>
        [record.timestamp ? formatDateTime(record.timestamp) : '', record.reason]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n'),
  );
</script>

{#snippet leading()}
  <Fa icon={faCircleExclamation} class="{CHAT_OPERATIONAL_ICON_CLASS} text-subtle opacity-50" />
{/snippet}
{#snippet summary()}
  <span class="text-subtle">{label}</span>
{/snippet}
{#snippet trailing()}
  {#if expanded}
    <CopyButton text={details} size="xs" label={m.chat_failureRecovery_copyDetails_label()} />
  {/if}
{/snippet}
{#snippet detailsBody()}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -- keyboard users must be able to scroll historical diagnostics. -->
  <div
    class="grid max-h-64 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 overflow-y-auto"
    tabindex="0"
    role="region"
    aria-label={m.chat_failureRecovery_details_label()}
  >
    {#each entries as record, index (record.messageId || index)}
      <div class="contents" data-failure-message-id={record.messageId || undefined}>
        {#if record.timestamp}<time
            class="whitespace-nowrap tabular-nums text-subtle"
            datetime={String(record.timestamp)}>{formatTime(record.timestamp)}</time
          >{/if}
        <p
          class="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] {record.timestamp
            ? ''
            : 'col-span-2'}"
        >
          {record.reason}
        </p>
      </div>
    {/each}
  </div>
{/snippet}

<ChatOperationalRow
  {leading}
  {summary}
  {trailing}
  details={detailsBody}
  animateDetailsHeight
  interactive
  {expanded}
  controls={id}
  detailsId={id}
  ariaLabel={label}
  onclick={() => (expanded = !expanded)}
  detailsClass="{OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground"
  testId="turn-failure-notice"
  class="turn-failure-notice mb-3 mt-1 {className}"
/>
