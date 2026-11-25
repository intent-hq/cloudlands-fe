<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { UsageStatsResult } from '$lib/client/app-client';
  import AgentPassportCard from './AgentPassportCard.svelte';
  import ModelsCard from './ModelsCard.svelte';
  import ProvidersCard from './ProvidersCard.svelte';
  import TokensByHourCard from './TokensByHourCard.svelte';
  import TokensByMonthCard from './TokensByMonthCard.svelte';
  import CodeWrittenCard from './CodeWrittenCard.svelte';
  import ToolCallsCard from './ToolCallsCard.svelte';
  import AgentTeamCard from './AgentTeamCard.svelte';
  import ActivityStreakCard from './ActivityStreakCard.svelte';
  import { exportCardPng, type StatsCardName } from './stats-export';

  let {
    card,
    variant = 'typical',
  }: { card: StatsCardName; variant?: 'zero' | 'typical' | 'huge' } = $props();
  const scale = variant === 'zero' ? 0 : variant === 'huge' ? 1_234_567 : 1;
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
  const activity: UsageStatsResult = {
    ...data,
    runs: 24 * scale,
    sessions: 8 * scale,
    longestRunMs: 5_400_000 * Math.min(scale, 1),
    linesAdded: 4_200 * scale,
    linesDeleted: 1_300 * scale,
    toolCalls: 10 * scale,
    toolCallsFailed: scale,
    totalRunMs: 36_000_000 * scale,
    subAgentSessions: 5 * scale,
    activityTrackedSince: '2025-04-10',
    byDay:
      scale === 0
        ? []
        : Array.from({ length: 30 }, (_, i) => ({
            date: `2025-04-${String(i + 1).padStart(2, '0')}`,
            runs: i % 4 === 3 ? 0 : 2,
            ...counters(i % 4 === 3 ? 0 : (i % 5) + 1),
          })),
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
  {:else if card === 'by-month'}
    <TokensByMonthCard {data} yearKey="2025" />
  {:else if card === 'code'}
    <CodeWrittenCard data={activity} label="APR 2025" />
  {:else if card === 'tools'}
    <ToolCallsCard data={activity} label="APR 2025" mode="month" periodKey="2025-04" />
  {:else if card === 'team'}
    <AgentTeamCard data={activity} label="APR 2025" mode="month" periodKey="2025-04" />
  {:else}
    <ActivityStreakCard data={activity} label="APR 2025" mode="month" periodKey="2025-04" />
  {/if}
</div>
<Button onclick={() => exportCardPng(host.querySelector('[data-stats-card]')!, `${card}.png`)}>
  Export test card
</Button>
