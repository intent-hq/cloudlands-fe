<script lang="ts">
  /**
   * Providers card (360×640, mirrors ModelsCard): share bar + ranked list of
   * the top 4 agent providers by total tokens with amount + %, and a MOST
   * USED callout. The wire carries raw provider ids; the rows pretty-print
   * them via `providerDisplayName` (pre-migration usage shows as "Unknown").
   * Degrades gracefully below 4 providers; a zero-data period renders an
   * empty state without NaN.
   */
  import Logo from '$lib/components/Logo.svelte';
  import type { UsageStatsResult } from '$lib/client/app-client';
  import {
    MODEL_BAR_COLORS,
    formatInt,
    formatShare,
    formatTokens,
    providerDisplayName,
    rankProviders,
  } from './stats-format';

  let { data, label }: { data: UsageStatsResult | null; label: string } = $props();

  // `byProvider` is validated at ingest (`LiveStatsClient` rejects a
  // stats.getUsage result missing it — PROTOCOL §5.36), so a wire mismatch
  // surfaces as the overlay's error state, never a render-path throw; empty
  // here means "not loaded yet" or a genuinely empty period.
  const ranked = $derived(data ? rankProviders(data.byProvider) : []);
  const top = $derived(ranked[0] ?? null);
</script>

<div class="card" data-stats-card="providers">
  <div class="head">
    <div class="head-brand">
      <Logo width={26} />
      <span class="head-title">PROVIDERS</span>
    </div>
    <span class="head-label">{label}</span>
  </div>
  <div class="rule"></div>
  <div class="body">
    <div class="bar">
      {#each ranked as p, i (p.provider)}
        <span
          class="bar-seg"
          style="width:{(p.share * 100).toFixed(1)}%;background:{MODEL_BAR_COLORS[
            i % MODEL_BAR_COLORS.length
          ]}"
        ></span>
      {:else}
        <span class="bar-seg bar-empty"></span>
      {/each}
    </div>
    <div class="list">
      {#each ranked as p, i (p.provider)}
        <div class="row" class:row-last={i === ranked.length - 1}>
          <span class="row-name">{providerDisplayName(p.provider)}</span>
          <span class="row-amt"
            >{formatTokens(p.tokens)} · <span class="row-pct">{formatShare(p.share)}</span></span
          >
        </div>
      {:else}
        <div class="row row-last row-empty">No provider usage in this period</div>
      {/each}
    </div>
    <div class="callout">
      <div class="callout-label">MOST USED</div>
      <div class="callout-provider">{top ? providerDisplayName(top.provider) : '—'}</div>
      <div class="callout-sub">
        {#if top}{formatTokens(top.tokens)} tokens · {formatInt(top.runs)} runs{:else}—{/if}
      </div>
    </div>
  </div>
  <div class="foot">
    <span class="foot-brand">Built with Intent</span>
    <span class="foot-url">intentapp.dev</span>
  </div>
</div>

<style>
  .card {
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
  .head-brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .head-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: hsl(240 5% 58%);
  }
  .head-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: hsl(240 5% 40%);
  }
  .rule {
    border-top: 1px dashed hsl(256 6% 26%);
  }
  .body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 19px;
  }
  .bar {
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    gap: 2px;
  }
  .bar-seg {
    display: block;
  }
  .bar-empty {
    width: 100%;
    background: hsl(240 12% 16%);
  }
  .list {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 14px 0;
    border-bottom: 1px solid hsl(256 6% 18%);
  }
  .row-last {
    border-bottom: none;
  }
  .row-name {
    font-size: 16px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 12px;
  }
  .row-amt {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    color: hsl(257 9% 72%);
    white-space: nowrap;
  }
  .row-pct {
    color: hsl(0 0% 97%);
  }
  .row-empty {
    font-size: 13px;
    color: hsl(240 5% 46%);
  }
  .callout {
    background: hsl(240 12% 12%);
    border: 1px solid hsl(256 6% 18%);
    border-radius: 10px;
    padding: 14px 17px;
  }
  .callout-label {
    font-size: 11px;
    letter-spacing: 0.14em;
    color: hsl(240 5% 40%);
  }
  .callout-provider {
    font-family: 'JetBrains Mono', monospace;
    font-size: 16px;
    margin-top: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .callout-sub {
    font-size: 13px;
    color: hsl(240 5% 58%);
    margin-top: 4px;
  }
  .foot {
    margin-top: auto;
    background: hsl(158 100% 30%);
    color: hsl(0 0% 100%);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 19px 24px 21px;
  }
  .foot-brand {
    font-size: 13px;
    opacity: 0.85;
  }
  .foot-url {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
  }
</style>
