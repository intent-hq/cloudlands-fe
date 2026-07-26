<script lang="ts">
  /**
   * Tokens by Hour card (design card 3, 360×640).
   *
   * Month/year: 24 local hours of day. 24H (Spec D11 addendum): the trailing
   * 24 hourly buckets in chronological order, labelled with local hours. All
   * math lives in `stats-charts.ts`. The WORKING HOURS window is adjustable
   * via hover arrows on the start/end numbers (Spec D15); the state is
   * component-local and resets to 09–18 whenever the overlay reopens.
   */
  import Logo from '$lib/components/Logo.svelte';
  import type { UsageStatsResult } from '$lib/client/app-client';
  import type { StatsMode } from './stats-period';
  import { DEFAULT_WORKING_HOURS, hourCardModel, pad2, stepHourWindow } from './stats-charts';

  let {
    data,
    mode,
    label,
    loading = false,
  }: {
    data: UsageStatsResult | null;
    mode: StatsMode;
    label: string;
    loading?: boolean;
  } = $props();

  // Adjustable WORKING HOURS window (Spec D15). Component-local only — never
  // persisted, so a fresh overlay open resets to the 09–18 default.
  let whStart = $state(DEFAULT_WORKING_HOURS.start);
  let whEnd = $state(DEFAULT_WORKING_HOURS.end);

  function stepBound(bound: 'start' | 'end', delta: number) {
    const next = stepHourWindow({ start: whStart, end: whEnd }, bound, delta);
    whStart = next.start;
    whEnd = next.end;
  }

  const model = $derived(
    hourCardModel(data?.byHourOfDay ?? [], mode === '24h' ? 'trailing-24h' : 'hour-of-day', {
      start: whStart,
      end: whEnd,
    }),
  );
</script>

<div class="hour-card" data-stats-card="by-hour" data-loading={loading}>
  <div class="head">
    <div class="brand"><Logo width={26} /><span class="title">TOKENS BY HOUR</span></div>
    <span class="corner mono">{label}</span>
  </div>
  <div class="rule"></div>

  <div class="hero">
    <div class="hero-label">PEAK HOUR</div>
    <div class="hero-value mono">{model.peakLabel}</div>
    <div class="hero-sub mono">{model.peakSub}</div>
  </div>

  <div class="chart-block">
    <div class="legend">
      <span class="legend-item"><span class="swatch swatch-in"></span>input</span>
      <span class="legend-item"><span class="swatch swatch-out"></span>output</span>
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
            <span class="bar-out" style:height="{bar.outPct}%"></span>
            <span class="bar-in" class:bar-in-peak={bar.peak}></span>
          </span>
        {/each}
      </div>
    </div>
    <div class="axis mono">
      {#each model.axis as tick, i (i)}<span>{tick}</span>{/each}
    </div>
  </div>

  <div class="stat-grid">
    <div>
      <div class="stat-label">WORKING HOURS</div>
      <div class="stat-value mono">
        {#snippet hourBound(bound: 'start' | 'end', value: number)}
          <!-- Hover-only stepper chrome: arrows are absolutely positioned
               (no layout shift) and visibility-gated on :hover, so they never
               appear in PNG exports (html-to-image serializes the non-hover
               computed styles). -->
          <span class="wh-bound"
            >{pad2(value)}<button
              class="wh-arrow wh-arrow-up"
              onclick={() => stepBound(bound, 1)}
              aria-label="Increase working hours {bound}">▲</button
            ><button
              class="wh-arrow wh-arrow-down"
              onclick={() => stepBound(bound, -1)}
              aria-label="Decrease working hours {bound}">▼</button
            ></span
          >
        {/snippet}
        {@render hourBound('start', whStart)}–{@render hourBound('end', whEnd)} · {model.workingHoursPct}%
      </div>
    </div>
    <div>
      <div class="stat-label">OVERNIGHT</div>
      <div class="stat-value mono">{model.overnight}</div>
    </div>
  </div>

  <div class="footer-wrap">
    <div class="footer">
      <span class="footer-brand">Built with Intent</span>
      <span class="footer-url mono">intentapp.dev</span>
    </div>
  </div>
</div>

<style>
  .hour-card {
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

  .mono {
    font-family: 'JetBrains Mono', monospace;
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
    gap: 4px;
  }

  .bar {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-radius: 2px 2px 0 0;
    overflow: hidden;
  }

  .bar-out {
    background: hsl(158 100% 34%);
  }

  .bar-in {
    flex: 1;
    background: hsl(240 12% 30%);
  }

  .bar-in-peak {
    background: hsl(240 12% 40%);
  }

  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 7px;
    margin-left: 40px;
    font-size: 11px;
    color: hsl(240 5% 40%);
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

  .wh-bound {
    position: relative;
    display: inline-block;
  }

  .wh-arrow {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    visibility: hidden;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 8px;
    line-height: 1;
    color: hsl(240 5% 58%);
  }

  .wh-arrow:hover {
    color: hsl(0 0% 97%);
  }

  .wh-arrow-up {
    bottom: 100%;
  }

  .wh-arrow-down {
    top: 100%;
  }

  .wh-bound:hover .wh-arrow {
    visibility: visible;
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
