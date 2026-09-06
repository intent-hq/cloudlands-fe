<script lang="ts">
  import {
    diffMapGroupCountLabel,
    type DiffMapDensityRung,
    type DiffMapLayoutBlock,
    type DiffMapLayoutRow,
  } from '../layout/layout-diff-map';
  import type { DiffMapFile, DiffMapGroup } from '../model/types';
  import DiffMapRow, { type DiffMapLayers } from './DiffMapRow.svelte';

  interface Props {
    block: DiffMapLayoutBlock;
    group: DiffMapGroup;
    files: ReadonlyMap<string, DiffMapFile>;
    rung: DiffMapDensityRung;
    activePath?: string;
    selection: ReadonlySet<string>;
    focusedPath?: string;
    filter: string;
    pathFilter?: ReadonlySet<string>;
    layers?: DiffMapLayers;
    onActivate: (file: DiffMapFile, event: MouseEvent) => void;
    onKeydown: (file: DiffMapFile, event: KeyboardEvent) => void;
    onFocus: (file: DiffMapFile) => void;
    onHover: (group: DiffMapGroup | null) => void;
  }

  let {
    block,
    group,
    files,
    rung,
    activePath,
    selection,
    focusedPath,
    filter,
    pathFilter,
    layers,
    onActivate,
    onKeydown,
    onFocus,
    onHover,
  }: Props = $props();

  const rows = $derived(block.columns.flatMap((column) => column.rows));
  const countLabel = $derived(diffMapGroupCountLabel(group));
  function matches(row: DiffMapLayoutRow) {
    const file = files.get(row.fileId);
    return (
      (!filter || file?.path.toLocaleLowerCase().includes(filter) === true) &&
      (!pathFilter || (file ? pathFilter.has(file.path) : false))
    );
  }
</script>

<section
  class="diff-map-block"
  data-group-id={group.id}
  data-rung={rung}
  style:left={`${block.x}px`}
  style:top={`${block.y}px`}
  style:width={`${block.w}px`}
  style:height={`${block.h}px`}
>
  <header
    class="group-header"
    role="presentation"
    style:height={`${block.headerHeight}px`}
    title={group.path}
    onmouseenter={() => onHover(group)}
    onmouseleave={() => onHover(null)}
  >
    <span class="group-path">
      <span class="prefix">{block.labelPrefix}</span><strong>{block.labelName}</strong>
    </span>
    <span class="count">{countLabel}</span>
  </header>

  {#each rows as row (row.fileId)}
    {@const file = files.get(row.fileId)}
    {#if file}
      <DiffMapRow
        {file}
        {row}
        blockX={block.x}
        blockY={block.y}
        {rung}
        active={file.path === activePath}
        selected={selection.has(file.path)}
        focused={file.path === focusedPath}
        matchesFilter={matches(row)}
        {layers}
        {onActivate}
        {onKeydown}
        {onFocus}
      />
    {/if}
  {/each}
</section>

<style>
  .diff-map-block {
    position: absolute;
    overflow: visible;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--card) / 0.72);
    box-shadow: var(--elevation-raised);
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    overflow: hidden;
    padding: 0 6px;
    border-bottom: 1px solid hsl(var(--border));
    color: hsl(var(--card-foreground));
    font-size: 11px;
  }

  .group-path {
    display: flex;
    min-width: 0;
    white-space: nowrap;
  }

  .group-path strong {
    flex: none;
  }

  .prefix {
    min-width: 0;
    overflow: hidden;
  }

  .prefix,
  .count {
    color: hsl(var(--muted-foreground));
  }

  .count {
    flex: none;
    font-size: 10px;
    white-space: nowrap;
  }

  .diff-map-block[data-rung='3'] .count {
    display: none;
  }
</style>
