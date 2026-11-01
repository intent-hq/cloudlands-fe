<!-- Fixture for ct-settle.ct.spec.ts: regions that move after a click, some only after a delay. -->
<script lang="ts">
  let {
    startDelayMs = 0,
    durationMs = 300,
  }: {
    /** How long after a click the motion starts (models a deferred layout read). */
    startDelayMs?: number;
    durationMs?: number;
  } = $props();

  const OPEN_HEIGHT = 120;
  const SCROLL_TARGET = 600;

  let jsExpanded = $state(false);
  let jsHeight = $state(0);
  let cssExpanded = $state(false);
  let scroller: HTMLDivElement;
  let wobbling = $state(false);
  let nextClicks = $state(0);

  // Animate `from` → `to` over `durationMs` after `startDelayMs`, writing each frame.
  function tween(from: number, to: number, write: (value: number) => void) {
    setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        write(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, startDelayMs);
  }

  function toggleJs() {
    jsExpanded = !jsExpanded;
    tween(jsHeight, jsExpanded ? OPEN_HEIGHT : 0, (value) => (jsHeight = value));
  }

  function scrollDown() {
    tween(scroller.scrollTop, SCROLL_TARGET, (value) => (scroller.scrollTop = value));
  }

  function wobble() {
    wobbling = true;
    const region = document.querySelector<HTMLElement>('[data-testid="wobble-region"]')!;
    const step = (now: number) => {
      if (!wobbling) return;
      region.style.width = `${100 + Math.round(20 * Math.sin(now / 50))}px`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  $effect(() => () => (wobbling = false));
</script>

<button type="button" data-testid="js-toggle" aria-expanded={jsExpanded} onclick={toggleJs}>
  JS toggle
</button>
<div data-testid="js-region" style="overflow: clip; height: {jsHeight}px;">
  <div class="spinner" data-testid="spinner"></div>
  <div style="height: {OPEN_HEIGHT}px;">JS content</div>
</div>

<button
  type="button"
  data-testid="css-toggle"
  aria-expanded={cssExpanded}
  onclick={() => (cssExpanded = !cssExpanded)}
>
  CSS toggle
</button>
<div
  class="css-region"
  data-testid="css-region"
  data-expanded={cssExpanded}
  style="transition-duration: {durationMs}ms; transition-delay: {startDelayMs}ms;"
>
  <div style="height: {OPEN_HEIGHT}px;">CSS content</div>
</div>

<button type="button" data-testid="next" data-clicks={nextClicks} onclick={() => nextClicks++}>
  Next
</button>
<button type="button" data-testid="noop">No-op</button>
<button type="button" data-testid="scroll-down" onclick={scrollDown}>Scroll down</button>
<button type="button" data-testid="wobble" onclick={wobble}>Wobble</button>

<div bind:this={scroller} data-testid="scroller" style="height: 100px; overflow: auto;">
  <div style="height: 2000px;"></div>
</div>
<div data-testid="wobble-region" style="width: 100px; height: 20px;"></div>

<style>
  .css-region {
    overflow: clip;
    height: 0;
    transition-property: height;
    transition-timing-function: ease-out;
  }
  .css-region[data-expanded='true'] {
    height: 120px;
  }
  .spinner {
    width: 8px;
    height: 8px;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
