<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    enabled?: boolean;
    pixelRatio?: 'native' | 0.5;
    frameRate?: 30 | 'display';
    durationMs?: number;
  }

  export const preview = definePreview<Props>({
    id: 'aurora-performance',
    title: 'Aura performance',
    defaultState: 'native-30',
    states: {
      'native-30': { props: {} },
      'half-30': { props: { pixelRatio: 0.5 } },
      'native-display': { props: { frameRate: 'display' } },
      'half-display': { props: { pixelRatio: 0.5, frameRate: 'display' } },
      off: { props: { enabled: false } },
    },
  });
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { formatNumber } from '$lib/i18n/format';
  import { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';
  import AuroraBackground from './AuroraBackground.svelte';
  import { summarizeAuroraFrames, type AuroraFrameSample } from './aurora-performance';

  let {
    enabled = true,
    pixelRatio = 'native',
    frameRate = 30,
    durationMs = 30000,
  }: Props = $props();
  let running = $state(false);
  let results = $state<string[]>([]);
  let stage: HTMLDivElement;
  let samples: AuroraFrameSample[] = [];
  let startedAt = 0;
  let initialDpr = 1;
  let initialBounds = { width: 0, height: 0 };
  let interruption = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seed = 420;

  function record(frame: AuroraFrameSample) {
    if (running) samples.push(frame);
  }

  function start() {
    samples = [];
    interruption =
      document.hidden ||
      !document.hasFocus() ||
      prefersReducedMotion() ||
      document.documentElement.hasAttribute('data-window-blurred');
    initialDpr = window.devicePixelRatio;
    const bounds = stage.getBoundingClientRect();
    initialBounds = { width: bounds.width, height: bounds.height };
    startedAt = performance.now();
    running = true;
    // A bounded DOM measurement session. No per-frame UI updates or polling.
    performance.mark('aura-benchmark-start');
    timer = setTimeout(finish, durationMs);
  }

  function finish() {
    if (!running) return;
    const elapsed = performance.now() - startedAt;
    running = false;
    clearTimeout(timer);
    performance.mark('aura-benchmark-end');
    performance.measure('aura-benchmark', 'aura-benchmark-start', 'aura-benchmark-end');
    const bounds = stage.getBoundingClientRect();
    const measurement = summarizeAuroraFrames(samples, elapsed);
    const interrupted = interruption || document.hidden || prefersReducedMotion();
    const resized =
      measurement.resized ||
      window.devicePixelRatio !== initialDpr ||
      bounds.width !== initialBounds.width ||
      bounds.height !== initialBounds.height;
    const report = {
      enabled,
      pixelRatio,
      frameRate,
      seed,
      hostDpr: initialDpr,
      cssSize: initialBounds,
      ...measurement,
      interrupted,
      resized,
      valid: !interrupted && !resized && (!enabled || measurement.draws > 0),
      // Export raw values for comparing runs; these are not GPU timer measurements.
      samples,
    };
    results = [JSON.stringify(report, null, 2), ...results].slice(0, 10);
  }

  onMount(() => {
    const interrupt = () => {
      if (running) interruption = true;
    };
    const visibility = () => {
      if (document.hidden) interrupt();
    };
    const observer = new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-window-blurred')) interrupt();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-window-blurred'],
    });
    const stopWatchingMotion = onReducedMotionChange((reduced) => {
      if (reduced) interrupt();
    });
    window.addEventListener('resize', interrupt);
    window.addEventListener('blur', interrupt);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      stopWatchingMotion();
      window.removeEventListener('resize', interrupt);
      window.removeEventListener('blur', interrupt);
      document.removeEventListener('visibilitychange', visibility);
    };
  });

  onDestroy(() => clearTimeout(timer));
</script>

