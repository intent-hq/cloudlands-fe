<!--
  StreamingStatus.svelte

  Streaming status indicator:
  - Normal: Spinner with "Thinking"
  - Error/Timeout: clear failed state with Try Again button
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import {
  faRotateRight,
  faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils/cn';
  import { Spinner } from '$lib/components/ui/indicators';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { deriveErrorDisplay, formatDuration, formatElapsed } from './streaming-status-utils';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Whether streaming is active */
    isStreaming?: boolean;
    /** Whether processing (waiting for response) */
    isProcessing?: boolean;
    /** When the last streaming chunk was received (timestamp in ms) */
    lastChunkTime?: number | null;
    /** Whether we've received the first real chunk (distinct from lastChunkTime which is set on 'start') */
    receivedFirstChunk?: boolean;
    /** Current streaming content length (to know if we've received anything) */
    streamingContentLength?: number;
    /** Error message if connection failed */
    error?: string | null;
    /**
     * Daemon-derived corrupted-session flag (monorepo#940) — when true, the
     * error surface shows recreate-aware copy instead of the raw error.
     */
    sessionCorrupted?: boolean;
    /** ISO timestamp of when the failure occurred - renders a live "failed X ago" */
    failedAt?: string | null;
    /** Model unavailable info - when set, shows retry with suggested model */
    modelUnavailable?: {
      failedModel: string;
      nextAvailableModel: string;
    } | null;
    /** Transient lifecycle status events from the backend */
    statusEvents?: Array<{ phase: string; message: string; level: 'info' | 'warn' | 'error'; timestamp: number }>;
    /** When streaming/processing started (timestamp ms) - used to calculate reveal delay */
    streamingStartTime?: number | null;
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
    lastChunkTime = null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    receivedFirstChunk = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    streamingContentLength = 0,
    error = null,
    sessionCorrupted = false,
    failedAt = null,
    modelUnavailable = null,
    statusEvents = [],
    streamingStartTime = null,
    hasPendingPermission = false,
    onRetry,
    onRetryWithModel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onStop,
    seed,
    class: className = '',
  }: Props = $props();

  // --- Status events: show after 5s of streaming ---
  let expanded = $state(false);

  // --- Live-updating elapsed time for the latest event ---
  let nowMs = $state(Date.now());
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;

  function clearElapsedInterval() {
    if (elapsedInterval !== null) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  // Sort status events by timestamp to handle out-of-order arrivals.
  // This ensures latestEvent and duration calculations are correct even if
  // events arrive late or out of sequence.
  let sortedStatusEvents = $derived(
    statusEvents.length > 1
      ? [...statusEvents].sort((a, b) => a.timestamp - b.timestamp)
      : statusEvents,
  );

  // Effective start time: use streamingStartTime if available, otherwise fall back to
  // the first status event's timestamp or Date.now(). This handles recovered streams
  // where isStreaming=true but streamingStartTime is null after initializeChat().
  let effectiveStartTime = $derived.by(() => {
    if (streamingStartTime) return streamingStartTime;
    if (sortedStatusEvents.length > 0) return sortedStatusEvents[0].timestamp;
    return Date.now();
  });

  // Derive showDetails from whether we're active and have status events to show.
  // This survives component remounts (ChatPanel switches rendering paths
  // when the first chunk arrives, destroying one StreamingStatus and creating another).
  let showDetails = $derived.by(() => {
    const active = isStreaming || isProcessing;
    if (!active) return false;
    return sortedStatusEvents.length > 0;
  });

  // Reset expanded when streaming ends
  $effect(() => {
    const active = isStreaming || isProcessing;
    if (!active) {
      expanded = false;
    }
  });

  // Find the latest event by timestamp (using sorted array)
  let latestEvent = $derived(
    sortedStatusEvents.length > 0 ? sortedStatusEvents[sortedStatusEvents.length - 1] : null,
  );

  // Whether we've received at least one chunk (streaming content actively arriving)
  // Use receivedFirstChunk prop instead of lastChunkTime !== null, because lastChunkTime
  // is set during the 'start' event before any real chunk arrives.

  // Time since streaming started (shown inline after first chunk arrives)
  // Uses effectiveStartTime to handle recovered streams where streamingStartTime is null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let streamingElapsedTime = $derived.by(() => {
    const elapsed = nowMs - effectiveStartTime;
    return formatDuration(elapsed);
  });

  // Start/stop the 1s interval based on whether we're actively streaming
  $effect(() => {
    const active = isStreaming || isProcessing;
    if (active) {
      clearElapsedInterval();
      nowMs = Date.now();
      elapsedInterval = setInterval(() => {
        nowMs = Date.now();
      }, 1000);
    } else {
      clearElapsedInterval();
    }
  });

  // Clean up interval on destroy
  onDestroy(() => {
    clearElapsedInterval();
  });

  // Elapsed time for the latest (active) event - always show "Xs ago"
  let elapsedTime = $derived.by(() => {
    if (!latestEvent) return '';
    const elapsed = nowMs - latestEvent.timestamp;
    return `${formatElapsed(elapsed)} ago`;
  });

  // Completed events with their durations
  // Always exclude the last event — before chunks arrive, it's the active event shown inline;
  // after chunks arrive, it's "Streaming response…" representing current state (shown as elapsed time)
  // Uses sortedStatusEvents to ensure correct duration calculations even with out-of-order events
  let completedEventsWithDurations = $derived.by(() => {
    const events = sortedStatusEvents.slice(0, -1);
    if (events.length === 0) return [];

    const completed: Array<{ event: (typeof sortedStatusEvents)[0]; duration: string }> = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const nextTimestamp =
        i < sortedStatusEvents.length - 1
          ? sortedStatusEvents[i + 1].timestamp
          : (lastChunkTime || nowMs);
      const durationMs = nextTimestamp - event.timestamp;
      completed.push({
        event,
        duration: formatDuration(durationMs),
      });
    }
    // Return in reverse order (newest completed first, oldest last)
    return completed.reverse();
  });


  // Determine current status
  type Status = 'normal' | 'error' | 'model-unavailable';

  let status: Status = $derived.by(() => {
    if (modelUnavailable) return 'model-unavailable';
    if (error) return 'error';
    return 'normal';
  });

  // Should we show at all?
  // Don't show thinking indicator when waiting for permission - the permission UI takes over.
  let visible = $derived(
    error || modelUnavailable || ((isStreaming || isProcessing) && !hasPendingPermission),
  );

  // Status message: the raw error when one is set, otherwise "Thinking"
  let statusMessage = $derived.by(() => {
    if (error) {
      return error;
    }
    return m.chat_streamingStatus_thinking_label();
  });

  // Error surface copy: recreate-aware when the daemon flagged the session
  // corrupted (monorepo#940), otherwise identical to the raw-error rendering.
  let errorDisplay = $derived(deriveErrorDisplay(error, sessionCorrupted));
