<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faExclamationCircle,
    faTriangleExclamation,
    faCircleInfo,
  } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import type { AppError } from '$lib/utils/error-handler.svelte';
  import ToastCloseButton from './ToastCloseButton.svelte';
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

  function getIcon(type: string) {
    switch (type) {
      case 'error':
        return faExclamationCircle;
      case 'warning':
        return faTriangleExclamation;
      case 'info':
        return faCircleInfo;
      default:
        return faExclamationCircle;
    }
  }

  function getIconColor(type: string) {
    switch (type) {
      case 'error':
        return 'text-danger';
      case 'warning':
        return 'text-warning';
      case 'info':
        return 'text-info';
      default:
        return 'text-danger';
    }
  }
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding);
     the severity border tint is passed as a wrapper class by error-toast.ts. -->
<div class="relative flex w-full min-w-0 items-start gap-3">
  <!-- Icon -->
  <div class="flex-shrink-0 mt-0.5 {getIconColor(error.type)}">
    <Fa icon={getIcon(error.type)} class="w-5 h-5" />
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground line-clamp-2 break-words">{error.message}</p>

    <!-- Action buttons -->
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <Button variant="outline" size="sm" onclick={onCopy}>{m.ui_errorToast_copy_label()}</Button>
      <Button variant="outline" size="sm" onclick={onDebug}>{m.ui_errorToast_debug_label()}</Button>
      {#if error.recoverable && onRetry}
        <Button variant="outline" size="sm" onclick={onRetry}
          >{m.ui_errorToast_retry_label()}</Button
        >
      {/if}
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
</style>
