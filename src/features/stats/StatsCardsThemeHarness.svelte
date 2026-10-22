<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { UsageStatsResult } from '$lib/client/app-client';
  import AgentPassportCard from './AgentPassportCard.svelte';
  import ModelsCard from './ModelsCard.svelte';
  import ProvidersCard from './ProvidersCard.svelte';
  import TokensByHourCard from './TokensByHourCard.svelte';
  import TokensByMonthCard from './TokensByMonthCard.svelte';
  import { exportCardPng, type StatsCardName } from './stats-export';

  let { card }: { card: StatsCardName } = $props();
  const counters = (n: number) => ({
    inputTokens: n * 500,
    outputTokens: n * 200,
    cacheReadTokens: n * 150,
    cacheCreationTokens: n * 50,
    thoughtTokens: n * 100,
  });
  const data: UsageStatsResult = {
    totals: counters(10),
    runs: 24,
    sessions: 8,
    longestRunMs: 120_000,
    linesAdded: 100,
    linesDeleted: 20,
    byModel: ['Opus', 'GPT', 'Sonnet', 'Gemini'].map((model, i) => ({
      model,
      runs: 6,
      ...counters(4 - i),
    })),
    byProvider: ['claude-code', 'codex', 'gemini', 'unknown'].map((provider, i) => ({
      provider,
      runs: 6,
      ...counters(4 - i),
    })),
    byHourOfDay: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      ...counters(hour >= 9 && hour < 19 ? 1 : 0),
    })),
    byMonth: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      ...counters(i < 4 ? i + 1 : 0),
    })),
    availablePeriods: { months: ['2025-04'], years: ['2025'] },
  };
  let host: HTMLDivElement;
</script>

<div bind:this={host}>
  {#if card === 'passport'}
    <AgentPassportCard {data} label="2025" />
  {:else if card === 'models'}
    <ModelsCard {data} label="2025" />
  {:else if card === 'providers'}
    <ProvidersCard {data} label="2025" />
  {:else if card === 'by-hour'}
    <TokensByHourCard {data} mode="year" label="2025" />
  {:else}
    <TokensByMonthCard {data} yearKey="2025" />
  {/if}
</div>
<Button onclick={() => exportCardPng(host.querySelector('[data-stats-card]')!, `${card}.png`)}>
  Export test card
</Button>
