<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { ToastCloseButton, ToastGlyph } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    message: string;
    details: string;
  }

  let { message, details }: Props = $props();
  const dispatch = createEventDispatcher();

  async function copyDetails() {
    await navigator.clipboard.writeText(details);
  }
</script>

<div
  class="relative flex min-w-0 flex-1 items-start gap-2.5 pr-6"
  data-toast-layout="error-details"
>
  <ToastGlyph variant="error" />
  <div class="min-w-0 flex-1">
    <p class="toast-title break-words text-foreground">{message}</p>
    <details class="mt-2 min-w-0 text-sm text-muted-foreground">
      <summary class="toast-details-summary cursor-pointer select-none">
        <span class="toast-details-chevron" aria-hidden="true">›</span>
        {m.chat_toolCall_technicalDetails_label()}
      </summary>
      <pre
        class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-(--radius-medium) bg-muted p-2">{details}</pre>
      <Button variant="ghost" size="compact" class="toast-detail-copy mt-2" onclick={copyDetails}>
        {m.ui_errorToast_copy_label()}
      </Button>
    </details>
  </div>
  <ToastCloseButton
    onclick={() => dispatch('closeToast')}
    ariaLabel={m.ui_toast_close_ariaLabel()}
  />
</div>

<style>
  .toast-title {
    font-size: var(--toast-title-size, 0.8125rem);
    font-weight: 500;
    line-height: 1.4;
  }

  .toast-details-summary {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: hsl(var(--muted-foreground));
    list-style: none;
  }

  .toast-details-summary::-webkit-details-marker {
    display: none;
  }

  .toast-details-chevron {
    display: inline-block;
    font-size: 0.75rem;
    transition: transform var(--spring-fast) var(--spring-fast-ease);
  }

  details[open] .toast-details-chevron {
    transform: rotate(90deg);
  }

  .toast-details-summary:focus-visible,
  :global(.toast-detail-copy:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }

  :global(.toast-detail-copy) {
    min-height: var(--toast-action-height, var(--control-height-compact));
    border-radius: var(--toast-action-radius, var(--radius));
  }

  @media (prefers-reduced-motion: reduce) {
    .toast-details-chevron {
      transition: none;
    }
  }
</style>
