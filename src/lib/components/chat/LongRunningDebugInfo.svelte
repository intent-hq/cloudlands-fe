<!--
  LongRunningDebugInfo.svelte

  Shows debug information when an agent has been processing for >1 minute.
  Helps users understand what might be wrong and diagnose issues.
-->
<script lang="ts">
  import {
  onMount,
  onDestroy,
} from 'svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faInfoCircle,
  faChevronDown,
  faChevronUp,
} from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils/cn';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    /** When streaming/processing started (timestamp in ms) */
    streamingStartTime: number | null;
    /** Agent ID for context */
    agentId?: string;
    /** Session/backend session ID */
    sessionId?: string | null;
    /** Number of messages in the conversation */
    messageCount?: number;
    /** Current streaming content length */
    streamingContentLength?: number;
    /** Threshold in ms before showing debug info (default: 60000 = 1 minute) */
    threshold?: number;
    class?: string;
  }

  let {
    streamingStartTime,
    agentId,
    sessionId,
    messageCount = 0,
    streamingContentLength = 0,
    threshold = 60000, // 1 minute
    class: className = '',
  }: Props = $props();

  let elapsedSeconds = $state(0);
  let isExpanded = $state(false);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // Calculate elapsed time
  function updateElapsed() {
    if (streamingStartTime) {
      elapsedSeconds = Math.floor((Date.now() - streamingStartTime) / 1000);
    }
  }

  // Should we show the debug info?
  let shouldShow = $derived(
    streamingStartTime !== null && Date.now() - streamingStartTime >= threshold,
  );

  // Format elapsed time nicely
  let formattedTime = $derived.by(() => {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  });

  onMount(() => {
    updateElapsed();
    intervalId = setInterval(updateElapsed, 1000);
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });
</script>

{#if shouldShow}
  <div
    class={cn(
      'rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
      className,
    )}
    transition:slide={{ duration: 200 }}
  >
    <!-- Header - always visible -->
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-amber-500/10"
      onclick={() => (isExpanded = !isExpanded)}
    >
      <Fa icon={faInfoCircle} class="shrink-0" />
      <span class="flex-1">
        {m.chat_longRunningDebug_processingFor_before()}
        <strong>{formattedTime}</strong>
      </span>
      <Fa icon={isExpanded ? faChevronUp : faChevronDown} class="shrink-0 opacity-60" />
    </button>

    <!-- Expanded debug details -->
    {#if isExpanded}
      <div
        class="border-t border-amber-500/20 px-3 py-2 text-ui space-y-1.5"
        transition:slide={{ duration: 150 }}
      >
        <p class="text-amber-600/80 dark:text-amber-400/80">
          {m.chat_longRunningDebug_intro_label()}
        </p>

        <div class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
          <span class="text-amber-600/60 dark:text-amber-400/60"
            >{m.chat_longRunningDebug_agentId_label()}</span
          >
          <span class="truncate">{agentId || m.chat_longRunningDebug_notAvailable_fallback()}</span>

          <span class="text-amber-600/60 dark:text-amber-400/60"
            >{m.chat_longRunningDebug_sessionId_label()}</span
          >
          <span class="truncate">{sessionId || m.chat_longRunningDebug_notActivated_fallback()}</span>

          <span class="text-amber-600/60 dark:text-amber-400/60"
            >{m.chat_longRunningDebug_messages_label()}</span
          >
          <span>{formatInteger(messageCount)}</span>

          <span class="text-amber-600/60 dark:text-amber-400/60"
            >{m.chat_longRunningDebug_responseSize_label()}</span
          >
          <span
            >{streamingContentLength > 0
              ? m.chat_longRunningDebug_chars_label({
                  count: formatInteger(streamingContentLength),
                })
              : m.chat_longRunningDebug_noResponseYet_label()}</span
          >

          <span class="text-amber-600/60 dark:text-amber-400/60"
            >{m.chat_longRunningDebug_elapsed_label()}</span
          >
          <span>{formattedTime}</span>
        </div>

        <div class="pt-1.5 text-amber-600/70 dark:text-amber-400/70">
          <p class="font-medium mb-1">{m.chat_longRunningDebug_possibleCauses_label()}</p>
          <ul class="list-disc list-inside space-y-0.5 pl-1">
            {#if !sessionId}
              <li>{m.chat_longRunningDebug_causeNotActivated_label()}</li>
            {/if}
            {#if streamingContentLength === 0}
              <li>{m.chat_longRunningDebug_causeNoResponse_label()}</li>
            {:else}
              <li>{m.chat_longRunningDebug_causeComplexTask_label()}</li>
              <li>{m.chat_longRunningDebug_causeToolExecution_label()}</li>
            {/if}
            <li>{m.chat_longRunningDebug_tryStop_label()}</li>
          </ul>
        </div>
      </div>
    {/if}
  </div>
{/if}
