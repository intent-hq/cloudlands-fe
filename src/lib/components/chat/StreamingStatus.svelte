<!--
  StreamingStatus.svelte

  Streaming status indicator:
  - Normal: Spinner with "Thinking"
  - Error/Timeout: clear failed state with Try Again button
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import { faRotateRight, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils/cn';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { deriveErrorDisplay } from './streaming-status-utils';
  import { m } from '$shared/paraglide/messages.js';
  import StreamingTypingIndicator from './StreamingTypingIndicator.svelte';

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
    statusEvents?: Array<{
      phase: string;
      message: string;
      level: 'info' | 'warn' | 'error';
      timestamp: number;
    }>;
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    lastChunkTime = null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    receivedFirstChunk = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    streamingContentLength = 0,
    error = null,
    sessionCorrupted = false,
    failedAt = null,
    modelUnavailable = null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    statusEvents = [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    streamingStartTime = null,
    hasPendingPermission = false,
    onRetry,
    onRetryWithModel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onStop,
    seed,
    class: className = '',
  }: Props = $props();

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
  {#if status === 'normal'}
    <StreamingTypingIndicator visible message={statusMessage} {seed} class={className} />
  {:else}
    <div
      role={status === 'error' ? 'alert' : undefined}
      aria-live={status === 'error' ? 'assertive' : undefined}
      class={cn(
        'type-caption flex flex-col gap-0 rounded-md py-2 pl-2 pr-3',
        status === 'error' && 'bg-destructive/10 border border-destructive/30',
        status === 'model-unavailable' && 'border border-warning/20 bg-warning/5',
        className,
      )}
      in:fade={{ duration: 200, easing: cubicOut }}
      out:fade={{ duration: 150, easing: cubicOut }}
    >
      <div class="flex items-center gap-3">
        <div class="flex-1 flex items-center gap-2">
          {#if status === 'model-unavailable' && modelUnavailable}
            <Fa icon={faExclamationTriangle} class="shrink-0 text-warning/70" />
            <span class="text-warning">
              {m.chat_streamingStatus_modelUnavailable_before()}
              <code class="px-1 py-0.5 bg-muted rounded text-ui"
                >{modelUnavailable.failedModel}</code
              >
              {m.chat_streamingStatus_modelUnavailable_after()}
            </span>
          {:else if status === 'error' && errorDisplay}
            <Fa icon={faExclamationTriangle} class="text-destructive-foreground/70 shrink-0" />
            <div class="flex flex-col gap-0.5">
              <span class="font-medium text-destructive-foreground" data-testid="error-title"
                >{errorDisplay.title}{#if failedAt}
                  <span
                    class="text-destructive-foreground/60 text-xs font-normal"
                    data-testid="error-failed-at"
                  >
                    <!-- i18n-ignore (punctuation separator) -->
                    · <RelativeTime date={failedAt} />
                  </span>
                {/if}</span
              >
              <span class="text-destructive-foreground" data-testid="error-message"
                >{errorDisplay.message}</span
              >
              {#if errorDisplay.detail}
                <span class="text-destructive-foreground/60 text-xs" data-testid="error-detail"
                  >{errorDisplay.detail}</span
                >
              {/if}
            </div>
          {/if}
        </div>

        <div class="flex items-center gap-1">
          {#if status === 'model-unavailable' && modelUnavailable && onRetryWithModel}
            <Button
              variant="default"
              size="sm"
              onclick={() => onRetryWithModel(modelUnavailable.nextAvailableModel)}
              class="type-caption h-7 gap-1.5 px-2"
            >
              <Fa icon={faRotateRight} class="size-3" />
              {m.chat_streamingStatus_retryWith_label({
                model: modelUnavailable.nextAvailableModel,
              })}
            </Button>
          {:else if status === 'error' && onRetry && !isStreaming && !isProcessing}
            <Button
              variant="ghost"
              size="sm"
              onclick={onRetry}
              class="type-caption h-7 gap-1.5 px-2"
            >
              <Fa icon={faRotateRight} class="size-3" />
              {m.chat_streamingStatus_tryAgain_label()}
            </Button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
{/if}
