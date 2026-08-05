<script lang="ts">
  /**
   * Spinner - A clean loading indicator with three colored squares
   * Uses the same color generation as AuggieAvatar for consistent theming.
   */
  import { getRandomColorsWithSeed } from '$lib/components/ui/auggie-avatar/avatar-constants';
  import { m } from '$shared/paraglide/messages.js';

  type Variant = 'wave' | 'stair' | 'snake' | 'shuffle' | 'pulse';

  interface Props {
    /** Seed for deterministic color generation (like agent ID) */
    seed?: string;
    /** Size of each square in pixels */
    size?: number;
    /** Gap between squares in pixels */
    gap?: number;
    /** Animation variant */
    variant?: Variant;
    /** Additional CSS classes */
    class?: string;
  }

  let {
    seed = 'auggie-spinner',
    size = 6,
    gap = 0,
    variant = 'wave',
    class: className = '',
  }: Props = $props();

  // Get base color from seed
  let [color1, color2] = $derived(getRandomColorsWithSeed(seed));
</script>

<div
  class="spinner-container inline-flex items-center {className}"
  style="--size: {size}px; --gap: {gap}px; --color1: {color1}; --color2: {color2};"
  role="status"
  aria-label={m.ui_spinner_loading_ariaLabel()}
  data-variant={variant}
>
  <div class="spinner-track">
    <span class="sq sq-0"></span>
    <span class="sq sq-1"></span>
    <span class="sq sq-2"></span>
  </div>
</div>

