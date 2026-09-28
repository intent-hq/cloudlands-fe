<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import TokensByHourCard from './TokensByHourCard.svelte';
  import { exportCardPng } from './stats-export';
  import type { UsageStatsResult } from '$lib/client/app-client';

  const data: UsageStatsResult = {
    totals: { inputTokens: 200, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    runs: 2,
    sessions: 1,
    longestRunMs: 0,
    linesAdded: 0,
    linesDeleted: 0,
    byModel: [],
    byProvider: [],
    byMonth: [],
    availablePeriods: { months: [], years: [] },
    byHourOfDay: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      inputTokens: hour === 9 || hour === 17 ? 100 : 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })),
  };
  let host: HTMLDivElement;
</script>

<div bind:this={host}>
  <TokensByHourCard {data} mode="month" label="SEP 2026" />
</div>
<Button onclick={() => exportCardPng(host.querySelector('[data-stats-card]')!, 'hours.png')}>
  Export test card
</Button>
