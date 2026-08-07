<script lang="ts">
  /**
   * TOKEN BURN panel (mock lines 224-233) — the 24h token total from the
   * `stats.getUsage` rollup on line 1, and on line 2 the "TOK · 24H" label
   * with the last-5-minute averaged per-minute burn and an up/down trend
   * arrow (PROTOCOL §5.39). The average + trend are derived in the hud slice
   * on each `stats.getRateHistory` poll; this panel only renders them.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
    selectHudBurnRatePerMin,
    selectHudBurnTrend,
    selectHudUsage,
  } from '$store/renderer/slices/hud/hud-selectors';

  const usage$ = selectHudUsage();
  const burnRate$ = selectHudBurnRatePerMin();
  const burnTrend$ = selectHudBurnTrend();

  const tokenTotal = $derived.by(() => {
    const totals = $usage$?.totals;
    if (!totals) return 0;
    return (
      totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens
    );
  });

  /** Last-5-minute averaged per-minute burn (rounded in the slice). */
  const perMinute = $derived($burnRate$);
  /** 'up' | 'down' | 'none' — drives the arrow glyph and the readout color. */
  const trend = $derived($burnTrend$);

  /** Mock's compact count (`2.4k`); digit-only, locale-neutral. */
  function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }
</script>

<section class="hud-burn-panel" data-testid="hud-token-burn-panel">
  <header class="hud-burn-header">
    <span class="hud-burn-title">{m.hud_tokenBurn_title()}</span>
    <span class="hud-burn-rule"></span>
  </header>
  <div class="hud-burn-body">
    <span class="hud-burn-total">{formatInteger(tokenTotal)}</span>
    <div class="hud-burn-meta">
      <span class="hud-burn-key">{m.hud_tokenBurn_session_label()}</span>
      <span class="hud-burn-spacer"></span>
      <span class="hud-burn-rate" class:up={trend === 'up'} class:down={trend === 'down'}>
        {#if trend === 'up'}<!-- i18n-ignore (trend arrow glyph) --><span
            class="hud-burn-arrow"
            data-testid="hud-burn-arrow">▲</span
          >{:else if trend === 'down'}<!-- i18n-ignore (trend arrow glyph) --><span
            class="hud-burn-arrow"
            data-testid="hud-burn-arrow">▼</span
          >{/if}<span class="hud-burn-rate-value"
          >{m.hud_tokenBurn_perMinute_label({ rate: compact(perMinute) })}</span
        >
      </span>
    </div>
  </div>
</section>

<style>
  .hud-burn-panel {
    border: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--card) / 0.75);
  }
  .hud-burn-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
  }
  .hud-burn-title {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .hud-burn-rule {
    flex: 1;
    height: 1px;
    background: hsl(var(--border) / 0.6);
  }
  .hud-burn-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
  }
  .hud-burn-total {
    font:
      500 30px 'JetBrains Mono',
      monospace;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .hud-burn-meta {
    display: flex;
    align-items: baseline;
    gap: 10px;
    /* Label + rate share their own row so "TOK · 24H" never wraps. */
    white-space: nowrap;
  }
  .hud-burn-key {
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-burn-spacer {
    flex: 1;
  }
  .hud-burn-rate {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    font:
      500 12px 'JetBrains Mono',
      monospace;
    /* Neutral/black by default (trend 'none' — no arrow); colored when the
       trend arrow shows. User themes may override via the tokens below. */
    color: hsl(var(--foreground));
  }
  .hud-burn-rate.up {
    color: hsl(var(--primary));
  }
  .hud-burn-rate.down {
    color: hsl(var(--destructive-foreground));
  }
  .hud-burn-arrow {
    /* Inherits the 12px rate size (above the a11y tiny-font threshold). */
    line-height: 1;
  }
</style>
