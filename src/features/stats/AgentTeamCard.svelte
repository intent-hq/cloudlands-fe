<script lang="ts">
  /**
   * Agent Team card (360×640): agents started, a top-level vs sub-agent
   * split, and agent-hours / average turn / longest run. Agent-hours add up
   * parallel agents, so they are agent time, not clock time.
   */
  import type { UsageStatsResult } from '$lib/client/app-client';
  import { formatDatePattern, formatNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import ActivityCardFrame from './ActivityCardFrame.svelte';
  import {
    hasActivityCounters,
    heroFontSize,
    statFontSize,
    teamModel,
    trackedSinceNote,
  } from './stats-activity';
  import { formatDuration, formatInt, formatShortDuration } from './stats-format';
  import type { StatsMode } from './stats-period';

  let {
    data,
    label,
    mode,
    periodKey,
    loading = false,
  }: {
    data: UsageStatsResult | null;
    label: string;
    mode: StatsMode;
    periodKey: string | null;
    loading?: boolean;
  } = $props();

  const model = $derived(teamModel(data));
  const hero = $derived(formatInt(model.agents));
  const upgraded = $derived(hasActivityCounters(data));
  const since = $derived(trackedSinceNote(data, mode, periodKey));
  const note = $derived(
    !upgraded
      ? m.stats_activity_needsUpgrade_label()
      : since
        ? m.stats_activity_trackedSince_label({ date: formatDatePattern(since, 'MMM d, yyyy') })
        : null,
  );
  const hours = $derived(model.agentMs / 3_600_000);
  const hoursText = $derived(
    upgraded
      ? formatNumber(hours, { maximumFractionDigits: hours > 0 && hours < 10 ? 1 : 0 })
      : '—',
  );
</script>

<ActivityCardFrame card="team" title={m.stats_teamCard_title_label()} {label} {loading}>
  <div class="hero">
    <div class="hero-label">{m.stats_teamCard_agentsStarted_label()}</div>
    <div class="hero-value" style:font-size="{heroFontSize(hero)}px">{hero}</div>
    {#if note}<div class="note">{note}</div>{/if}
  </div>
  <div class="visual">
    <div class="split">
      {#if upgraded && model.agents > 0}
        <span class="seg-top" style:width="{((1 - model.subShare) * 100).toFixed(1)}%"></span>
        <span class="seg-sub" style:flex="1"></span>
      {/if}
    </div>
    <div class="legend">
      <span class="legend-item"
        ><span class="swatch seg-top"></span>{m.stats_teamCard_topLevel_label({
          count: upgraded ? formatInt(model.topLevel) : '—',
        })}</span
      >
      <span class="legend-item"
        ><span class="swatch seg-sub"></span>{m.stats_teamCard_subAgents_label({
          count: upgraded ? formatInt(model.subAgents) : '—',
        })}</span
      >
    </div>
  </div>
  <div class="grid">
    <div>
      <div class="stat-label">{m.stats_teamCard_agentHours_label()}</div>
      <div class="stat-big" style:font-size="{statFontSize(hoursText)}px">{hoursText}</div>
    </div>
    <div>
      <div class="stat-label">{m.stats_teamCard_avgTurn_label()}</div>
      <div class="stat-big">
        {model.avgTurnMs === null ? '—' : formatShortDuration(model.avgTurnMs)}
      </div>
    </div>
    <div>
      <div class="stat-label">{m.stats_passportCard_longestRun_label()}</div>
      <div class="stat-small">{formatDuration(model.longestRunMs)}</div>
    </div>
  </div>
</ActivityCardFrame>

<style>
  .seg-top {
    background: hsl(var(--primary-ink));
  }
  .seg-sub {
    background: hsl(var(--success));
  }
</style>
