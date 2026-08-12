<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  type Variant = 'wave' | 'stair' | 'snake' | 'shuffle' | 'pulse';

  interface Props {
    seed?: string;
    size?: number;
    gap?: number;
    variant?: Variant;
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

  let {
    seed = 'auggie-spinner',
    size = 6,
    gap = 0,
    variant = 'wave',
    class: className = '',
  }: Props = $props();

  let seedColors = $derived(semanticColorOrders[seedScore(seed) % semanticColorOrders.length]);
</script>

<div
  data-slot="spinner"
  class="spinner-container inline-flex items-center text-muted-foreground {className}"
  style="--spinner-size: {size}px; --spinner-gap: {gap}px; --spinner-color-1: {seedColors[0]}; --spinner-color-2: {seedColors[1]}; --spinner-color-3: {seedColors[2]}; --spinner-animation-name: spinner-{variant};"
  role="status"
  aria-label={m.ui_spinner_loading_ariaLabel()}
  data-variant={variant}
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
    --spinner-duration: calc(var(--motion-slow) * 4);
  }

  .spinner-track {
    display: inline-flex;
    align-items: center;
    gap: var(--spinner-gap);
  }

  .spinner-tile {
    width: var(--spinner-size);
    height: var(--spinner-size);
    animation-name: var(--spinner-animation-name);
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
    animation-delay: var(--motion-standard);
  }

  .spinner-tile-muted {
    color: var(--spinner-color-3);
    background: var(--spinner-color-3);
    animation-delay: calc(var(--motion-standard) * 2);
  }

  [data-variant='snake'] .spinner-track {
    overflow: hidden;
  }

  [data-variant='snake'] .spinner-tile {
    animation-timing-function: steps(3, end);
  }

  [data-variant='shuffle'] .spinner-tile-primary {
    --spinner-shuffle-x: calc(var(--spinner-size) * 2);
  }

  [data-variant='shuffle'] .spinner-tile-info {
    --spinner-shuffle-x: calc(var(--spinner-size) * -1);
  }

  [data-variant='shuffle'] .spinner-tile-muted {
    --spinner-shuffle-x: calc(var(--spinner-size) * -1);
  }

  @keyframes spinner-wave {
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

  @keyframes spinner-stair {
    0%,
    70%,
    100% {
      transform: translateY(0);
    }
    20%,
    60% {
      transform: translateY(-100%);
    }
  }

  @keyframes spinner-snake {
    0%,
    25% {
      opacity: 0.55;
      transform: translateX(0);
    }
    60% {
      opacity: 1;
      transform: translateX(100%);
    }
    61% {
      opacity: 0;
      transform: translateX(-100%);
    }
    100% {
      opacity: 0.55;
      transform: translateX(0);
    }
  }

  @keyframes spinner-shuffle {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(var(--spinner-shuffle-x), -35%);
    }
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
