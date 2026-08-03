<script lang="ts">
  /**
   * AGENT ACTIVITY · TOK/S panel (mock lines 214-223) — 40-bar chart over the
   * trailing 200s of 5s token buckets (live `workspace:tokenUsage-changed`
   * deltas, backfilled from the per-minute `stats.getRateHistory` samples on
   * open), with the "−200S … {rate} TOK/S NOW" footer. A 1s ticker slides the
   * window so bars age out even while no tokens land.
   */
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { selectHudRate5s } from '$store/renderer/slices/hud/hud-selectors';
  import {
    HUD_RATE_5S_BAR_COUNT,
    HUD_RATE_5S_BUCKET_MS,
    toRate5sBucketStart,
  } from '$store/renderer/slices/hud/hud-slice';

  const rate5s$ = selectHudRate5s();

  let nowMs = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  /** Dense trailing window: one value per 5s slot, zeros where no bucket. */
  const bars = $derived.by(() => {
    const newestStart = toRate5sBucketStart(nowMs);
    const byStart = new Map($rate5s$.buckets.map((bucket) => [bucket.startMs, bucket.tokens]));
    return Array.from({ length: HUD_RATE_5S_BAR_COUNT }, (_, index) => {
      const startMs = newestStart - (HUD_RATE_5S_BAR_COUNT - 1 - index) * HUD_RATE_5S_BUCKET_MS;
      return { startMs, tokens: byStart.get(startMs) ?? 0 };
    });
  });

  const maxTokens = $derived(Math.max(1, ...bars.map((bar) => bar.tokens)));
  /** TOK/S NOW — the newest bucket's tokens over its 5s span. */
  const tokRate = $derived(Math.round(bars[bars.length - 1].tokens / 5));
</script>

<section class="hud-tokrate-panel" data-testid="hud-tokrate-panel">
  <header class="hud-tokrate-header">
    <span class="hud-tokrate-title">{m.hud_tokRate_title()}</span>
    <span class="hud-tokrate-rule"></span>
    <span class="hud-tokrate-window">{m.hud_tokRate_window_label()}</span>
  </header>
  <div class="hud-tokrate-chart">
    {#each bars as bar (bar.startMs)}
      <div
        class="hud-tokrate-bar"
        style:height={`${Math.round((bar.tokens / maxTokens) * 100)}%`}
      ></div>
    {/each}
  </div>
  <div class="hud-tokrate-footer">
    <span>{m.hud_tokRate_windowStart_label()}</span>
    <span class="hud-tokrate-spacer"></span>
    <span class="hud-tokrate-value">{formatInteger(tokRate)}</span>
    <span>{m.hud_tokRate_now_label()}</span>
  </div>
</section>

<style>
  .hud-tokrate-panel {
    border: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--card) / 0.75);
  }
  .hud-tokrate-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
  }
  .hud-tokrate-title {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .hud-tokrate-rule {
    flex: 1;
    height: 1px;
    background: hsl(var(--border) / 0.6);
  }
  .hud-tokrate-window {
    font:
      500 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-tokrate-chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 74px;
    padding: 10px 12px 6px;
  }
  .hud-tokrate-bar {
    flex: 1;
    min-height: 1px;
    background: hsl(var(--primary) / 0.65);
    transition: height 0.9s ease;
  }
  .hud-tokrate-footer {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 12px 10px;
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-tokrate-spacer {
    flex: 1;
  }
  .hud-tokrate-value {
    color: hsl(var(--primary));
    font-size: 14px;
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-tokrate-bar {
      transition: none;
    }
  }
</style>
