<script lang="ts">
  import { faSearch } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import {
    diffLayouts,
    layoutDiffMap,
    shouldRelayoutDiffMap,
    type DiffMapDensityRung,
    type DiffMapLayout,
    type DiffMapLayoutDelta,
    type DiffMapLayoutRequest,
    type TextMeasureContext,
  } from '../layout/layout-diff-map';
  import type { DiffMapDocument, DiffMapFile, DiffMapGroup } from '../model/types';
  import DiffMapBlock from './DiffMapBlock.svelte';
  import DiffMapRail from './DiffMapRail.svelte';
  import type { DiffMapLayers } from './DiffMapRow.svelte';

  interface Props {
    document: DiffMapDocument;
    activePath?: string;
    selection?: Set<string>;
    layers?: DiffMapLayers;
    pathFilter?: ReadonlySet<string>;
    rungOverride?: DiffMapDensityRung;
    filterable?: boolean;
    onOpen: (file: DiffMapFile, event: MouseEvent | KeyboardEvent) => void;
    onHoverGroup?: (group: DiffMapGroup | null) => void;
    onSelectionChange?: (selection: Set<string>) => void;
  }

  let {
    document,
    activePath,
    selection = $bindable(new Set<string>()),
    layers,
    pathFilter,
    rungOverride,
    filterable = true,
    onOpen,
    onHoverGroup,
    onSelectionChange,
  }: Props = $props();

  const RAIL_WIDTH = 20;
  let rootElement: HTMLDivElement | undefined = $state();
  let viewportElement: HTMLDivElement | undefined = $state();
  let filterElement: HTMLInputElement | undefined = $state();
  let viewport = $state({ width: 900, height: 500 });
  let layout: DiffMapLayout | undefined = $state();
  let scrollTop = $state(0);
  let filter = $state('');
  let focusedPath = $state<string | undefined>();
  let selectionAnchor = $state<string | undefined>();
  let renderedLayout: DiffMapLayout | undefined;
  let previousRequest: DiffMapLayoutRequest | undefined;
  let measured = false;
  let measureContext: CanvasRenderingContext2D | null | undefined;

  const filesById = $derived(new Map(document.files.map((file) => [file.id, file])));
  const groupsById = $derived(new Map(document.groups.map((group) => [group.id, group])));
  const layoutRows = $derived(
    layout?.blocks.flatMap((block) => block.columns.flatMap((column) => column.rows)) ?? [],
  );
  const readingFiles = $derived(
    layoutRows.map((row) => filesById.get(row.fileId)).filter((file) => file !== undefined),
  );
  const fileCountLabel = $derived(
    document.files.length === 1
      ? m.workspace_noteCodeChanges_filesChanged_one()
      : m.workspace_noteCodeChanges_filesChanged_many({
          count: formatInteger(document.files.length),
        }),
  );

  function measure(text: string, context: TextMeasureContext) {
    if (measureContext === undefined) {
      measureContext = globalThis.navigator?.userAgent.includes('jsdom')
        ? null
        : (globalThis.document?.createElement('canvas').getContext('2d') ?? null);
    }
    const size = context.role === 'file' ? (context.rung >= 2 ? 11 : 12) : 11;
    if (!measureContext) return text.length * size * 0.58;
    measureContext.font = `${context.role === 'group' ? 600 : 400} ${size}px sans-serif`;
    return measureContext.measureText(text).width;
  }

  function computeLayout(request: DiffMapLayoutRequest) {
    const options = { rungOverride: request.rungOverride };
    let next = layoutDiffMap(request.document, request.viewport, measure, options);
    if (next.overflow && request.viewport.width > RAIL_WIDTH) {
      next = layoutDiffMap(
        request.document,
        { width: request.viewport.width - RAIL_WIDTH, height: request.viewport.height },
        measure,
        options,
      );
    }
    return next;
  }

  function animateLayout(delta: DiffMapLayoutDelta) {
    if (!viewportElement || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const animate = (element: Element | undefined, fromX: number, fromY: number) => {
      if (!(element instanceof HTMLElement) || typeof element.animate !== 'function') return;
      element.animate(
        [{ transform: `translate(${fromX}px, ${fromY}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    };
    const blockOffsets = new Map<string, { x: number; y: number }>();
    for (const entry of delta.blocks) {
      if (!entry.from || !entry.to) continue;
      blockOffsets.set(entry.groupId, {
        x: entry.from.x - entry.to.x,
        y: entry.from.y - entry.to.y,
      });
      const element = [...viewportElement.querySelectorAll<HTMLElement>('[data-group-id]')].find(
        (candidate) => candidate.dataset.groupId === entry.groupId,
      );
      animate(element, entry.from.x - entry.to.x, entry.from.y - entry.to.y);
    }
    for (const entry of delta.rows) {
      if (!entry.from || !entry.to) continue;
      const element = [
        ...viewportElement.querySelectorAll<HTMLElement>('[data-diff-map-row]'),
      ].find((candidate) => candidate.dataset.fileId === entry.fileId);
      const group = document.groups.find((candidate) => candidate.fileIds.includes(entry.fileId));
      const blockOffset = group ? blockOffsets.get(group.id) : undefined;
      animate(
        element,
        entry.from.x - entry.to.x - (blockOffset?.x ?? 0),
        entry.from.y - entry.to.y - (blockOffset?.y ?? 0),
      );
    }
  }

  $effect(() => {
    const request: DiffMapLayoutRequest = { document, viewport, rungOverride };
    if (previousRequest && !shouldRelayoutDiffMap(previousRequest, request)) {
      previousRequest = request;
      return;
    }
    const next = computeLayout(request);
    const delta = renderedLayout ? diffLayouts(renderedLayout, next) : undefined;
    renderedLayout = next;
    layout = next;
    previousRequest = request;
    if (delta) void tick().then(() => animateLayout(delta));
  });

  $effect(() => {
    if (!viewportElement) return;
    const update = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      if (!measured) {
        measured = true;
        previousRequest = undefined;
      }
      viewport = { width, height };
    };
    update(viewportElement.clientWidth, viewportElement.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(viewportElement);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (focusedPath && document.files.some((file) => file.path === focusedPath)) return;
    focusedPath = activePath ?? document.files[0]?.path;
  });

  function rowElement(path: string) {
    return [...(viewportElement?.querySelectorAll<HTMLElement>('[data-diff-map-row]') ?? [])].find(
      (element) => element.dataset.fileId === path,
    );
  }

  async function focusFile(path: string) {
    focusedPath = path;
    await tick();
    const element = rowElement(path);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function commitSelection(next: Set<string>) {
    selection = next;
    onSelectionChange?.(new Set(next));
  }

  function selectRange(anchor: string, target: string, additive = false) {
    const start = readingFiles.findIndex((file) => file.path === anchor);
    const end = readingFiles.findIndex((file) => file.path === target);
    if (start < 0 || end < 0) return;
    const next = additive ? new Set(selection) : new Set<string>();
    for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) {
      next.add(readingFiles[index].path);
    }
    commitSelection(next);
  }

  function activate(file: DiffMapFile, event: MouseEvent) {
    focusedPath = file.path;
    if (event.shiftKey) {
      const anchor = selectionAnchor ?? file.path;
      selectionAnchor ??= anchor;
      selectRange(anchor, file.path, event.metaKey || event.ctrlKey);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selection);
      if (next.has(file.path)) next.delete(file.path);
      else next.add(file.path);
      selectionAnchor = file.path;
      commitSelection(next);
      return;
    }
    selectionAnchor = file.path;
    onOpen(file, event);
  }

  function navigate(file: DiffMapFile, event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(file, event);
      return;
    }
    const direction =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const index = readingFiles.findIndex((candidate) => candidate.path === file.path);
    const target = readingFiles[Math.min(readingFiles.length - 1, Math.max(0, index + direction))];
    if (!target) return;
    if (event.shiftKey) {
      const anchor = selectionAnchor ?? file.path;
      selectionAnchor ??= anchor;
      selectRange(anchor, target.path, event.metaKey || event.ctrlKey);
    } else {
      selectionAnchor = target.path;
    }
    void focusFile(target.path);
  }

  function handleContainerKeydown(event: KeyboardEvent) {
    if (
      event.key !== '/' ||
      !filterable ||
      !rootElement?.contains(globalThis.document?.activeElement ?? null) ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    event.preventDefault();
    filterElement?.focus();
  }

  function jump(scroll: number) {
    viewportElement?.scrollTo?.({
      top: scroll,
      behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }
</script>

<svelte:window onkeydown={handleContainerKeydown} />

<div
  bind:this={rootElement}
  class="diff-map"
  role="region"
  aria-label={m.workspace_sidebarChanges_rootChangedFiles_label()}
>
  {#if filterable}
    <div class="toolbar">
      <h2>{fileCountLabel}</h2>
      <div class="filter">
        <span class="search-icon"><Fa icon={faSearch} /></span>
        <input
          bind:this={filterElement}
          bind:value={filter}
          type="search"
          aria-label={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
          placeholder={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
        />
      </div>
    </div>
  {/if}

  <div
    bind:this={viewportElement}
    class="viewport"
    class:viewport--overflow={layout?.overflow}
    onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
  >
    {#if layout}
      <div
        class="content"
        style:height={`${Math.max(layout.contentHeight, viewport.height)}px`}
        style:width={`${layout.overflow ? Math.max(0, viewport.width - RAIL_WIDTH) : viewport.width}px`}
      >
        {#each layout.sectionsPlaced as section (section.sectionId)}
          <div
            class="section-label"
            style:left={`${section.x}px`}
            style:top={`${section.y}px`}
            style:width={`${section.w}px`}
          >
            {section.label}
          </div>
        {/each}

        {#each layout.blocks as block (block.groupId)}
          {@const group = groupsById.get(block.groupId)}
          {#if group}
            <DiffMapBlock
              {block}
              {group}
              files={filesById}
              rung={layout.rung}
              {activePath}
              {selection}
              {focusedPath}
              filter={filter.trim().toLocaleLowerCase()}
              {pathFilter}
              {layers}
              onActivate={activate}
              onKeydown={navigate}
              onFocus={(file) => {
                selectionAnchor ??= focusedPath;
                focusedPath = file.path;
              }}
              onHover={(hovered) => onHoverGroup?.(hovered)}
            />
          {/if}
        {/each}
      </div>

      {#if layout.overflow}
        <DiffMapRail
          rows={layoutRows}
          files={filesById}
          contentHeight={layout.contentHeight}
          viewportHeight={viewport.height}
          viewportWidth={viewport.width}
          {scrollTop}
          {activePath}
          selected={selection}
          onJump={jump}
        />
      {/if}
    {/if}
  </div>
</div>

<style>
  .diff-map {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 160px;
    flex-direction: column;
    overflow: hidden;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  .toolbar {
    display: flex;
    height: 32px;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-bottom: 1px solid hsl(var(--border));
  }

  .toolbar h2 {
    min-width: 0;
    flex: 1;
    margin: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .filter {
    position: relative;
    width: min(148px, 48%);
    max-width: 220px;
    flex: none;
    transition: width var(--motion-fast) var(--ease-standard);
  }

  .filter:focus-within {
    width: min(220px, 60%);
  }

  .search-icon {
    position: absolute;
    z-index: 1;
    top: 50%;
    left: 7px;
    width: 10px;
    height: 10px;
    display: flex;
    align-items: center;
    color: hsl(var(--muted-foreground));
    font-size: 10px;
    pointer-events: none;
    transform: translateY(-50%);
  }

  .filter input {
    width: 100%;
    height: 24px;
    padding: 0 7px 0 23px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--muted) / 0.18);
    color: hsl(var(--foreground));
    font-size: 12px;
    transition:
      border-color var(--motion-fast) var(--ease-standard),
      background-color var(--motion-fast) var(--ease-standard);
  }

  .filter input:focus-visible {
    border-color: hsl(var(--ring));
    background: hsl(var(--background));
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .filter,
    .filter input {
      transition: none;
    }
  }

  .viewport {
    position: relative;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

  .viewport--overflow {
    overflow-y: auto;
    scrollbar-width: none;
  }

  .viewport--overflow::-webkit-scrollbar {
    display: none;
  }

  .content {
    position: relative;
  }

  .section-label {
    position: absolute;
    overflow: hidden;
    padding: 3px 4px;
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
