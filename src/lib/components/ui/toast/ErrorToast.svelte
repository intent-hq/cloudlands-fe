<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { AppError } from '$lib/utils/error-handler.svelte';
  import ToastCloseButton from './ToastCloseButton.svelte';
  import ToastGlyph from './ToastGlyph.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    error: AppError;
    onCopy: () => void;
    onDebug: () => void;
    onRetry?: () => void;
  }

  let { error, onCopy, onDebug, onRetry }: Props = $props();

  const dispatch = createEventDispatcher();

  function handleDismiss() {
    dispatch('closeToast');
  }

  function getGlyph(type: string): 'error' | 'warning' | 'info' {
    switch (type) {
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'error';
    }
  }
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding);
     the severity border tint is passed as a wrapper class by error-toast.ts. -->
<div
  class="relative flex w-full min-w-0 items-start gap-3 pr-10"
  data-toast-layout="application-error"
>
  <ToastGlyph variant={getGlyph(error.type)} />

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <p class="toast-title line-clamp-2 break-words">{error.title}</p>
    <p class="toast-description line-clamp-2 break-words">{error.message}</p>

    <!-- Action buttons -->
    <div class="toast-actions">
      {#if error.recoverable && onRetry}
        <Button variant="outline" size="default" class="toast-action" onclick={onRetry}
          >{m.ui_errorToast_retry_label()}</Button
        >
      {/if}
      <Button variant="outline" size="default" class="toast-action" onclick={onDebug}
        >{m.ui_errorToast_debug_label()}</Button
      >
      <Button variant="ghost" size="default" class="toast-action" onclick={onCopy}
        >{m.ui_errorToast_copy_label()}</Button
      >
    </div>
  </div>

  <!-- Close button -->
  <ToastCloseButton onclick={handleDismiss} ariaLabel={m.ui_errorToast_close_ariaLabel()} />
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .toast-title {
    color: hsl(var(--foreground));
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.35;
  }

  .toast-description {
    margin-top: 0.25rem;
    color: hsl(var(--muted-foreground));
    font-size: 0.9375rem;
    line-height: 1.4;
  }

  .toast-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  :global(.toast-action) {
    border-radius: var(--radius-medium);
  }

  :global(.toast-action:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }
</style>