</script>

{#if visible}
  <div
    role={status === 'error' ? 'alert' : undefined}
    aria-live={status === 'error' ? 'assertive' : undefined}
    class={cn(
      'flex flex-col gap-0 py-2 pl-2 pr-3 text-sm rounded-lg',
      status === 'error' && 'bg-destructive/10 border border-destructive/30',
      status === 'model-unavailable' && 'bg-amber-500/5 rounded-lg border border-amber-500/20',
      className,
    )}
    in:fade={{ duration: 200, easing: cubicOut }}
    out:fade={{ duration: 150, easing: cubicOut }}
  >
    <!-- Top row: Spinner + Thinking + Action buttons -->
    <div class="flex items-center gap-3">
      <!-- Status content -->
      <div class="flex-1 flex items-center gap-2">
        {#if status === 'model-unavailable' && modelUnavailable}
          <Fa icon={faExclamationTriangle} class="text-amber-500/70 shrink-0" />
          <span class="text-amber-600 dark:text-amber-400 text-sm">
            {m.chat_streamingStatus_modelUnavailable_before()} <code
              class="px-1 py-0.5 bg-muted rounded text-ui">{modelUnavailable.failedModel}</code
            > {m.chat_streamingStatus_modelUnavailable_after()}
          </span>
        {:else if status === 'error' && errorDisplay}
          <Fa icon={faExclamationTriangle} class="text-destructive-foreground/70 shrink-0" />
          <div class="flex flex-col gap-0.5">
            <span class="text-destructive-foreground text-sm font-medium" data-testid="error-title"
              >{errorDisplay.title}{#if failedAt}
                <span class="text-destructive-foreground/60 text-xs font-normal" data-testid="error-failed-at">
                  <!-- i18n-ignore (punctuation separator) -->
                  · <RelativeTime date={failedAt} />
                </span>
              {/if}</span>
            <span class="text-destructive-foreground text-sm" data-testid="error-message">{errorDisplay.message}</span>
            {#if errorDisplay.detail}
              <span class="text-destructive-foreground/60 text-xs" data-testid="error-detail">{errorDisplay.detail}</span>
            {/if}
          </div>
        {:else}
          <!-- Normal - show spinner -->
          <Spinner size={4} {seed} />
          <span class="text-subtle text-sm font-family-child" data-testid="streaming-status-thinking">{statusMessage}</span>
          {#if showDetails && sortedStatusEvents.length > 0 && latestEvent}
            <button
              onclick={() => sortedStatusEvents.length > 1 && (expanded = !expanded)}
              class="flex items-center gap-1.5 text-xs {latestEvent.level === 'warn' ? 'text-amber-500' : latestEvent.level === 'error' ? 'text-destructive-foreground' : 'text-ghost'} {sortedStatusEvents.length > 1 ? 'hover:text-subtle cursor-pointer' : 'cursor-default'}"
            >
              <span class="text-ghost/30">·</span>
              <span>{latestEvent.message}</span>
              <span class="text-ghost/60">{elapsedTime}</span>
              {#if sortedStatusEvents.length > 1}
                <span class="w-3">{expanded ? '▾' : '▸'}</span>
              {/if}
            </button>
          {/if}
        {/if}
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-1">
        {#if status === 'model-unavailable' && modelUnavailable && onRetryWithModel}
          <Button
            variant="default"
            size="sm"
            onclick={() => onRetryWithModel(modelUnavailable.nextAvailableModel)}
            class="h-7 px-2 text-sm gap-1.5"
          >
            <Fa icon={faRotateRight} class="size-3" />
            {m.chat_streamingStatus_retryWith_label({ model: modelUnavailable.nextAvailableModel })}
          </Button>
        {:else if status === 'error' && onRetry && !isStreaming && !isProcessing}
          <Button variant="ghost" size="sm" onclick={onRetry} class="h-7 px-2 text-sm gap-1.5">
            <Fa icon={faRotateRight} class="size-3" />
            {m.chat_streamingStatus_tryAgain_label()}
          </Button>
        {/if}
      </div>
    </div>

    <!-- Expanded history: only older completed events -->
    {#if showDetails && expanded && completedEventsWithDurations.length > 0}
      <div class="flex flex-col gap-0.5 mt-1 ml-6" transition:fade={{ duration: 200, easing: cubicOut }}>
        {#each completedEventsWithDurations as { event, duration }}
          <div class="flex items-center gap-1.5 text-xs {event.level === 'warn' ? 'text-amber-500' : event.level === 'error' ? 'text-destructive-foreground' : 'text-ghost'}">
            <span class="w-3 text-ghost/30">│</span>
            <span>{event.message}</span>
            <span class="text-ghost/60">{m.chat_streamingStatus_took_label({ duration })}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
