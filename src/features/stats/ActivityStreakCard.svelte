<script lang="ts">
  /**
   * Activity Streak card (360×640, Month and Year only): a calendar heatmap
   * of `byDay` shaded by token volume, active days, and the longest /
   * current streak plus the busiest day. Hidden in 24H by the overlay.
   */
  import type { UsageStatsResult } from '$lib/client/app-client';
  import { formatDatePattern } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import ActivityCardFrame from './ActivityCardFrame.svelte';
  import { heroFontSize, parseDateKey, streakModel } from './stats-activity';
  import { formatInt, formatTokens } from './stats-format';

  let {
    data,
    label,
    mode,
    periodKey,
    loading = false,
  }: {
    data: UsageStatsResult | null;
    label: string;
    mode: 'month' | 'year';
    periodKey: string | null;
    loading?: boolean;
  } = $props();

  const model = $derived(streakModel(data, mode, periodKey));
  const hero = $derived(formatInt(model.activeDays));
  const outdated = $derived(data !== null && data.byDay === undefined);

  function days(count: number): string {
    const value = formatInt(count);
    return count === 1
      ? m.stats_streakCard_days_one({ count: value })
      : m.stats_streakCard_days_many({ count: value });
  }

  function monthLetter(index: number): string {
    return formatDatePattern(new Date(2026, index, 1), 'MMMMM');
  }

  const busiest = $derived.by(() => {
    if (!model.busiest) return '—';
    const date = parseDateKey(model.busiest.date);
    return m.stats_streakCard_busiestDayValue_label({
      date: date ? formatDatePattern(date, 'MMM d') : model.busiest.date,
      tokens: formatTokens(model.busiest.tokens),
    });
  });
</script>

<ActivityCardFrame card="streak" title={m.stats_streakCard_title_label()} {label} {loading}>
  <div class="hero">
    <div class="hero-label">{m.stats_streakCard_activeDays_label()}</div>
    <div class="hero-value" style:font-size="{heroFontSize(hero)}px">{hero}</div>
    {#if outdated}
      <div class="note">{m.stats_activity_needsUpgrade_label()}</div>
    {:else}
      <div class="hero-sub">
        {m.stats_streakCard_ofDays_label({ count: formatInt(model.elapsedDays) })}
      </div>
    {/if}
  </div>
  <div class="visual">
    {#if mode === 'month'}
      <div class="month">
        {#each model.rows as week, w (w)}
          {#each week as cell, d (d)}
            <span
              class="cell heat-{cell.level}"
              class:pad={cell.date === null}
              class:future={cell.future}
            ></span>
          {/each}
        {/each}
      </div>
    {:else}
      <div class="year">
        {#each model.rows as row, i (i)}
          <span class="row-label mono">{monthLetter(i)}</span>
          {#each row as cell, d (d)}
            <span
              class="cell heat-{cell.level}"
              class:pad={cell.date === null}
              class:future={cell.future}
            ></span>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
  <div class="grid">
    <div>
      <div class="stat-label">{m.stats_streakCard_longestStreak_label()}</div>
      <div class="stat-big">{days(model.longestStreak)}</div>
    </div>
    <div>
      <div class="stat-label">{m.stats_streakCard_currentStreak_label()}</div>
      <div class="stat-big">{model.currentStreak === null ? '—' : days(model.currentStreak)}</div>
    </div>
    <div class="span-2">
      <div class="stat-label">{m.stats_streakCard_busiestDay_label()}</div>
      <div class="stat-small">{busiest}</div>
    </div>
  </div>
</ActivityCardFrame>

<style>
  .month {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
    width: 230px;
  }
  .month .cell {
    aspect-ratio: 1;
    border-radius: 6px;
  }
  .year {
    display: grid;
    grid-template-columns: auto repeat(31, 1fr);
    gap: 2px;
    align-items: center;
  }
  .year .cell {
    aspect-ratio: 1;
    border-radius: 2px;
  }
  .row-label {
    font-size: 10px; /* a11y-ignore: 10px axis label, matches the other cards' grid labels */
    line-height: 1;
    color: hsl(var(--muted-foreground));
  }
  .heat-0 {
    background: hsl(var(--muted));
  }
  .heat-1 {
    background: color-mix(in srgb, hsl(var(--primary-ink)) 35%, hsl(var(--muted)));
  }
  .heat-2 {
    background: color-mix(in srgb, hsl(var(--primary-ink)) 60%, hsl(var(--muted)));
  }
  .heat-3 {
    background: color-mix(in srgb, hsl(var(--primary-ink)) 80%, hsl(var(--muted)));
  }
  .heat-4 {
    background: hsl(var(--primary-ink));
  }
  .cell.future {
    opacity: 0.45;
  }
  .cell.pad {
    background: transparent;
  }
  .span-2 {
    grid-column: span 2;
  }
</style>
