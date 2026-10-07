<script lang="ts">
  import type { FailureRecord } from '$features/agent/utils/failure-summary';
  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { formatNumber, formatDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  let {
    reason = '',
    records,
    class: className = '',
  }: { reason?: string; records?: readonly FailureRecord[]; class?: string } = $props();
  let expanded = $state(false);
  const id = $props.id();
  const entries = $derived(records ?? [{ messageId: '', reason, timestamp: '' }]);
  const label = $derived(
    entries.length === 1
      ? m.chat_failureRecovery_recorded_one()
      : m.chat_failureRecovery_recorded_many({ count: formatNumber(entries.length) }),
  );
  const details = $derived(
    entries
      .map((record) => [record.timestamp, record.reason].filter(Boolean).join('\n'))
      .join('\n\n'),
  );
</script>

<div class="turn-failure-notice type-caption min-w-0 py-1 text-muted-foreground {className}">
  <div class="flex flex-wrap items-center gap-1">
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={expanded}
      aria-controls={id}
      onclick={() => (expanded = !expanded)}>{label}</Button
    >
    {#if expanded}<CopyButton
        text={details}
        size="sm"
        label={m.chat_failureRecovery_copyDetails_label()}
      />{/if}
  </div>
  {#if expanded}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- keyboard users must be able to scroll historical diagnostics. -->
    <div
      {id}
      class="max-h-64 overflow-y-auto"
      tabindex="0"
      role="region"
      aria-label={m.chat_failureRecovery_details_label()}
    >
      {#each entries as record, index (record.messageId || index)}
        <div class="py-2" data-failure-message-id={record.messageId || undefined}>
          {#if record.timestamp}<time class="type-caption" datetime={String(record.timestamp)}
              >{formatDateTime(record.timestamp)}</time
            >{/if}
          <pre
            class="type-caption whitespace-pre-wrap [overflow-wrap:anywhere]">{record.reason}</pre>
        </div>
      {/each}
    </div>
  {/if}
</div>
