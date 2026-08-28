<script lang="ts">
  import { onMount } from 'svelte';
  import { tweenedValue, type SpringTierName } from '$lib/motion';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    value: number;
    tier?: SpringTierName;
    format?: (n: number) => string;
    class?: string;
    accessible?: boolean;
    pulse?: boolean;
  }

  let {
    value,
    tier = 'slow',
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
  const displayValue = tweenedValue(value, tier);

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
      void displayValue.set(value);
      return;
    }

    if (value !== previousValue) {
      direction = value > previousValue ? 'up' : 'down';
      previousValue = value;
      const run = ++animationRun;
      void displayValue.set(value).then(() => {
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
    transition: transform var(--spring-moderate) var(--spring-moderate-ease);
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
    animation: pulse-up var(--motion-slow) var(--spring-slow-ease);
  }

  .animating-down {
    animation: pulse-down var(--motion-slow) var(--spring-slow-ease);
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
