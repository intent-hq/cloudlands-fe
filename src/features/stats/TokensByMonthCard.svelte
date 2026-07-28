<script lang="ts">
  /**
   * Tokens by Month card (design card 4, 360×640). Renders the 12 `byMonth`
   * cells of the selected year; hidden in 24H mode by the overlay shell
   * (Spec D11). All math lives in `stats-charts.ts`.
   */
  import Logo from '$lib/components/Logo.svelte';
  import type { UsageStatsResult } from '$lib/client/app-client';
  import { m } from '$shared/paraglide/messages.js';
  import { monthCardModel } from './stats-charts';

  let {
    data,
    yearKey,
    loading = false,
  }: {
    data: UsageStatsResult | null;
    /** "YYYY" of the selected period; drives the corner label + elapsed months. */
    yearKey: string;
    loading?: boolean;
  } = $props();

  function monthsElapsed(year: string, now = new Date()): number {
    const y = Number(year);
    if (!Number.isFinite(y) || y < now.getFullYear()) return 12;
    return y > now.getFullYear() ? 12 : now.getMonth() + 1;
  }

  const model = $derived(monthCardModel(data?.byMonth ?? [], monthsElapsed(yearKey)));
</script>

<div class="month-card" data-stats-card="by-month" data-loading={loading}>
  <div class="head">
    <div class="brand"><Logo width={26} /><span class="title">{m.stats_monthCard_title_label()}</span></div>
    <span class="corner mono">{yearKey}</span>
  </div>
  <div class="rule"></div>

  <div class="hero">
    <div class="hero-label">{model.heroLabel}</div>
    <div class="hero-value mono">{model.heroValue}</div>
    <div class="hero-sub mono">{model.avgSub}</div>
  </div>

  <div class="chart-block">
    <div class="legend">
      <span class="legend-item"><span class="swatch swatch-in"></span>{m.stats_card_legendInput_label()}</span>
      <span class="legend-item"><span class="swatch swatch-out"></span>{m.stats_card_legendOutput_label()}</span>
    </div>
    <div class="chart">
      {#each model.grid as line (line.label)}
        <div class="gridline" style:bottom="{line.bottomPct}%"></div>
        <span class="grid-label mono" style:bottom="calc({line.bottomPct}% - 5px)"
          >{line.label}</span
        >
      {/each}
      <span class="grid-label mono" style:bottom="-5px">0</span>
      <div class="bars">
        {#each model.bars as bar, i (i)}
          <span class="bar" style:height="{bar.heightPct}%">
            <span class="bar-out" class:seg-stub={!bar.active} style:height="{bar.outPct}%"></span>
            <span class="bar-in" class:bar-in-best={bar.best} class:seg-stub={!bar.active}></span>
          </span>
        {/each}
      </div>
    </div>
    <div class="axis mono">
      {#each model.bars as bar, i (i)}<span class:axis-best={bar.best}>{bar.letter}</span>{/each}
    </div>
  </div>

  <div class="stat-grid">
    <div>
      <div class="stat-label">{m.stats_monthCard_bestMonth_label()}</div>
      <div class="stat-value mono">{model.bestLabel}</div>
    </div>
    <div>
      <div class="stat-label">{model.deltaLabel}</div>
      <div class="stat-value stat-delta mono">{model.deltaValue}</div>
    </div>
  </div>

  <div class="footer-wrap">
    <div class="footer">
      <span class="footer-brand">{m.stats_card_builtWith_label()}</span>
      <!-- i18n-ignore (brand URL) -->
      <span class="footer-url mono">intentapp.dev</span>
    </div>
  </div>
</div>

<style>
  .month-card {
    width: 360px;
    height: 640px;
    background: hsl(250 11% 8%);
    border: 1px solid hsl(256 6% 24%);
    border-radius: 16px;
    color: hsl(0 0% 97%);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    box-sizing: border-box;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px 24px 17px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: hsl(240 5% 58%);
  }

  .corner {
    font-size: 12px;
    color: hsl(240 5% 40%);
  }

  .mono {
    font-family: 'JetBrains Mono', monospace;
  }

  .rule {
    border-top: 1px dashed hsl(256 6% 26%);
  }

  .hero {
    padding: 19px 24px 0;
  }

  .hero-label {
    font-size: 12px;
    letter-spacing: 0.14em;
    color: hsl(240 5% 58%);
    margin-bottom: 7px;
  }

  .hero-value {
    font-size: 53px;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1;
  }

  .hero-sub {
    margin-top: 12px;
    font-size: 14px;
    color: hsl(257 9% 72%);
  }

  .chart-block {
    padding: 24px 24px 0;
  }

  .legend {
    display: flex;
    justify-content: flex-end;
    gap: 14px;
    font-size: 11px;
    color: hsl(240 5% 58%);
    margin-bottom: 10px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  .swatch-in {
    background: hsl(240 12% 30%);
  }

  .swatch-out {
    background: hsl(158 100% 34%);
  }

  .chart {
    position: relative;
    height: 144px;
    margin-left: 40px;
    border-bottom: 1px solid hsl(256 6% 26%);
  }

  .gridline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid hsl(256 6% 18%);
  }

  .grid-label {
    position: absolute;
    left: -40px;
    font-size: 10px; /* a11y-ignore: 10px grid label per design handoff */
    color: hsl(240 5% 40%);
  }

  .bars {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    gap: 7px;
  }

  .bar {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-radius: 3px 3px 0 0;
    overflow: hidden;
  }

  .bar-out {
    background: hsl(158 100% 34%);
  }

  .bar-in {
    flex: 1;
    background: hsl(240 12% 30%);
  }

  .bar-in-best {
    background: hsl(240 12% 40%);
  }

  .seg-stub {
    background: hsl(240 12% 16%);
  }

  .axis {
    display: flex;
    margin-top: 7px;
    margin-left: 40px;
    font-size: 11px;
    color: hsl(240 5% 40%);
  }

  .axis span {
    flex: 1;
    text-align: center;
  }

  .axis-best {
    color: hsl(158 100% 38%);
  }

  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 17px 14px;
    padding: 22px 24px;
  }

  .stat-label {
    font-size: 11px;
    letter-spacing: 0.14em;
    color: hsl(240 5% 40%);
  }

  .stat-value {
    font-size: 15px;
    margin-top: 6px;
  }

  .stat-delta {
    color: hsl(160 84% 39%);
  }

  .footer-wrap {
    margin-top: auto;
  }

  .footer {
    background: hsl(158 100% 30%);
    color: hsl(0 0% 100%);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 19px 24px 21px;
  }

  .footer-brand {
    font-size: 13px;
    opacity: 0.85;
  }

  .footer-url {
    font-size: 13px;
  }
</style>
