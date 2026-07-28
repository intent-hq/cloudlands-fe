<script lang="ts">
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    value: number;
    duration?: number;
    format?: (n: number) => string;
    class?: string;
  }

  let {
    value,
    duration = 300,
    format = (n: number) => formatInteger(n),
    class: className = '',
  }: Props = $props();

  // Track direction for animation styling
  let direction: 'up' | 'down' | null = $state(null);
  let previousValue = $state(value);

  // Create tweened store for smooth interpolation
  const displayValue = tweened(value, {
    duration,
    easing: cubicOut,
  });

  // Update the tweened value and track direction when value changes
  $effect(() => {
    if (value !== previousValue) {
      direction = value > previousValue ? 'up' : 'down';
      previousValue = value;
      displayValue.set(value);

      // Clear direction after animation completes
      const timeout = setTimeout(() => {
        direction = null;
      }, duration);

      return () => clearTimeout(timeout);
    }
  });

  const formattedValue = $derived(format($displayValue));
</script>

<span
  class="animated-number {className}"
  class:animating-up={direction === 'up'}
  class:animating-down={direction === 'down'}
>
  {formattedValue}
</span>

<style>
  .animated-number {
    display: inline-block;
    transition: transform 0.15s ease-out;
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
</style>
