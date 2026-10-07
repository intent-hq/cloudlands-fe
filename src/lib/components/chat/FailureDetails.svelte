<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { m } from '$shared/paraglide/messages.js';
  let { text, label = m.chat_failureRecovery_details_label() }: { text: string; label?: string } =
    $props();
  let expanded = $state(false);
  const id = $props.id();
</script>

<div class="min-w-0">
  <div class="flex flex-wrap items-center gap-1">
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={expanded}
      aria-controls={id}
      onclick={() => (expanded = !expanded)}>{label}</Button
    >
    {#if expanded}
      <CopyButton {text} size="sm" label={m.chat_failureRecovery_copyDetails_label()} />
    {/if}
  </div>
  {#if expanded}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- keyboard users must be able to scroll long diagnostics. -->
    <pre
      {id}
      data-testid="failure-raw-details"
      class="type-caption mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground"
      tabindex="0"
      role="region"
      aria-label={m.chat_failureRecovery_details_label()}>{text}</pre>
  {/if}
</div>
