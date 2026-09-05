<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    seed?: string;
    size?: number;
    gap?: number;
    class?: string;
  }

  const semanticColorOrders = [
    ['hsl(var(--primary))', 'hsl(var(--info))', 'hsl(var(--muted-foreground))'],
    ['hsl(var(--primary))', 'hsl(var(--muted-foreground))', 'hsl(var(--info))'],
    ['hsl(var(--info))', 'hsl(var(--primary))', 'hsl(var(--muted-foreground))'],
    ['hsl(var(--info))', 'hsl(var(--muted-foreground))', 'hsl(var(--primary))'],
    ['hsl(var(--muted-foreground))', 'hsl(var(--primary))', 'hsl(var(--info))'],
    ['hsl(var(--muted-foreground))', 'hsl(var(--info))', 'hsl(var(--primary))'],
  ] as const;

  function seedScore(value: string): number {
    return Array.from(value).reduce(
      (score, character, index) => score + (character.codePointAt(0) ?? 0) * (index + 1),
      0,
    );
  }

  let { seed = 'auggie-spinner', size = 6, gap = 0, class: className = '' }: Props = $props();

  let seedColors = $derived(semanticColorOrders[seedScore(seed) % semanticColorOrders.length]);
</script>

<div
  data-slot="spinner"
  class="spinner-container inline-flex items-center text-muted-foreground {className}"
  style="--spinner-size: {size}px; --spinner-gap: {gap}px; --spinner-color-1: {seedColors[0]}; --spinner-color-2: {seedColors[1]}; --spinner-color-3: {seedColors[2]};"
  role="status"
  aria-label={m.ui_spinner_loading_ariaLabel()}
  data-variant="pulse"
  data-seed={seed}
>
  <span class="spinner-track" aria-hidden="true">
    <span class="spinner-tile spinner-tile-primary"></span>
    <span class="spinner-tile spinner-tile-info"></span>
    <span class="spinner-tile spinner-tile-muted"></span>
  </span>
</div>

<style>
  .spinner-container {
    --spinner-duration: calc(var(--spring-slow) * 4);
  }

  .spinner-track {
    display: inline-flex;
    align-items: center;
    gap: var(--spinner-gap);
  }

  .spinner-tile {
    width: var(--spinner-size);
    height: var(--spinner-size);
    animation-name: spinner-pulse;
    animation-duration: var(--spinner-duration);
    animation-timing-function: step-start;
    animation-iteration-count: infinite;
  }

  .spinner-tile-primary {
    color: var(--spinner-color-1);
    background: var(--spinner-color-1);
  }

  .spinner-tile-info {
    color: var(--spinner-color-2);
    background: var(--spinner-color-2);
    animation-delay: var(--spring-moderate);
  }

  .spinner-tile-muted {
    color: var(--spinner-color-3);
    background: var(--spinner-color-3);
    animation-delay: calc(var(--spring-moderate) * 2);
  }

  @keyframes spinner-pulse {
    0%,
    50%,
    100% {
      filter: brightness(1);
      transform: scale(1);
    }
    25% {
      filter: brightness(1.2);
      transform: scaleY(2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner-tile {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }
</style>
