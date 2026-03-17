<!--
  StreamingStatus.svelte

  Streaming status indicator that shows two states based on silence duration
  (time since last chunk, or since start if no chunks yet):

  - Normal: Spinner with "Thinking"
  - Stalled (>90s): Warning with status page link and Stop button
  - Error/Timeout: "Connection issue" with Try Again button

  Distinguishes between "no data received" (could be network/provider) and
  "mid-stream silence" (agent is taking long) for more accurate messaging.
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
    /** When the last streaming chunk was received (timestamp in ms) */
    lastChunkTime?: number | null;
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
    /** Display name of the model provider (e.g. "Claude Code") for contextual messages */
    providerName?: string | null;
    /** Seed for spinner colors (typically agent ID) */
    seed?: string;
    /** Additional class names */
    class?: string;
  }

  let {
    isStreaming = false,
    isProcessing = false,
    startTime = null,
    lastChunkTime = null,
    streamingContentLength = 0,
    error = null,
    isStalled = false,
    modelUnavailable = null,
    hasPendingPermission = false,
    providerName = null,
    onRetry,
    onRetryWithModel,
    onStop,
    seed,
    class: className = '',
  }: Props = $props();

  // Silence threshold (in seconds since last chunk, or since start if no chunks yet)
  const STALLED_THRESHOLD = 90;

  // Provider status page URLs — used in stalled messages
  const PROVIDER_STATUS_URLS: Record<string, string> = {
    'Augment Auggie': 'https://status.augmentcode.com/',
    'Anthropic Claude Code': 'https://status.anthropic.com/',
    'OpenAI Codex': 'https://status.openai.com/',
  };

  let providerStatusUrl = $derived(
    providerName ? (PROVIDER_STATUS_URLS[providerName] ?? null) : null,
  );

  /** Seconds of silence — time since last chunk arrived, or since start if no chunks yet */
  let silenceSeconds = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function updateSilence() {
    // Measure from the most recent activity: last chunk if we've received data, otherwise start time
    const referenceTime = lastChunkTime ?? startTime;
    if (referenceTime) {
      silenceSeconds = Math.floor((Date.now() - referenceTime) / 1000);
    } else {
      silenceSeconds = 0;
    }
  }

  // Determine current status based on silence duration
  type Status = 'normal' | 'stalled' | 'error' | 'model-unavailable';

  let status: Status = $derived.by(() => {
    if (modelUnavailable) return 'model-unavailable';
    if (error) return 'error';
    if (isStalled) return 'stalled'; // External stall detection takes priority
    if (!startTime) return 'normal';
    if (silenceSeconds >= STALLED_THRESHOLD && !hasReceivedData) return 'stalled';
    return 'normal';
  });

  // Should we show at all?
  // Don't show thinking indicator when waiting for permission - the permission UI takes over
  let visible = $derived(
    (isStreaming || isProcessing || error || modelUnavailable) && !hasPendingPermission,
  );

  // Whether we've received any streaming data — used to distinguish
  // "no data" (network/provider unknown) from "mid-stream silence" (agent working)
  let hasReceivedData = $derived((streamingContentLength ?? 0) > 0 || lastChunkTime !== null);

  // Status message - differentiated by whether we've received data:
  // - No data: neutral messages (could be network, provider, or agent)
  // - Has data: agent-specific messages (connection was working, agent is slow)
  let statusMessage = $derived.by(() => {
    if (error) {
      return error;
    }

    if (status === 'stalled') {
      if (hasReceivedData) {
        return providerName
          ? `Your model provider, ${providerName}, is taking longer than usual to respond.`
          : 'Agent is taking longer than usual to respond.';
      } else {
        return 'No response received. Check your network connection or try again.';
      }
    }

    return 'Thinking';
  });

  onMount(() => {
    updateSilence();
    intervalId = setInterval(updateSilence, 1000);
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
        <!-- Stalled means no chunks for 90s -->
        <Fa icon={faInfoCircle} class="text-amber-500/70 shrink-0" />
        <Spinner size={4} {seed} />
        <span class="text-amber-600 dark:text-amber-400 text-sm font-family-child">
          {statusMessage}
          {#if providerStatusUrl}
            <a
              href={providerStatusUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-amber-500 dark:hover:text-amber-300">Check status</a
            >
          {/if}
        </span>
      {:else}
        <!-- Normal - show spinner -->
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
      {#if status === 'stalled' && onStop && (isStreaming || isProcessing)}
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