<style>
  .spinner-container {
    --duration: 800ms;
    --delay: 200ms;
  }

  .spinner-track {
    display: flex;
    gap: var(--gap);
  }

  .sq {
    width: var(--size);
    height: var(--size);
  }

  .sq-0 {
    background-color: var(--color1);
  }
  .sq-1 {
    background-color: color-mix(in srgb, var(--color2) 90%, var(--color-muted-foreground) 10%);
  }
  .sq-2 {
    background-color: currentColor;
    opacity: 0.5;
  }

  /* ===== WAVE: bounce up then down ===== */
  [data-variant='wave'] .sq-0 {
    animation: wave var(--duration) step-start infinite;
  }
  [data-variant='wave'] .sq-1 {
    animation: wave var(--duration) step-start infinite;
    animation-delay: var(--delay);
  }
  [data-variant='wave'] .sq-2 {
    animation: wave var(--duration) step-start infinite;
    animation-delay: calc(var(--delay) * 2);
  }

  @keyframes wave {
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

  /* ===== STAIR: climb up one by one, drop together ===== */
  [data-variant='stair'] .sq-0 {
    animation: stair var(--duration) step-start infinite;
  }
  [data-variant='stair'] .sq-1 {
    animation: stair var(--duration) step-start infinite;
    animation-delay: var(--delay);
  }
  [data-variant='stair'] .sq-2 {
    animation: stair var(--duration) step-start infinite;
    animation-delay: calc(var(--delay) * 2);
  }

  @keyframes stair {
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

  /* ===== SNAKE: squares move right, wrap around like a snake ===== */
  [data-variant='snake'] .spinner-track {
    position: relative;
    width: calc(var(--size) * 3);
    overflow: hidden;
  }
  [data-variant='snake'] .sq {
    position: absolute;
    top: 0;
  }
  [data-variant='snake'] .sq-0 {
    left: 0;
    animation: snake0 var(--duration) step-start infinite;
  }
  [data-variant='snake'] .sq-1 {
    left: var(--size);
    animation: snake1 var(--duration) step-start infinite;
  }
  [data-variant='snake'] .sq-2 {
    left: calc(var(--size) * 2);
    animation: snake2 var(--duration) step-start infinite;
  }

  @keyframes snake0 {
    0%,
    25% {
      transform: translateX(0);
    }
    33%,
    58% {
      transform: translateX(var(--size));
    }
    66%,
    100% {
      transform: translateX(calc(var(--size) * 2));
    }
  }
  @keyframes snake1 {
    0%,
    25% {
      transform: translateX(0);
    }
    33%,
    58% {
      transform: translateX(var(--size));
    }
    66%,
    91% {
      transform: translateX(calc(var(--size) * -2));
      opacity: 0;
    }
    92%,
    100% {
      transform: translateX(calc(var(--size) * -1));
    }
  }
  @keyframes snake2 {
    0%,
    25% {
      transform: translateX(0);
      opacity: 0.5;
    }
    33%,
    58% {
      transform: translateX(calc(var(--size) * -2));
    }
    66%,
    100% {
      transform: translateX(calc(var(--size) * -1));
    }
  }

  /* ===== SHUFFLE: squares swap positions ===== */
  [data-variant='shuffle'] .spinner-track {
    position: relative;
    width: calc(var(--size) * 3);
  }
  [data-variant='shuffle'] .sq {
    position: absolute;
    top: 0;
  }
  [data-variant='shuffle'] .sq-0 {
    left: 0;
    animation: shuffle0 var(--duration) step-start infinite;
  }
  [data-variant='shuffle'] .sq-1 {
    left: var(--size);
    animation: shuffle1 var(--duration) step-start infinite;
  }
  [data-variant='shuffle'] .sq-2 {
    left: calc(var(--size) * 2);
    animation: shuffle2 var(--duration) step-start infinite;
  }

  @keyframes shuffle0 {
    0%,
    20% {
      transform: translate(0, 0);
    }
    25%,
    45% {
      transform: translate(var(--size), calc(var(--size) * -0.5));
    }
    50%,
    70% {
      transform: translate(calc(var(--size) * 2), 0);
    }
    75%,
    95% {
      transform: translate(var(--size), calc(var(--size) * 0.5));
    }
  }
  @keyframes shuffle1 {
    0%,
    20% {
      transform: translate(0, 0);
    }
    25%,
    45% {
      transform: translate(var(--size), calc(var(--size) * 0.5));
    }
    50%,
    70% {
      transform: translate(0, 0);
    }
    75%,
    95% {
      transform: translate(calc(var(--size) * -1), calc(var(--size) * -0.5));
    }
  }
  @keyframes shuffle2 {
    0%,
    20% {
      transform: translate(0, 0);
    }
    25%,
    45% {
      transform: translate(calc(var(--size) * -1), calc(var(--size) * -0.5));
    }
    50%,
    70% {
      transform: translate(calc(var(--size) * -2), 0);
    }
    75%,
    95% {
      transform: translate(calc(var(--size) * -1), calc(var(--size) * 0.5));
    }
  }

  /* ===== PULSE: grow/shrink together with color intensity ===== */
  [data-variant='pulse'] .sq-0 {
    transform-origin: bottom;
    animation: pulse var(--duration) step-start infinite;
  }
  [data-variant='pulse'] .sq-1 {
    transform-origin: bottom;
    animation: pulse var(--duration) step-start infinite;
    animation-delay: calc(var(--delay) * 1.5);
  }
  [data-variant='pulse'] .sq-2 {
    transform-origin: bottom;
    animation: pulse var(--duration) step-start infinite;
    animation-delay: calc(var(--delay) * 3);
  }

  @keyframes pulse {
    0%,
    50%,
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
    25% {
      transform: scaleY(2);
      filter: brightness(1.2);
    }
  }

  /* ===== Reduced motion ===== */
  @media (prefers-reduced-motion: reduce) {
    .sq-0,
    .sq-1,
    .sq-2 {
      animation: pulse-gentle 2s ease-in-out infinite !important;
    }
    .sq-1 {
      animation-delay: 300ms !important;
    }
    .sq-2 {
      animation-delay: 600ms !important;
    }

    @keyframes pulse-gentle {
      0%,
      100% {
        opacity: 0.3;
      }
      50% {
        opacity: 1;
      }
    }
  }
</style>
