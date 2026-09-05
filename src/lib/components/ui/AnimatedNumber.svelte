<script lang="ts">
  import { spring, tweenedValue, type SpringTierName } from '$lib/motion';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    value: number;
    tier?: SpringTierName;
    format?: (n: number) => string;
    class?: string;
  }

  let {
    value,
    tier = 'slow',
    format = (n: number) => formatInteger(n),
    class: className = '',
  }: Props = $props();

  // Track direction for animation styling
  let direction: 'up' | 'down' | null = $state(null);
  // Intentional initial capture; the $effect below tracks subsequent changes.
  // svelte-ignore state_referenced_locally
  let previousValue = $state(value);

  // Create tweened store for smooth interpolation. Initial value and duration
  // are intentionally captured at init; the $effect drives later updates.
  // svelte-ignore state_referenced_locally
  const displayValue = tweenedValue(value, tier);

  // Update the tweened value and track direction when value changes
  $effect(() => {
    if (value !== previousValue) {
      direction = value > previousValue ? 'up' : 'down';
      previousValue = value;
      displayValue.set(value);

      // Clear direction after animation completes
      const timeout = setTimeout(() => {
        direction = null;
      }, spring[tier].settleMs);

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
    transition: transform var(--spring-moderate) var(--spring-moderate-ease);
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
</style>
