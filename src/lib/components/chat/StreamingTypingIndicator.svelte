<!--
  StreamingTypingIndicator.svelte

  A polished, animated typing indicator for streaming messages.
  Features animated squares using the seeded agent color scheme.
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getAgentColorsWithSeed } from '$lib/utils/agent-colors';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CHAT_OPERATIONAL_LEADING_CLASS,
    CHAT_OPERATIONAL_ROW_CLASS,
    CHAT_OPERATIONAL_SUMMARY_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    visible?: boolean;
    message?: string;
    /** Localized lifecycle detail. It is visual context, not a repeated live announcement. */
    detailMessage?: string | null;
    class?: string;
    /** Compact mode - shows only spinner without message */
    compact?: boolean;
    /** Seed for spinner colors (e.g., agent ID) */
    seed?: string;
  }

  let {
    visible = false,
    message = m.chat_streamingStatus_thinking_label(),
    detailMessage = null,
    class: className = '',
    compact = false,
    seed = 'default',
  }: Props = $props();

  let [color1, color2] = $derived(getAgentColorsWithSeed(seed));
</script>

{#if visible}
  <div
    class="{CHAT_OPERATIONAL_ROW_CLASS} font-family-child font-normal text-muted-foreground {className}"
    data-streaming-typing-row
    role="status"
    aria-live="polite"
    aria-atomic="true"
    aria-label={message || m.ui_spinner_loading_ariaLabel()}
    in:fade={{ duration: 200, easing: cubicOut }}
    out:fade={{ duration: 150, easing: cubicOut }}
  >
    <div
      class="legacy-streaming-spinner {CHAT_OPERATIONAL_LEADING_CLASS}"
      style="--size: 3.5px; --gap: 1px; --color1: {color1}; --color2: {color2};"
      aria-hidden="true"
      data-operational-leading
    >
      <span class="legacy-spinner-track" aria-hidden="true">
        <span class="legacy-spinner-square legacy-spinner-square-0"></span>
        <span class="legacy-spinner-square legacy-spinner-square-1"></span>
        <span class="legacy-spinner-square legacy-spinner-square-2"></span>
      </span>
    </div>

    <!-- Message text -->
    {#if !compact && message}
      <span
        class="{CHAT_OPERATIONAL_SUMMARY_CLASS} flex items-baseline gap-1.5"
        data-operational-summary
        aria-hidden="true"
      >
        <span class="shrink-0 text-foreground" data-testid="streaming-status-thinking"
          >{message}</span
        >
        {#if detailMessage}
          <span
            class="min-w-0 flex-1 truncate text-muted-foreground"
            data-testid="streaming-status-lifecycle"
            title={detailMessage}>{detailMessage}</span
          >
        {/if}
      </span>
    {/if}
  </div>
{/if}

<style>
  .legacy-streaming-spinner {
    --duration: 960ms;
    --delay: 160ms;
  }

  .legacy-spinner-track {
    display: flex;
    gap: var(--gap);
  }

  .legacy-spinner-square {
    width: var(--size);
    height: var(--size);
    transform-origin: center;
    animation: legacy-spinner-wave var(--duration) ease-in-out infinite both;
    will-change: transform, opacity;
  }

  .legacy-spinner-square-0 {
    background-color: var(--color1);
  }

  .legacy-spinner-square-1 {
    background-color: color-mix(in srgb, var(--color2) 90%, var(--color-muted-foreground) 10%);
    animation-delay: var(--delay);
  }

  .legacy-spinner-square-2 {
    background-color: currentColor;
    opacity: 0.5;
    animation-delay: calc(var(--delay) * 2);
  }

  @keyframes legacy-spinner-wave {
    0%,
    100% {
      transform: translateY(1.5px) scale(0.72);
      opacity: 0.45;
    }
    50% {
      transform: translateY(-1.5px) scale(1);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .legacy-spinner-square {
      animation: none;
      transform: none;
      opacity: 1;
      will-change: auto;
    }

    .legacy-spinner-square-2 {
      opacity: 0.5;
    }
  }
</style>
