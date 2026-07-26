<script lang="ts">
  /**
   * Agent Passport card (design card 1, 360×640).
   *
   * Pixel recreation of `Agent Stats Share.dc.html` card 1 with the design's
   * in/out row extended to all 4 separate token counters (Spec D6). Every
   * number comes from the fetched `stats.getUsage` result; `null` (not yet
   * loaded) and zero-data periods render the same zeroed layout.
   */
  import Logo from '$lib/components/Logo.svelte';
  import type { UsageStatsResult } from '$lib/client/app-client';
  import { formatDuration, formatInt, formatTokens, totalTokens } from './stats-format';

  let { data, label }: { data: UsageStatsResult | null; label: string } = $props();

  const totals = $derived(
    data?.totals ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
  const topModel = $derived(data?.byModel[0]?.model ?? '—');
</script>

<div class="card" data-stats-card="passport">
  <div class="head">
    <div class="head-brand">
      <Logo width={26} />
      <span class="head-title">AGENT PASSPORT</span>
    </div>
    <span class="head-label">{label}</span>
  </div>
  <div class="rule"></div>
  <div class="hero">
    <div class="hero-label">TOKENS PROCESSED</div>
    <div class="hero-value">{formatTokens(totalTokens(totals))}</div>
    <div class="counters">
      <span class="counter-in">↓ {formatTokens(totals.inputTokens)} in</span>
      <span class="counter-out">↑ {formatTokens(totals.outputTokens)} out</span>
      <span class="counter-cread">⇣ {formatTokens(totals.cacheReadTokens)} cache read</span>
      <span class="counter-cwrite">⇡ {formatTokens(totals.cacheCreationTokens)} cache write</span>
    </div>
  </div>
  <div class="grid">
    <div>
      <div class="stat-label">AGENT RUNS</div>
      <div class="stat-big">{formatInt(data?.runs ?? 0)}</div>
    </div>
    <div>
      <div class="stat-label">SESSIONS</div>
      <div class="stat-big">{formatInt(data?.sessions ?? 0)}</div>
    </div>
    <div>
      <div class="stat-label">TOP MODEL</div>
      <div class="stat-small stat-clip">{topModel}</div>
    </div>
    <div>
      <div class="stat-label">LONGEST RUN</div>
      <div class="stat-small">{formatDuration(data?.longestRunMs ?? 0)}</div>
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
    margin: 0 0 5px;
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
    font-family: 'JetBrains Mono', monospace;
    font-size: 53px;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .counters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 17px;
    margin-top: 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    white-space: nowrap;
  }
  .counter-in {
    color: hsl(160 84% 39%);
  }
  .counter-out {
    color: hsl(257 9% 72%);
  }
  .counter-cread {
    color: hsl(158 35% 62%);
  }
  .counter-cwrite {
    color: hsl(240 5% 58%);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 17px 14px;
    padding: 22px 24px;
    margin-top: 7px;
  }
  .stat-label {
    font-size: 11px;
    letter-spacing: 0.14em;
    color: hsl(240 5% 40%);
  }
  .stat-big {
    font-family: 'JetBrains Mono', monospace;
    font-size: 23px;
    margin-top: 4px;
  }
  .stat-small {
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    margin-top: 6px;
  }
  .stat-clip {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
