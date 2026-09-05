<!--
  StreamingStatus.svelte

  Streaming status indicator:
  - Normal: Spinner with "Thinking"
  - Error/Timeout: clear failed state with Try Again button
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { safeFade } from '$lib/utils/animations';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
    faRotateRight,
    faExclamationTriangle,
    faCopy,
    faCheck,
    faStop,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils/cn';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import {
    deriveErrorDisplay,
    formatElapsed,
    getActiveStalledEvent,
    getLatestThinkingStatusEvent,
    getStatusMarkVariant,
  } from './streaming-status-utils';
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
    /**
     * Provider auth-failure login guidance: when the error matches the
     * provider's auth-error patterns, shows the copyable login command (and
     * the claude-code desktop-app caveat) instead of just the raw error.
     */
    authGuidance?: {
      loginCommandHint: string;
      showClaudeDesktopNote: boolean;
    } | null;
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
    /** Callback to cancel the stalled turn and re-send the last input (monorepo#3402) */
    onStalledRetry?: () => void;
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
    authGuidance = null,
    modelUnavailable = null,
    statusEvents = [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    streamingStartTime = null,
    hasPendingPermission = false,
    onRetry,
    onRetryWithModel,
    onStop,
    onStalledRetry,
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
  // Daemon-reported mid-turn stall (monorepo#3402): only meaningful while the
  // turn is still active — turn end/failure clears statusEvents or flips
  // status away from 'normal', so the stalled row can never outlive the turn.
  let stalledEvent = $derived(
    status === 'normal' && (isStreaming || isProcessing) && !hasPendingPermission
      ? getActiveStalledEvent(statusEvents, lastChunkTime)
      : null,
  );
  let thinkingVisible = $derived(
    status === 'normal' && (isStreaming || isProcessing) && !hasPendingPermission && !stalledEvent,
  );
  // Skips stalled events: an active stall has its own row, and a superseded
  // one must not leak its stale message into the returning thinking indicator.
  let latestStatusEvent = $derived(getLatestThinkingStatusEvent(statusEvents));
  let markVariant = $derived(getStatusMarkVariant(latestStatusEvent?.phase));

  let nowMs = $state(Date.now());
  let elapsedInterval: ReturnType<typeof setInterval> | undefined;

  function clearElapsedInterval() {
    if (elapsedInterval === undefined) return;
    clearInterval(elapsedInterval);
    elapsedInterval = undefined;
  }

  $effect(() => {
    if ((!thinkingVisible || !latestStatusEvent) && !stalledEvent) {
      clearElapsedInterval();
      return;
    }
    nowMs = Date.now();
    clearElapsedInterval();
    elapsedInterval = setInterval(() => (nowMs = Date.now()), 1_000);
    return clearElapsedInterval;
  });

  onDestroy(clearElapsedInterval);

  let elapsedTime = $derived(
    latestStatusEvent
      ? m.chat_streamingStatus_elapsedAgo_label({
          duration: formatElapsed(nowMs - latestStatusEvent.timestamp),
        })
      : null,
  );

  // Live "No model activity for N" copy. The daemon emits the stalled event
  // only after measuring `silentMs` of silence, so anchor at
  // `timestamp - silentMs` to reflect the actual silence duration rather
  // than starting the counter at the emission time.
  let stalledElapsed = $derived(
    stalledEvent
      ? formatElapsed(nowMs - (stalledEvent.timestamp - (stalledEvent.silentMs ?? 0)))
      : null,
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
  let errorExpanded = $state(false);
  let errorCopied = $state(false);

  async function handleCopyError() {
    if (!errorDisplay) return;
    const fullError = [errorDisplay.title, errorDisplay.message, errorDisplay.detail]
      .filter(Boolean)
      .join('\n\n');
    await navigator.clipboard.writeText(fullError);
    errorCopied = true;
    setTimeout(() => (errorCopied = false), 2000);
  }
</script>

<StreamingTypingIndicator
  visible={thinkingVisible}
  message={statusMessage}
  lifecycleMessage={latestStatusEvent?.message}
  elapsed={elapsedTime}
  variant={markVariant}
  {seed}
  class="mt-2 {className}"
/>

{#if stalledEvent}
  <div
    data-stream-stalled="true"
    class={cn(
      'type-caption mt-2 flex items-center gap-2 rounded-md border border-warning/20 bg-warning/5 py-2 pl-2 pr-1',
      className,
    )}
    in:safeFade={{ duration: 200, easing: cubicOut }}
    out:safeFade={{ duration: 150, easing: cubicOut }}
  >
    <!-- Static live announcement: announced once when the stall appears. The
         visible label ticks every second and must stay out of the live region
         so assistive tech doesn't re-announce it for the entire stall. -->
    <span role="status" class="sr-only" data-testid="stalled-announcement"
      >{m.chat_streamingStatus_stalledAnnouncement_label()}</span
    >
    <Fa icon={faExclamationTriangle} class="shrink-0 text-warning/70" />
    <span class="min-w-0 flex-1 truncate text-warning" data-testid="stalled-message"
      >{m.chat_streamingStatus_stalled_label({ duration: stalledElapsed ?? '' })}</span
    >
    {#if onStalledRetry}
      <Button
        variant="ghost-light"
        size="sm"
        onclick={onStalledRetry}
        class="type-caption h-7 shrink-0 gap-1.5 px-2 text-muted-foreground"
        data-testid="stalled-retry"
      >
        <Fa icon={faRotateRight} class="size-3" />
        {m.chat_streamingStatus_stalledRetry_label()}
      </Button>
    {/if}
    {#if onStop}
      <Button
        variant="ghost-light"
        size="sm"
        onclick={onStop}
        class="type-caption h-7 shrink-0 gap-1.5 px-2 text-muted-foreground"
        data-testid="stalled-cancel"
      >
        <Fa icon={faStop} class="size-3" />
        {m.chat_streamingStatus_stalledCancel_label()}
      </Button>
    {/if}
  </div>
{/if}

{#if visible}
  {#if status !== 'normal'}
    <div
      role={status === 'error' ? 'alert' : undefined}
      aria-live={status === 'error' ? 'assertive' : undefined}
      data-stream-terminal-error="true"
      class={cn(
        'type-caption flex flex-col gap-0 py-2 pr-1',
        status === 'error' && 'mt-2',
        status === 'model-unavailable' &&
          'rounded-md border border-warning/20 bg-warning/5 pl-2 pr-3',
        className,
      )}
      in:safeFade={{ duration: 200, easing: cubicOut }}
      out:safeFade={{ duration: 150, easing: cubicOut }}
    >
      <div class="flex items-start gap-2">
        <div class="flex min-w-0 flex-1 items-start gap-2">
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
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="font-medium text-danger" data-testid="error-title"
                >{errorDisplay.title}{#if failedAt}
                  <span
                    class="type-caption ml-1.5 leading-4 font-normal text-muted-foreground"
                    data-testid="error-failed-at"
                  >
                    <RelativeTime date={failedAt} />
                  </span>
                {/if}</span
              >
              <div
                class="relative grid min-h-5 w-full min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-1.5 py-0"
              >
                <Button
                  variant="ghost-light"
                  size="icon-sm"
                  onclick={handleCopyError}
                  iconOnly
                  tooltip={m.error_boundary_copyDetails_tooltip()}
                  aria-label={m.error_boundary_copyDetails_tooltip()}
                  class="absolute top-3 left-0 -translate-y-1/2 text-muted-foreground"
                >
                  <Fa icon={errorCopied ? faCheck : faCopy} class="shrink-0" />
                </Button>
                <div class="col-start-2 flex min-w-0 flex-col">
                  <Button
                    variant="plain"
                    class="type-caption h-auto! min-w-0 max-w-full justify-start text-left leading-4 text-muted-foreground"
                    onclick={() => (errorExpanded = !errorExpanded)}
                    aria-expanded={errorExpanded}
                  >
                    <span
                      class={cn(
                        'block min-w-0 max-w-full text-left',
                        errorExpanded ? 'whitespace-pre-wrap break-words' : 'truncate',
                      )}
                      data-testid="error-message">{errorDisplay.message}</span
                    >
                  </Button>
                  {#if errorDisplay.detail && errorExpanded}
                    <span
                      class="type-caption leading-4 whitespace-pre-wrap break-words text-muted-foreground"
                      data-testid="error-detail">{errorDisplay.detail}</span
                    >
                  {/if}
                  {#if authGuidance}
                    <div class="mt-1.5 flex flex-col gap-1" data-testid="error-auth-guidance">
                      <span class="type-caption leading-4 text-muted-foreground"
                        >{m.settings_providers_runToLogIn_label()}</span
                      >
                      <div class="flex items-center gap-1">
                        <code
                          class="rounded bg-muted px-1.5 py-0.5 text-ui"
                          data-testid="error-auth-login-command"
                          >{authGuidance.loginCommandHint}</code
                        >
                        <CopyButton text={authGuidance.loginCommandHint} size="xs" />
                      </div>
                      {#if authGuidance.showClaudeDesktopNote}
                        <span
                          class="type-caption leading-4 text-muted-foreground"
                          data-testid="error-auth-claude-desktop-note"
                          >{m.settings_providers_claudeDesktopNote_label()}</span
                        >
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
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
              variant="ghost-light"
              size="icon-xs"
              onclick={onRetry}
              iconOnly
              tooltip={m.chat_streamingStatus_tryAgain_label()}
              aria-label={m.chat_streamingStatus_tryAgain_label()}
              class="shrink-0 text-muted-foreground"
            >
              <Fa icon={faRotateRight} class="size-3" />
            </Button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
{/if}
