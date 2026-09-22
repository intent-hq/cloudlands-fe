<script lang="ts">
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { safeDisclosureTransition } from './disclosure-motion';
  import { OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS } from './operational-disclosure-row';

  interface Props {
    title: string;
    reason?: string;
    timestamp?: string;
    tone: 'danger' | 'warning';
    announce?: boolean;
    testIdPrefix?: string;
    class?: string;
  }

  let {
    title,
    reason,
    timestamp,
    tone,
    announce = true,
    testIdPrefix = 'chat-notice',
    class: className = '',
  }: Props = $props();
</script>

<div
  class="mt-10 w-full min-w-0 max-w-full font-family-child {tone === 'danger'
    ? 'text-danger'
    : 'text-warning-ink'} {className}"
  data-chat-notice
  data-testid="{testIdPrefix}-banner"
  role={announce ? 'alert' : undefined}
  aria-live={announce ? 'polite' : undefined}
  transition:safeDisclosureTransition={{ tier: 'moderate' }}
>
  <div class="flex flex-col gap-1 pr-3 py-1.5 type-body {OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}">
    <div class="flex items-start justify-between gap-3" data-testid="{testIdPrefix}-header">
      <span
        class="min-w-0 break-words whitespace-pre-wrap"
        data-chat-notice-label
        data-testid="{testIdPrefix}-label">{title}</span
      >
      {#if timestamp}
        <RelativeTime
          date={timestamp}
          class="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
        />
      {/if}
    </div>
    {#if reason}
      <span
        class="break-words whitespace-pre-wrap text-muted-foreground"
        data-chat-notice-reason
        data-testid="{testIdPrefix}-reason">{reason}</span
      >
    {/if}
  </div>
</div>
