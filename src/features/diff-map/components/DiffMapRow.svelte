<script lang="ts">
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
  const stats = $derived(
    file.statsKnown
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
    [file.path, stats, freshnessLabel].filter((value) => value !== undefined).join(', '),
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

<button
  type="button"
  class="diff-map-row"
  class:diff-map-row--active={active}
  class:diff-map-row--selected={selected}
  class:diff-map-row--dense={rung >= 2}
  data-diff-map-row
  data-file-id={file.id}
  data-status={file.status}
  data-viewed-state={changedSinceViewed ? 'changed' : viewed ? 'viewed' : undefined}
  aria-label={accessibleName}
  aria-describedby={tooltipId}
  aria-pressed={selected}
  tabindex={focused ? 0 : -1}
  style:left={`${row.x - blockX}px`}
  style:top={`${row.y - blockY}px`}
  style:width={`${row.w}px`}
  style:height={`${row.h}px`}
  style:opacity={matchesFilter ? 1 : 0.28}
  onclick={(event) => onActivate(file, event)}
  onkeydown={(event) => onKeydown(file, event)}
  onfocus={() => onFocus(file)}
>
  <span class="status" aria-hidden="true">{glyphs[file.status]}</span>
  <span class="filename">{row.label}</span>

  {#if rung <= 1}
    {#if file.statsKnown}
      <span class="stats" aria-hidden="true">
        <span class="additions">+{formatInteger(file.additions)}</span>
        <span class="deletions">−{formatInteger(file.deletions)}</span>
      </span>
    {:else}
      <span class="stats stats--unknown" aria-hidden="true">{stats}</span>
    {/if}
  {/if}

  {#if comments !== undefined && comments > 0}
    <span class="overlay" aria-hidden="true">{formatInteger(comments)}</span>
  {:else if attribution}
    <span class="overlay" aria-hidden="true">{attribution.agent?.agentName?.[0] ?? '•'}</span>
  {:else if changedSinceViewed}
    <span class="overlay overlay--changed" aria-hidden="true">!</span>
  {:else if viewed}
    <span class="overlay" aria-hidden="true">✓</span>
  {/if}

  {#if rung === 0 && (file.oldTrack || file.newTrack)}
    <span class="tracks"><HunkTracks oldTrack={file.oldTrack} newTrack={file.newTrack} /></span>
  {:else if rung === 2 && file.statsKnown}
    <span class="churn" style:width={`${churn}%`}></span>
  {/if}

  <span id={tooltipId} role="tooltip" class="tooltip">{tooltip}</span>
</button>

<style>
  .diff-map-row {
    position: absolute;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 5px;
    overflow: visible;
    padding: 2px 5px;
    border: 1px solid transparent;
    border-radius: var(--radius-small);
    background: transparent;
    color: hsl(var(--foreground));
    text-align: left;
    transition:
      opacity var(--motion-fast) var(--ease-standard),
      background-color var(--motion-fast) var(--ease-standard);
  }

  .diff-map-row:hover,
  .diff-map-row--selected {
    background: hsl(var(--accent));
  }

  .diff-map-row--active::before {
    position: absolute;
    inset-block: 4px;
    left: -2px;
    width: 3px;
    border-radius: 9999px;
    background: hsl(var(--primary));
    content: '';
  }

  .diff-map-row:focus-visible {
    z-index: 2;
    outline: 2px solid hsl(var(--ring));
    outline-offset: -1px;
  }

  .status {
    min-width: 14px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    color: hsl(var(--muted-foreground));
  }

  [data-status='added'] .status {
    color: rgb(4 120 87);
  }

  [data-status='deleted'] .status {
    color: rgb(220 38 38);
  }

  [data-status='renamed'] .status {
    color: rgb(37 99 235);
  }

  [data-status='binary'] .status {
    color: rgb(147 51 234);
  }

  .filename {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    line-height: 1;
    text-overflow: clip;
    white-space: nowrap;
  }

  .diff-map-row--dense .filename {
    font-size: 11px;
  }

  .stats {
    display: flex;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
  }

  .additions {
    color: rgb(4 120 87);
  }

  .deletions {
    color: rgb(220 38 38);
  }

  .stats--unknown {
    color: hsl(var(--muted-foreground));
  }

  .tracks {
    position: absolute;
    right: 5px;
    bottom: 2px;
    left: 24px;
  }

  .churn {
    position: absolute;
    bottom: 1px;
    left: 0;
    height: 2px;
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
    background: rgb(217 119 6);
    color: white;
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

  .diff-map-row:hover .tooltip,
  .diff-map-row:focus-visible .tooltip {
    display: block;
  }

  :global(.dark) [data-status='added'] .status,
  :global(.dark) .additions {
    color: rgb(16 185 129);
  }

  :global(.dark) [data-status='deleted'] .status,
  :global(.dark) .deletions {
    color: rgb(239 68 68);
  }

  @media (prefers-reduced-motion: reduce) {
    .diff-map-row {
      transition: none;
    }
  }
</style>
