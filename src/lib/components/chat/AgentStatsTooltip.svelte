<script lang="ts">
  /**
   * AgentStatsTooltip
   *
   * Renders credit usage stats for an agent session inside a tooltip content area.
   * Designed to be used as the `content` snippet of TooltipRich.
   */
  import type { AgentSessionStats } from '$store/renderer/slices/session-stats/session-stats-types';
  import { Skeleton } from '$lib/components/ui/skeleton';

  type EmptyState = 'pending' | 'empty';

  interface Props {
    stats: AgentSessionStats | undefined;
    loading: boolean;
    error: string | undefined;
    emptyState?: EmptyState;
  }

  let { stats, loading, error, emptyState = 'pending' }: Props = $props();

  /** Format credits as a short human-readable string */
  function formatCredits(value: number | null): string {
    if (value == null) return '—';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (value === 0) return '0';
    if (value < 0.01) return '<0.01';
    return value.toFixed(2);
  }
</script>

{#if loading || (!stats && !error && emptyState !== 'empty')}
  <div
    class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm"
    aria-busy="true"
    aria-label="Loading agent stats"
  >
    <span class="text-subtle">Messages</span>
    <Skeleton class="h-3 w-8 justify-self-end self-center" />

    <span class="text-subtle">Tool calls</span>
    <Skeleton class="h-3 w-7 justify-self-end self-center" />

    <span class="text-subtle">Credits used</span>
    <Skeleton class="h-3 w-10 justify-self-end self-center" />
  </div>
{:else if error}
  <div class="text-sm text-red-500 py-1">Failed to load stats</div>
{:else if stats}
  <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
    <span class="text-subtle">Messages</span>
    <span class="text-right font-medium">{stats.messageCount}</span>

    <span class="text-subtle">Tool calls</span>
    <span class="text-right font-medium">{stats.toolCount}</span>

    {#if stats.creditsUsed != null}
      <span class="text-subtle">Credits used</span>
      <span class="text-right font-medium">{formatCredits(stats.creditsUsed)}</span>
    {/if}

    {#if stats.parentCreditsUsed != null && stats.parentCreditsUsed > 0}
      <span class="text-subtle">Parent credits</span>
      <span class="text-right font-medium">{formatCredits(stats.parentCreditsUsed)}</span>
    {/if}

    {#if stats.subAgentCreditsUsed != null && stats.subAgentCreditsUsed > 0}
      <span class="text-subtle">Sub-agent credits</span>
      <span class="text-right font-medium">{formatCredits(stats.subAgentCreditsUsed)}</span>
    {/if}
  </div>
{:else}
  <div class="text-sm text-subtle py-1">No stats available</div>
{/if}
