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

  interface Props {
    visible?: boolean;
    message?: string;
    class?: string;
    /** Compact mode - shows only spinner without message */
    compact?: boolean;
    /** Seed for spinner colors (e.g., agent ID) */
    seed?: string;
  }

  let {
    visible = false,
    message = 'Thinking',
    class: className = '',
    compact = false,
    seed = 'default',
  }: Props = $props();

  let [color1, color2] = $derived(getAgentColorsWithSeed(seed));
</script>

{#if visible}
  <div
    class="flex min-h-5 items-center gap-1.5 py-0 text-muted-foreground type-body {className}"
    in:fade={{ duration: 200, easing: cubicOut }}
    out:fade={{ duration: 150, easing: cubicOut }}
  >
    <div
      class="legacy-streaming-spinner inline-flex h-5 w-4 min-w-4 shrink-0 items-center justify-center"
      style="--size: 3.5px; --gap: 1px; --color1: {color1}; --color2: {color2};"
      role="status"
      aria-label={m.ui_spinner_loading_ariaLabel()}
    >
      <span class="legacy-spinner-track" aria-hidden="true">
        <span class="legacy-spinner-square legacy-spinner-square-0"></span>
        <span class="legacy-spinner-square legacy-spinner-square-1"></span>
        <span class="legacy-spinner-square legacy-spinner-square-2"></span>
      </span>
    </div>

    <!-- Message text -->
    {#if !compact && message}
      <span class="font-normal text-muted-foreground" data-testid="streaming-status-thinking"
        >{message}</span
      >
    {/if}
  </div>
{/if}

<style>
  .legacy-streaming-spinner {
    --duration: 800ms;
    --delay: 200ms;
  }

  .legacy-spinner-track {
    display: flex;
    gap: var(--gap);
  }

  .legacy-spinner-square {
    width: var(--size);
    height: var(--size);
    animation: legacy-spinner-wave var(--duration) step-start infinite;
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
    50%,
    100% {
      transform: translateY(0);
    }
    25% {
      transform: translateY(-90%);
    }
    75% {
      transform: translateY(90%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .legacy-spinner-square {
      animation: none;
    }
  }
</style>
