<script lang="ts">
  import { onMount } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    value: number;
    duration?: number;
    format?: (n: number) => string;
    class?: string;
    accessible?: boolean;
    pulse?: boolean;
  }

  let {
    value,
    duration = 300,
    format = (n: number) => formatInteger(n),
    class: className = '',
    accessible = true,
    pulse = true,
  }: Props = $props();

  // Track direction for animation styling
  let direction: 'up' | 'down' | null = $state(null);
  // Non-reactive bookkeeping avoids restarting the effect when the target is recorded.
  // svelte-ignore state_referenced_locally
  let previousValue = value;
  let reducedMotion = $state(false);
  let animationRun = 0;

  // Create tweened store for smooth interpolation. Initial value and duration
  // are intentionally captured at init; the $effect drives later updates.
  // svelte-ignore state_referenced_locally
  const displayValue = tweened(value, {
    duration,
    easing: cubicOut,
  });

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = media.matches;
    const handleChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  });

  // Retarget from the current frame. Reduced motion always snaps to the target.
  $effect(() => {
    if (reducedMotion) {
      animationRun += 1;
      direction = null;
      previousValue = value;
      void displayValue.set(value, { duration: 0 });
      return;
    }

    if (value !== previousValue) {
      direction = value > previousValue ? 'up' : 'down';
      previousValue = value;
      const run = ++animationRun;
      void displayValue.set(value, { duration, easing: cubicOut }).then(() => {
        if (run === animationRun) direction = null;
      });

      return () => {
        animationRun += 1;
      };
    }
  });

  const formattedValue = $derived(format($displayValue));
  const targetValue = $derived(format(value));
</script>

<span
  class="animated-number {className}"
  class:animating-up={pulse && direction === 'up'}
  class:animating-down={pulse && direction === 'down'}
  data-pulse={pulse ? 'true' : 'false'}
>
  <span class="animated-number-value" aria-hidden={accessible ? 'true' : undefined}
    >{formattedValue}</span
  >
  {#if accessible}
    <span class="animated-number-target" aria-atomic="true">{targetValue}</span>
  {/if}
</span>

<style>
  .animated-number {
    display: inline-block;
    transition: transform 0.15s ease-out;
  }

  .animated-number-target {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .animating-up {
    animation: pulse-up 0.3s ease-out;
  }

  .animating-down {
    animation: pulse-down 0.3s ease-out;
  }

  @keyframes pulse-up {
    0% {
      transform: translateY(0);
    }
    30% {
      transform: translateY(-2px);
    }
    100% {
      transform: translateY(0);
    }
  }

  @keyframes pulse-down {
    0% {
      transform: translateY(0);
    }
    30% {
      transform: translateY(2px);
    }
    100% {
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .animated-number {
      animation: none !important;
      transform: none !important;
      transition: none;
    }
  }
</style>
