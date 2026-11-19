<!-- Renders as `contents`: the toggle joins the parent's action row and the
     diagnostics wrap onto their own full-width line below it. -->
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { m } from '$shared/paraglide/messages.js';
  let {
    text,
    label = m.chat_failureRecovery_details_label(),
    leading = false,
  }: {
    text: string;
    label?: string;
    /** First control in its row: its label aligns with the text above. */
    leading?: boolean;
  } = $props();
  let expanded = $state(false);
  const id = $props.id();
</script>

<div class="contents">
  <Button
    variant="ghost-light"
    size="sm"
    class="px-2 {leading ? '-ml-2' : ''}"
    aria-expanded={expanded}
    aria-controls={id}
    onclick={() => (expanded = !expanded)}>{label}</Button
  >
  {#if expanded}
    <div class="relative order-last w-full min-w-0 basis-full">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -- keyboard users must be able to scroll long diagnostics. -->
      <pre
        {id}
        data-testid="failure-raw-details"
        class="type-code max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/60 py-2 pl-2.5 pr-9 text-xs [overflow-wrap:anywhere] text-muted-foreground"
        tabindex="0"
        role="region"
        aria-label={m.chat_failureRecovery_details_label()}>{text}</pre>
      <div class="absolute right-1 top-1 flex">
        <CopyButton {text} size="xs" label={m.chat_failureRecovery_copyDetails_label()} />
      </div>
    </div>
  {/if}
</div>
