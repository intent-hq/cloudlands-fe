<!--
  LongRunningDebugInfo.svelte

  Shows debug information when an agent has been processing for >1 minute.
  Helps users understand what might be wrong and diagnose issues.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faInfoCircle, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils/cn';

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
        Agent has been processing for <strong>{formattedTime}</strong>
      </span>
      <Fa icon={isExpanded ? faChevronUp : faChevronDown} class="shrink-0 opacity-60" />
    </button>

    <!-- Expanded debug details -->
    {#if isExpanded}
      <div
        class="border-t border-amber-500/20 px-3 py-2 text-[11px] space-y-1.5"
        transition:slide={{ duration: 150 }}
      >
        <p class="text-amber-600/80 dark:text-amber-400/80">
          If the agent appears stuck, here's some debug info:
        </p>

        <div class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
          <span class="text-amber-600/60 dark:text-amber-400/60">Agent ID:</span>
          <span class="truncate">{agentId || 'N/A'}</span>

          <span class="text-amber-600/60 dark:text-amber-400/60">Session ID:</span>
          <span class="truncate">{sessionId || 'Not activated'}</span>

          <span class="text-amber-600/60 dark:text-amber-400/60">Messages:</span>
          <span>{messageCount}</span>

          <span class="text-amber-600/60 dark:text-amber-400/60">Response size:</span>
          <span
            >{streamingContentLength > 0
              ? `${streamingContentLength} chars`
              : 'No response yet'}</span
          >

          <span class="text-amber-600/60 dark:text-amber-400/60">Elapsed:</span>
          <span>{formattedTime}</span>
        </div>

        <div class="pt-1.5 text-amber-600/70 dark:text-amber-400/70">
          <p class="font-medium mb-1">Possible causes:</p>
          <ul class="list-disc list-inside space-y-0.5 pl-1">
            {#if !sessionId}
              <li>Agent session not activated (backend may be unavailable)</li>
            {/if}
            {#if streamingContentLength === 0}
              <li>No response received (network issue or backend error)</li>
            {:else}
              <li>Agent is working on a complex task</li>
              <li>Waiting for tool execution to complete</li>
            {/if}
            <li>Try pressing Stop and sending your message again</li>
          </ul>
        </div>
      </div>
    {/if}
  </div>
{/if}
