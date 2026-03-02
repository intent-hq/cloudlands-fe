<!--
  StreamingStatus.svelte

  Progressive streaming status indicator that shows different states:
  - Normal: Pulsing dots (thinking)
  - Slow (>15s): "Taking a moment..." with dots
  - Very slow (>45s): "Taking longer than expected" with Stop button
  - Error/Timeout: "Connection issue" with Try Again button

  Replaces StreamingTypingIndicator and LongRunningDebugInfo for a unified UX.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
    faRotateRight,
    faStop,
    faInfoCircle,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils/cn';
  import { Spinner } from '$lib/components/ui/indicators';

  interface Props {
    /** Whether streaming is active */
    isStreaming?: boolean;
    /** Whether processing (waiting for response) */
    isProcessing?: boolean;
    /** When streaming/processing started (timestamp in ms) */
    startTime?: number | null;
    /** Current streaming content length (to know if we've received anything) */
    streamingContentLength?: number;
    /** Error message if connection failed */
    error?: string | null;
    /** Whether the stream appears stalled (no chunks received recently) */
    isStalled?: boolean;
    /** Model unavailable info - when set, shows retry with suggested model */
    modelUnavailable?: {
      failedModel: string;
      nextAvailableModel: string;
    } | null;
    /** Whether a permission request is pending - if true, hide the thinking indicator */
    hasPendingPermission?: boolean;
    /** Callback to retry the last message */
    onRetry?: () => void;
    /** Callback to retry with a specific model */
    onRetryWithModel?: (model: string) => void;
    /** Callback to stop streaming */
    onStop?: () => void;
    /** Seed for spinner colors (typically agent ID) */
    seed?: string;
    /** Additional class names */
    class?: string;
  }

  let {
    isStreaming = false,
    isProcessing = false,
    startTime = null,
    streamingContentLength = 0,
    error = null,
    isStalled = false,
    modelUnavailable = null,
    hasPendingPermission = false,
    onRetry,
    onRetryWithModel,
    onStop,
    seed,
    class: className = '',
  }: Props = $props();

  // Time thresholds (in seconds)
  const SLOW_THRESHOLD = 15;
  const VERY_SLOW_THRESHOLD = 45;

  let elapsedSeconds = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function updateElapsed() {
    if (startTime) {
      elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    }
  }

  // Determine current status
  type Status = 'normal' | 'slow' | 'very-slow' | 'stalled' | 'error' | 'model-unavailable';

  let status: Status = $derived.by(() => {
    if (modelUnavailable) return 'model-unavailable';
    if (error) return 'error';
    if (isStalled) return 'stalled'; // Stalled takes priority over time-based thresholds
    if (!startTime) return 'normal';
    if (elapsedSeconds >= VERY_SLOW_THRESHOLD) return 'very-slow';
    if (elapsedSeconds >= SLOW_THRESHOLD && streamingContentLength === 0) return 'slow';
    return 'normal';
  });

  // Should we show at all?
  // Don't show thinking indicator when waiting for permission - the permission UI takes over
  let visible = $derived(
    (isStreaming || isProcessing || error || modelUnavailable) && !hasPendingPermission,
  );

  // Status message - display user-friendly error messages with actionable guidance
  let statusMessage = $derived.by(() => {
    if (error) {
      return error;
    }
    if (status === 'stalled') {
      // More actionable message - let users know they can stop and retry
      return 'Response delayed. You can wait or try again.';
    }
    if (status === 'very-slow') {
      return streamingContentLength > 0
        ? 'Response taking longer than expected...'
        : 'Taking longer than expected';
    }
    if (status === 'slow') {
      return 'Agent is connecting...';
    }
    return 'Thinking';
  });

  onMount(() => {
    updateElapsed();
    intervalId = setInterval(updateElapsed, 1000);
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });
</script>

{#if visible}
  <div
    class={cn(
      'flex items-center gap-3 py-2 pl-2 pr-3 text-sm',
      status === 'error' && '',
      status === 'stalled' && 'bg-amber-500/5 rounded-lg border border-amber-500/20',
      status === 'very-slow' && 'bg-amber-500/5 rounded-lg border border-amber-500/20',
      status === 'model-unavailable' && 'bg-amber-500/5 rounded-lg border border-amber-500/20',
      className,
    )}
    in:fade={{ duration: 200, easing: cubicOut }}
    out:fade={{ duration: 150, easing: cubicOut }}
  >
    <!-- Status content -->
    <div class="flex-1 flex items-center gap-2">
      {#if status === 'model-unavailable' && modelUnavailable}
        <Fa icon={faExclamationTriangle} class="text-amber-500/70 shrink-0" />
        <span class="text-amber-600 dark:text-amber-400 text-sm">
          Model <code class="px-1 py-0.5 bg-muted rounded text-ui"
            >{modelUnavailable.failedModel}</code
          > is not available
        </span>
      {:else if status === 'error' && error}
        <Fa icon={faExclamationTriangle} class="text-destructive/70 shrink-0" />
        <span class="text-destructive-foreground text-sm">{statusMessage}</span>
      {:else if status === 'stalled'}
        <!-- Stalled just means no chunks for 90s - agent is likely doing complex work -->
        <Fa icon={faInfoCircle} class="text-amber-500/70 shrink-0" />
        <Spinner size={4} {seed} />
        <span class="text-amber-600 dark:text-amber-400 text-sm font-family-child"
          >{statusMessage}</span
        >
      {:else if status === 'very-slow'}
        <Fa icon={faInfoCircle} class="text-amber-500/70 shrink-0" />
        <span class="text-amber-600 dark:text-amber-400 text-sm font-family-child"
          >{statusMessage}</span
        >
      {:else}
        <!-- Normal / slow - show spinner -->
        <Spinner size={4} {seed} />
        <span class="text-subtle text-sm font-family-child">{statusMessage}</span>
      {/if}
    </div>

    <!-- Action buttons -->
    <div class="flex items-center gap-1">
      {#if status === 'model-unavailable' && modelUnavailable && onRetryWithModel}
        <!-- Show retry with suggested model button -->
        <Button
          variant="default"
          size="sm"
          onclick={() => onRetryWithModel(modelUnavailable.nextAvailableModel)}
          class="h-7 px-2 text-sm gap-1.5"
        >
          <Fa icon={faRotateRight} class="size-3" />
          Retry with {modelUnavailable.nextAvailableModel}
        </Button>
      {:else if status === 'error' && onRetry && !isStreaming && !isProcessing}
        <!-- Only show retry when NOT actively streaming/processing to prevent double-sends -->
        <Button variant="ghost" size="sm" onclick={onRetry} class="h-7 px-2 text-sm gap-1.5">
          <Fa icon={faRotateRight} class="size-3" />
          Try again
        </Button>
      {/if}
      {#if (status === 'stalled' || status === 'very-slow' || status === 'slow') && onStop && (isStreaming || isProcessing)}
        <!-- Only show stop when actually streaming/processing -->
        <Button
          variant="ghost"
          size="sm"
          onclick={onStop}
          class="h-7 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Fa icon={faStop} class="size-3" />
        </Button>
      {/if}
    </div>
  </div>
{/if}
