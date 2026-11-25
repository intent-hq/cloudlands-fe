<script lang="ts">
  /**
   * Tool Calls card (360×640): total terminal tool calls, a success-rate
   * ring, and succeeded / failed / per-run stats. Shows "—" for the rate
   * with no calls, and a note when the daemon is too old to count tool calls
   * or the period began before it started counting.
   */
  import type { UsageStatsResult } from '$lib/client/app-client';
  import { formatDatePattern, formatNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import ActivityCardFrame from './ActivityCardFrame.svelte';
  import {
    hasActivityCounters,
    heroFontSize,
    statFontSize,
    toolsModel,
    trackedSinceNote,
  } from './stats-activity';
  import { formatInt, formatShare } from './stats-format';
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

  const RADIUS = 52;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const model = $derived(toolsModel(data));
  const hero = $derived(formatInt(model.total));
  const succeededText = $derived(formatInt(model.succeeded));
  const failedText = $derived(formatInt(model.failed));
  const since = $derived(trackedSinceNote(data, mode, periodKey));
  const note = $derived(
    !hasActivityCounters(data)
      ? m.stats_activity_needsUpgrade_label()
      : since
        ? m.stats_activity_trackedSince_label({ date: formatDatePattern(since, 'MMM d, yyyy') })
        : null,
  );
  const successArc = $derived((model.successRate ?? 0) * CIRCUMFERENCE);
  const failedArc = $derived(model.successRate === null ? 0 : CIRCUMFERENCE - successArc);
</script>

<ActivityCardFrame card="tools" title={m.stats_toolsCard_title_label()} {label} {loading}>
  <div class="hero">
    <div class="hero-label">{m.stats_toolsCard_total_label()}</div>
    <div class="hero-value" style:font-size="{heroFontSize(hero)}px">{hero}</div>
    {#if note}<div class="note">{note}</div>{/if}
  </div>
  <div class="visual ring-wrap">
    <svg class="ring" viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
      <circle class="ring-track" cx="60" cy="60" r={RADIUS} />
      {#if failedArc > 0}
        <circle
          class="ring-failed"
          cx="60"
          cy="60"
          r={RADIUS}
          stroke-dasharray="{failedArc} {CIRCUMFERENCE}"
          stroke-dashoffset={-successArc}
        />
      {/if}
      {#if successArc > 0}
        <circle
          class="ring-success"
          cx="60"
          cy="60"
          r={RADIUS}
          stroke-dasharray="{successArc} {CIRCUMFERENCE}"
        />
      {/if}
    </svg>
    <div class="ring-center">
      <div class="ring-value mono">
        {model.successRate === null ? '—' : formatShare(model.successRate)}
      </div>
      <div class="ring-label">{m.stats_toolsCard_successRate_label()}</div>
    </div>
  </div>
  <div class="grid">
    <div>
      <div class="stat-label">{m.stats_toolsCard_succeeded_label()}</div>
      <div class="stat-big" style:font-size="{statFontSize(succeededText)}px">
        {succeededText}
      </div>
    </div>
    <div>
      <div class="stat-label">{m.stats_toolsCard_failed_label()}</div>
      <div class="stat-big" style:font-size="{statFontSize(failedText)}px">{failedText}</div>
    </div>
    <div>
      <div class="stat-label">{m.stats_toolsCard_perRun_label()}</div>
      <div class="stat-small">
        {model.perRun === null ? '—' : formatNumber(model.perRun, { maximumFractionDigits: 1 })}
      </div>
    </div>
  </div>
</ActivityCardFrame>

<style>
  .ring-wrap {
    position: relative;
    display: flex;
    justify-content: center;
  }
  .ring {
    transform: rotate(-90deg);
  }
  .ring circle {
    fill: none;
    stroke-width: 12;
  }
  .ring-track {
    stroke: hsl(var(--muted));
  }
  .ring-success {
    stroke: hsl(var(--success));
  }
  .ring-failed {
    stroke: hsl(var(--danger));
  }
  .ring-center {
    position: absolute;
    inset: 22px 0 0;
    height: 132px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .ring-value {
    font-size: 24px;
  }
  .ring-label {
    font-size: 11px;
    letter-spacing: 0.14em;
    color: hsl(var(--muted-foreground));
  }
</style>
