<script lang="ts">
  /**
   * AGENT ACTIVITY · TOK/S panel (mock lines 214-223) — a bar per trailing
   * per-minute `stats.getRateHistory` sample (up to 40; the array already ends
   * at the current minute), normalized to the window's max. The peak Y-scale
   * label (top-right of the plot) and the "TOK/S NOW" footer both convert the
   * minute token counts to a per-second rate (÷60). The 15s history poll keeps
   * the samples fresh, so no client-side window sliding is needed.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { selectHudRateHistory } from '$store/renderer/slices/hud/hud-selectors';

  const rateHistory$ = selectHudRateHistory();

  /** Trailing minute samples (chronological); empty when no data yet. */
  const bars = $derived($rateHistory$?.samples ?? []);

  const maxTokens = $derived(Math.max(1, ...bars.map((bar) => bar.tokens)));
  /** Peak minute over the window, as a per-second rate (÷60); 0 when no data. */
  const peakRate = $derived(
    bars.length > 0 ? Math.round(Math.max(...bars.map((bar) => bar.tokens)) / 60) : 0,
  );
  /** TOK/S NOW — the newest minute sample's tokens over its 60s span. */
  const tokRate = $derived(bars.length > 0 ? Math.round(bars[bars.length - 1].tokens / 60) : 0);
</script>

<section class="hud-tokrate-panel" data-testid="hud-tokrate-panel">
  <header class="hud-tokrate-header">
    <span class="hud-tokrate-title">{m.hud_tokRate_title()}</span>
    <span class="hud-tokrate-rule"></span>
    <span class="hud-tokrate-window">{m.hud_tokRate_window_label()}</span>
  </header>
  <div class="hud-tokrate-chart">
    {#if bars.length > 0}
      <span class="hud-tokrate-peak">{m.hud_tokRate_peak_label({ rate: formatInteger(peakRate) })}</span>
    {/if}
    {#each bars as bar (bar.bucketUtc)}
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
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 74px;
    padding: 10px 12px 6px;
  }
  .hud-tokrate-peak {
    position: absolute;
    top: 4px;
    right: 12px;
    font:
      500 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
    pointer-events: none;
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
