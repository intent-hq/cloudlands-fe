<script lang="ts">
  import TokensByHourCard from './TokensByHourCard.svelte';
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
</script>

<div>
  <TokensByHourCard {data} mode="month" label="SEP 2026" />
</div>