<!-- i18n-ignore (developer-only performance fixture and measurement controls) -->
<section class="benchmark" data-testid="aura-benchmark">
  <header>
    <h1>Aura performance</h1>
    <p>
      One production aura, a fixed seed, and no chat or streaming content. Compare one setting at a
      time, then compare with Off. Half resolution caps the backing ratio at 0.5 backing pixels per
      CSS pixel; on a DPR 2 display it draws one sixteenth as many pixels as Native.
    </p>
  </header>

  <div class="controls">
    <span>Resolution</span>
    <Button
      variant="outline"
      disabled={running}
      active={!enabled}
      aria-pressed={!enabled}
      onclick={() => (enabled = false)}>Off</Button
    >
    <Button
      variant="outline"
      disabled={running}
      active={enabled && pixelRatio === 0.5}
      aria-pressed={enabled && pixelRatio === 0.5}
      onclick={() => {
        enabled = true;
        pixelRatio = 0.5;
      }}>Half (0.5×)</Button
    >
    <Button
      variant="outline"
      disabled={running}
      active={enabled && pixelRatio === 'native'}
      aria-pressed={enabled && pixelRatio === 'native'}
      onclick={() => {
        enabled = true;
        pixelRatio = 'native';
      }}>Native DPR</Button
    >
    <span>Frame limit</span>
    <Button
      variant="outline"
      disabled={running}
      active={frameRate === 30}
      aria-pressed={frameRate === 30}
      onclick={() => (frameRate = 30)}>30 fps</Button
    >
    <Button
      variant="outline"
      disabled={running}
      active={frameRate === 'display'}
      aria-pressed={frameRate === 'display'}
      onclick={() => (frameRate = 'display')}>Display refresh</Button
    >
  </div>

  <div class="stage" bind:this={stage} data-testid="aura-benchmark-stage">
    {#key `${enabled}-${pixelRatio}-${frameRate}`}
      {#if enabled}
        <AuroraBackground benchmark={{ pixelRatio, frameRate, seed, onDraw: record }} />
      {/if}
    {/key}
  </div>

  <div class="controls">
    <Button disabled={running} onclick={start}
      >Record {formatNumber(durationMs / 1000)} seconds</Button
    >
    <Button variant="outline" disabled={!running} onclick={finish}>Finish early</Button>
    <span role="status">{running ? 'Recording — keep this window focused.' : 'Ready'}</span>
  </div>
  <p>
    Use Motion: full in the sandbox toolbar. Let the aura warm up before recording. Results appear
    only when recording finishes. A run with no draws, a resize, or a focus interruption is invalid.
    Draw cadence and CPU submission time are not presented FPS or GPU execution time. Use the
    aura-benchmark trace interval and an OS GPU/power monitor for those comparisons. This uses the
    same current shader in both modes, not a copy of the alpha shader.
  </p>
  <p>
    For comparable traces use the same build, viewport, display, theme, and power settings.
    Alternate modes over several runs. This isolates aura cost; it does not measure streaming DOM
    work or establish battery-life impact.
  </p>
  {#each results as result, index}
    <details open={index === 0}>
      <summary>Measurement {formatNumber(results.length - index)}</summary>
      <a
        href={`data:application/json;charset=utf-8,${encodeURIComponent(result)}`}
        download="aura-measurement.json">Download JSON</a
      >
      <pre data-testid="aura-benchmark-result">{JSON.stringify(
          JSON.parse(result),
          (key, value) => (key === 'samples' ? undefined : value),
          2,
        )}</pre>
    </details>
  {/each}
</section>

<style>
  .benchmark {
    display: grid;
    gap: 1rem;
    width: 100%;
    min-width: 0;
    padding: 1.5rem;
    color: hsl(var(--foreground));
  }
  h1 {
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
  }
  p {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: 1.6;
  }
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .stage {
    width: 100%;
    height: 272px;
    overflow: hidden;
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
  }
  pre {
    overflow: auto;
    font-size: var(--text-caption-size);
  }
  a {
    color: hsl(var(--primary-ink));
    text-decoration: underline;
  }
</style>
