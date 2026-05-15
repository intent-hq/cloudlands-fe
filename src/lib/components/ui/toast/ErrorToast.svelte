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
        return 'text-destructive';
      case 'warning':
        return 'text-amber-500';
      case 'info':
        return 'text-blue-500';
      default:
        return 'text-destructive';
    }
  }

  function getBorderColor(type: string) {
    switch (type) {
      case 'error':
        return 'border-destructive/50';
      case 'warning':
        return 'border-amber-500/50';
      case 'info':
        return 'border-blue-500/50';
      default:
        return 'border-destructive/50';
    }
  }
</script>

<div
  class="flex items-start gap-3 p-4 bg-card border {getBorderColor(
    error.type,
  )} shadow-lg min-w-[360px] max-w-[500px]"
>
  <!-- Icon -->
  <div class="flex-shrink-0 mt-0.5 {getIconColor(error.type)}">
    <Fa icon={getIcon(error.type)} class="w-5 h-5" />
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground line-clamp-2">{error.message}</p>

    <!-- Action buttons -->
    <div class="flex items-center gap-2 mt-3">
      <Button variant="outline" size="sm" onclick={onCopy}>Copy</Button>
      <Button variant="outline" size="sm" onclick={onDebug}>Debug with AI</Button>
      {#if error.recoverable && onRetry}
        <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
      {/if}
    </div>
  </div>

  <!-- Close button -->
  <button
    type="button"
    class="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    onclick={handleDismiss}
    aria-label="Close"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"
      ></path>
    </svg>
  </button>
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
