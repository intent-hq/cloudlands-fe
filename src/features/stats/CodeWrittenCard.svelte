<script lang="ts">
  /**
   * Code Written card (360×640): net agent-written lines, an added vs
   * deleted split, and a printed-pages comparison. Uses only `linesAdded` /
   * `linesDeleted`, so it works with every daemon version.
   */
  import type { UsageStatsResult } from '$lib/client/app-client';
  import { m } from '$shared/paraglide/messages.js';
  import ActivityCardFrame from './ActivityCardFrame.svelte';
  import { codeModel, heroFontSize, statFontSize } from './stats-activity';
  import { formatInt, formatSignedInt } from './stats-format';

  let {
    data,
    label,
    loading = false,
  }: { data: UsageStatsResult | null; label: string; loading?: boolean } = $props();

  const model = $derived(codeModel(data));
  const hero = $derived(formatSignedInt(model.net));
  const addedText = $derived(formatInt(model.added));
  const deletedText = $derived(formatInt(model.deleted));
</script>

<ActivityCardFrame card="code" title={m.stats_codeCard_title_label()} {label} {loading}>
  <div class="hero">
    <div class="hero-label">{m.stats_codeCard_netLines_label()}</div>
    <div class="hero-value" style:font-size="{heroFontSize(hero)}px">{hero}</div>
    <div class="hero-sub">
      <span class="tone-success">{m.stats_codeCard_added_label({ amount: addedText })}</span>
      <span class="tone-danger">{m.stats_codeCard_deleted_label({ amount: deletedText })}</span>
    </div>
  </div>
  <div class="visual">
    <div class="split">
      {#if model.touched > 0}
        <span class="seg-added" style:width="{(model.addedShare * 100).toFixed(1)}%"></span>
        <span class="seg-deleted" style:flex="1"></span>
      {/if}
    </div>
  </div>
  <div class="grid">
    <div>
      <div class="stat-label">{m.stats_codeCard_linesAdded_label()}</div>
      <div class="stat-big" style:font-size="{statFontSize(addedText)}px">{addedText}</div>
    </div>
    <div>
      <div class="stat-label">{m.stats_codeCard_linesDeleted_label()}</div>
      <div class="stat-big" style:font-size="{statFontSize(deletedText)}px">{deletedText}</div>
    </div>
    <div>
      <div class="stat-label">{m.stats_codeCard_linesTouched_label()}</div>
      <div class="stat-small">{formatInt(model.touched)}</div>
    </div>
    <div>
      <div class="stat-label">{m.stats_codeCard_printedPages_label()}</div>
      <div class="stat-small">
        {m.stats_codeCard_printedPagesValue_label({ pages: formatInt(model.pages) })}
      </div>
    </div>
  </div>
</ActivityCardFrame>

<style>
  .seg-added {
    background: hsl(var(--success));
  }
  .seg-deleted {
    background: hsl(var(--danger));
  }
</style>
