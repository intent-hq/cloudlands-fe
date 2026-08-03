<script lang="ts">
  /**
   * TOKEN BURN panel (mock lines 224-233) — 24h session token total from the
   * `stats.getUsage` rollup and the "▲ x/min" per-minute burn straight from
   * the latest `stats.getRateHistory` sample (PROTOCOL §5.39).
   */
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
    selectHudRateHistory,
    selectHudUsage,
  } from '$store/renderer/slices/hud/hud-selectors';

  const usage$ = selectHudUsage();
  const rateHistory$ = selectHudRateHistory();

  const tokenTotal = $derived.by(() => {
    const totals = $usage$?.totals;
    if (!totals) return 0;
    return (
      totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens
    );
  });

  /** Latest per-minute sample — the wire value, no re-derivation. */
  const perMinute = $derived.by(() => {
    const samples = $rateHistory$?.samples ?? [];
    return samples.length > 0 ? samples[samples.length - 1].tokens : 0;
  });

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
    <span class="hud-burn-key">{m.hud_tokenBurn_session_label()}</span>
    <span class="hud-burn-spacer"></span>
    <span class="hud-burn-rate">{m.hud_tokenBurn_perMinute_label({ rate: compact(perMinute) })}</span>
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
    align-items: baseline;
    gap: 10px;
    padding: 12px;
  }
  .hud-burn-total {
    font:
      500 30px 'JetBrains Mono',
      monospace;
    letter-spacing: -0.02em;
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
    font:
      500 12px 'JetBrains Mono',
      monospace;
    color: hsl(var(--primary));
  }
</style>
