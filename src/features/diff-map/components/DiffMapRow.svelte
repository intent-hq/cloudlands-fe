<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiffMapDensityRung, DiffMapLayoutRow } from '../layout/layout-diff-map';
  import type { DiffMapAttribution, DiffMapFile } from '../model/types';
  import HunkTracks from './HunkTracks.svelte';

  export interface DiffMapLayers {
    attribution?: boolean | ReadonlyMap<string, DiffMapAttribution>;
    comments?: ReadonlyMap<string, number>;
    viewed?: ReadonlySet<string>;
    changedSinceViewed?: ReadonlySet<string>;
  }

  interface Props {
    file: DiffMapFile;
    row: DiffMapLayoutRow;
    blockX: number;
    blockY: number;
    rung: DiffMapDensityRung;
    active: boolean;
    selected: boolean;
    focused: boolean;
    matchesFilter: boolean;
    layers?: DiffMapLayers;
    onActivate: (file: DiffMapFile, event: MouseEvent) => void;
    onKeydown: (file: DiffMapFile, event: KeyboardEvent) => void;
    onFocus: (file: DiffMapFile) => void;
  }

  let {
    file,
    row,
    blockX,
    blockY,
    rung,
    active,
    selected,
    focused,
    matchesFilter,
    layers,
    onActivate,
    onKeydown,
    onFocus,
  }: Props = $props();

  const glyphs = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R→', binary: 'B', mode: 'M' };
  const suppressZeroStats = $derived(
    file.statsKnown &&
      file.additions === 0 &&
      file.deletions === 0 &&
      (file.status === 'renamed' || file.status === 'mode' || file.status === 'binary'),
  );
  const stats = $derived(
    suppressZeroStats
      ? undefined
      : file.statsKnown
        ? `+${formatInteger(file.additions)} −${formatInteger(file.deletions)}`
        : m.diffMap_statsUnavailable_label(),
  );
  const viewed = $derived(layers?.viewed?.has(file.path) ?? false);
  const changedSinceViewed = $derived(layers?.changedSinceViewed?.has(file.path) ?? false);
  const freshnessLabel = $derived(
    changedSinceViewed
      ? m.diffMap_changedSinceViewed_label()
      : viewed
        ? m.chat_changesPanel_viewed_label()
        : undefined,
  );
  const accessibleName = $derived(
    [file.path, file.status, stats, freshnessLabel]
      .filter((value) => value !== undefined)
      .join(', '),
  );
  const tooltip = $derived(
    file.renamedFrom ? `${accessibleName}\n${file.renamedFrom} → ${file.path}` : accessibleName,
  );
  const tooltipId = $derived(`diff-map-tip-${file.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
  const comments = $derived(layers?.comments?.get(file.path));
  const attribution = $derived(
    layers?.attribution instanceof Map
      ? layers.attribution.get(file.path)
      : layers?.attribution
        ? file.attribution
        : undefined,
  );
  const churn = $derived(
    file.statsKnown
      ? Math.min(100, (Math.log1p(file.additions + file.deletions) / Math.log(1001)) * 100)
      : 0,
  );
</script>

<Button
  variant="ghost"
  class={`diff-map-row h-auto font-normal ${active ? 'diff-map-row--active' : ''} ${selected ? 'diff-map-row--selected' : ''} ${rung === 0 ? 'diff-map-row--tracks' : ''} ${rung >= 2 ? 'diff-map-row--dense' : ''} ${rung === 3 ? 'diff-map-row--minimal' : ''}`}
  data-diff-map-row
  data-file-id={file.id}
  data-status={file.status}
  data-viewed-state={changedSinceViewed ? 'changed' : viewed ? 'viewed' : undefined}
  aria-label={accessibleName}
  aria-describedby={tooltipId}
  aria-pressed={selected}
  tabindex={focused ? 0 : -1}
  style={`left: ${row.x - blockX}px; top: ${row.y - blockY}px; width: ${row.w}px; height: ${row.h}px; opacity: ${matchesFilter ? 1 : 0.28}`}
  onclick={(event) => onActivate(file, event)}
  onkeydown={(event) => onKeydown(file, event)}
  onfocus={() => onFocus(file)}
>
  <span class="status" aria-hidden="true" style:grid-column="1">{glyphs[file.status]}</span>
  <span class="filename" style:grid-column="2">{row.label}</span>

  {#if comments !== undefined && comments > 0}
    <span class="overlay" aria-hidden="true" style:grid-column="3">{formatInteger(comments)}</span>
  {:else if attribution}
    <span class="overlay" aria-hidden="true" style:grid-column="3"
      >{attribution.agent?.agentName?.[0] ?? '•'}</span
    >
  {:else if changedSinceViewed}
    <span class="overlay overlay--changed" aria-hidden="true" style:grid-column="3">!</span>
  {:else if viewed}
    <span class="overlay" aria-hidden="true" style:grid-column="3">✓</span>
  {/if}

  {#if rung <= 1 && !suppressZeroStats}
    {#if file.statsKnown}
      <span class="stats" aria-hidden="true" style:grid-column="4">
        <span class="additions">+{formatInteger(file.additions)}</span>
        <span class="deletions">−{formatInteger(file.deletions)}</span>
      </span>
    {:else}
      <span class="stats stats--unknown" aria-hidden="true" style:grid-column="4">{stats}</span>
    {/if}
  {/if}

  {#if rung === 0}
    <span class="row-encoding">
      {#if file.statsKnown}
        <span class="churn-track"><span class="churn" style:width={`${churn}%`}></span></span>
      {/if}
      {#if file.oldTrack || file.newTrack}
        <span class="tracks"><HunkTracks oldTrack={file.oldTrack} newTrack={file.newTrack} /></span>
      {/if}
    </span>
  {:else if rung <= 2 && file.statsKnown}
    <span class="churn-track"><span class="churn" style:width={`${churn}%`}></span></span>
  {/if}

  <span id={tooltipId} role="tooltip" class="tooltip">{tooltip}</span>
</Button>

<style>
  :global(.diff-map-row) {
    position: absolute;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 5px;
    overflow: visible;
    padding: 2px 5px;
    border: 1px solid transparent;
    border-radius: var(--radius-small);
    background: transparent;
    color: hsl(var(--foreground));
    text-align: left;
    line-height: 1;
    transition:
      opacity var(--motion-fast) var(--ease-standard),
      background-color var(--motion-fast) var(--ease-standard);
  }

  /* Reserve the encoding band without increasing the layout engine’s row height. */
  :global(.diff-map-row--tracks) {
    padding-bottom: 9px;
  }

  :global(.diff-map-row:hover),
  :global(.diff-map-row--selected) {
    background: hsl(var(--accent));
  }

  :global(.diff-map-row--active::before) {
    position: absolute;
    inset-block: 4px;
    left: 1px;
    width: 3px;
    border-radius: 9999px;
    background: hsl(var(--primary));
    content: '';
  }

  :global(.diff-map-row:focus-visible) {
    z-index: 2;
    outline: 2px solid hsl(var(--ring));
    outline-offset: -1px;
  }

  .status {
    width: 18px;
    font-family: var(--font-code);
    font-size: 10px;
    font-weight: 700;
    color: hsl(var(--muted-foreground));
    text-align: center;
  }

  :global([data-status='added']) .status {
    color: color-mix(in srgb, hsl(var(--success)) 90%, hsl(var(--foreground)));
  }

  :global([data-status='deleted']) .status {
    color: hsl(var(--danger));
  }

  :global([data-status='renamed']) .status {
    color: color-mix(in srgb, hsl(var(--info)) 80%, hsl(var(--foreground)));
  }

  :global([data-status='binary']) .status {
    color: color-mix(in srgb, hsl(var(--info)) 80%, hsl(var(--foreground)));
  }

  .filename {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    line-height: 1;
    text-overflow: clip;
    white-space: nowrap;
  }

  :global(.diff-map-row--dense) .filename {
    font-size: 11px;
  }

  .stats {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    justify-self: end;
    font-family: var(--font-code);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  .additions {
    color: color-mix(in srgb, hsl(var(--success)) 90%, hsl(var(--foreground)));
  }

  .deletions {
    color: hsl(var(--danger));
  }

  .stats--unknown {
    color: hsl(var(--muted-foreground));
  }

  .row-encoding {
    position: absolute;
    right: 5px;
    bottom: 2px;
    left: 28px;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 5px;
    height: 6px;
  }

  .tracks {
    grid-column: 2;
  }

  .churn-track {
    position: absolute;
    right: 5px;
    bottom: 1px;
    left: 28px;
    height: 2px;
  }

  .row-encoding .churn-track {
    position: static;
    align-self: center;
  }

  .churn {
    display: block;
    height: 100%;
    border-radius: 9999px;
    background: hsl(var(--primary) / 0.55);
  }

  .overlay {
    display: grid;
    min-width: 15px;
    height: 15px;
    place-items: center;
    border-radius: 9999px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-size: 9px;
    font-weight: 700;
  }

  .overlay--changed {
    border: 1px solid hsl(var(--warning-foreground));
    background: hsl(var(--warning));
    color: hsl(var(--warning-foreground));
  }

  :global(.diff-map-row--minimal) .overlay {
    width: 6px;
    min-width: 6px;
    height: 6px;
    overflow: hidden;
    color: transparent;
    font-size: 0;
  }

  .tooltip {
    position: absolute;
    z-index: var(--layer-tooltip);
    top: calc(100% + 4px);
    left: 4px;
    display: none;
    max-width: min(360px, 80vw);
    padding: 5px 7px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--popover));
    box-shadow: var(--elevation-overlay);
    color: hsl(var(--popover-foreground));
    font-size: 11px;
    line-height: 1.35;
    pointer-events: none;
    white-space: pre-line;
  }

  :global(.diff-map-row:hover) .tooltip,
  :global(.diff-map-row:focus-visible) .tooltip {
    display: block;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.diff-map-row) {
      transition: none;
    }
  }
</style>
