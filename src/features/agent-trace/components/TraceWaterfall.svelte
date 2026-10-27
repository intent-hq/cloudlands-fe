<script lang="ts">
  /**
   * Span tree + time axis for the trace. Rows are a keyboard tree (roving
   * focus); clicking a row (or Enter) opens its place in the chat and its
   * details next to its bar. One hover surface and one selection surface
   * glide between rows.
   */
  import { tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faChevronRight,
    faMagnifyingGlassMinus,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { formatDaySeparator } from '$lib/i18n/format';
  import { fly } from '$lib/motion';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { Trace, TraceSpan } from '../trace-types';
  import { spanLabel } from '../utils/trace-labels';
  import {
    formatTraceCost,
    formatTraceDuration,
    formatTraceTick,
    traceTimeMap,
  } from '../utils/trace-scale';
  import TraceDetails from './TraceDetails.svelte';

  interface Props {
    trace: Trace;
    now: number;
    /** Width of the waterfall in pixels. */
    width: number;
    expanded: ReadonlySet<string>;
    selectedId: string | null;
    /** The span the time axis is zoomed to; `null` shows the whole trace. */
    zoomId: string | null;
    onToggle: (spanId: string, open?: boolean) => void;
    onSelect: (spanId: string | null) => void;
    onZoom: (spanId: string | null) => void;
    /** Opens the span's agent chat at the span. */
    onOpenChat?: (span: TraceSpan) => void;
  }

  let {
    trace,
    now,
    width,
    expanded,
    selectedId,
    zoomId,
    onToggle,
    onSelect,
    onZoom,
    onOpenChat,
  }: Props = $props();

  /** Matches `h-8`; the hover and selection surfaces move in whole rows. */
  const ROW_HEIGHT = 32;
  const ROW_INSET = 12;
  const MIN_BAR_PX = 4;
  const TICK_SPACING_PX = 76;
  /** Rough caption glyph width, to keep tick labels off the day names. */
  const LABEL_CHAR_PX = 7;

  interface Row {
    span: TraceSpan;
    depth: number;
    parentId: string | null;
    hasChildren: boolean;
    open: boolean;
  }

  const narrow = $derived(width < 560);
  const spanColumn = $derived(
    Math.round(Math.min(340, Math.max(156, width * (narrow ? 0.48 : 0.36)))),
  );
  const indent = $derived(narrow ? 12 : 16);
  /** Secondary text yields first when the span column is tight. */
  const showDetail = $derived(spanColumn >= 200);
  const timelineWidth = $derived(Math.max(80, width - spanColumn));
  const maxTicks = $derived(Math.max(2, Math.min(7, Math.floor(timelineWidth / TICK_SPACING_PX))));
  const zoomSpan = $derived(zoomId ? findSpan(trace.roots, zoomId) : null);
  const viewFrom = $derived(zoomSpan ? zoomSpan.start : trace.start);
  const viewTo = $derived(zoomSpan ? (zoomSpan.end ?? now) : (trace.end ?? now));
  const windows = $derived(
    trace.windows.map((window) => ({ start: window.start, end: window.end ?? now })),
  );
  const timeMap = $derived(traceTimeMap(windows, viewFrom, viewTo, timelineWidth, maxTicks));
  const nowPosition = $derived(timeMap.at(now));

  /** Local midnight of `ms`, to find where each day starts. */
  function dayOf(ms: number): number {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  /** Day names where each day's first burst starts, when the view spans days. */
  const dayMarks = $derived.by(() => {
    const shown = windows.filter((window) => window.end > viewFrom && window.start < viewTo);
    if (shown.length === 0 || dayOf(shown[0].start) === dayOf(shown[shown.length - 1].start)) {
      return [];
    }
    const marks: { position: number; label: string }[] = [];
    let previous: number | null = null;
    for (const window of shown) {
      const day = dayOf(Math.max(window.start, viewFrom));
      if (day !== previous) {
        marks.push({
          position: Math.max(0, timeMap.at(Math.max(window.start, viewFrom))),
          label: formatDaySeparator(day, { now: new Date(now) }),
        });
      }
      previous = day;
    }
    return marks;
  });

  /** Tick labels that keep clear of the day names, which win. */
  const tickLabels = $derived(
    timeMap.ticks.filter((tick) => {
      const start = (tick.position / 100) * timelineWidth;
      const end = start + 8 + formatTraceTick(tick.offsetMs).length * LABEL_CHAR_PX;
      return dayMarks.every((mark) => {
        const markStart = (mark.position / 100) * timelineWidth;
        return end < markStart || start > markStart + 8 + mark.label.length * LABEL_CHAR_PX;
      });
    }),
  );
  const nowVisible = $derived(trace.live && nowPosition >= 0 && nowPosition <= 100);

  function findSpan(spans: readonly TraceSpan[], spanId: string): TraceSpan | null {
    for (const span of spans) {
      if (span.id === spanId) return span;
      const nested = findSpan(span.children, spanId);
      if (nested) return nested;
    }
    return null;
  }

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (spans: readonly TraceSpan[], depth: number, parentId: string | null) => {
      for (const span of spans) {
        const hasChildren = span.children.length > 0;
        const open = hasChildren && expanded.has(span.id);
        out.push({ span, depth, parentId, hasChildren, open });
        if (open) walk(span.children, depth + 1, span.id);
      }
    };
    walk(trace.roots, 0, null);
    return out;
  });

  const indexById = $derived(new Map(rows.map((row, index) => [row.span.id, index])));
  let focusedId = $state<string | null>(null);
  const tabStopId = $derived(
    focusedId && indexById.has(focusedId) ? focusedId : (rows[0]?.span.id ?? null),
  );

  const rowEls: Record<string, HTMLElement | undefined> = $state({});
  const barEls: Record<string, HTMLElement | undefined> = $state({});
  let treeEl = $state<HTMLElement | undefined>();
  /** The details card stays inside the overview's pane, clear of a chat beside it. */
  const paneEl = $derived(treeEl?.closest<HTMLElement>('[data-panel-id]') ?? undefined);

  const selectedIndex = $derived(selectedId !== null ? (indexById.get(selectedId) ?? -1) : -1);
  const selectedSpan = $derived(selectedIndex >= 0 ? rows[selectedIndex].span : null);

  // Hover preview: one surface that glides between rows. It jumps (no slide)
  // when the pointer re-enters, so a new session never sweeps across the list.
  let hoverIndex = $state<number | null>(null);
  let hoverY = $state(0);
  let hoverJump = $state(true);

  function showHover(index: number) {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    if (hoverIndex === null) {
      hoverJump = true;
      hoverY = clamped * ROW_HEIGHT;
      requestAnimationFrame(() => (hoverJump = false));
    } else hoverY = clamped * ROW_HEIGHT;
    hoverIndex = clamped;
  }

  function onPointerMove(event: PointerEvent) {
    if (!treeEl || rows.length === 0) return;
    const top = treeEl.getBoundingClientRect().top;
    const index = Math.floor((event.clientY - top) / ROW_HEIGHT);
    if (index < 0 || index >= rows.length) {
      hoverIndex = null;
      return;
    }
    if (index !== hoverIndex) showHover(index);
  }

  /** Unclamped, so a zoomed axis clips bars at its edges instead of squashing them. */
  function geometry(span: TraceSpan) {
    const left = timeMap.at(span.start);
    const right = timeMap.at(span.end ?? now);
    return { left, width: Math.max(0, right - left), outside: right < 0 || left > 100 };
  }

  /** Cuts a bar at each squeezed gap it crosses, and fades a running bar's end. */
  function barMask(geo: { left: number; width: number }, running: boolean): string {
    const right = geo.left + geo.width;
    const relative = (position: number) => ((position - geo.left) / geo.width) * 100;
    const stops = ['black'];
    for (const gap of timeMap.gaps) {
      if (gap.from <= geo.left || gap.to >= right) continue;
      const from = relative(gap.from);
      const to = relative(gap.to);
      stops.push(`black ${from}%`, `transparent ${from}%`, `transparent ${to}%`, `black ${to}%`);
    }
    if (stops.length === 1 && !running) return '';
    stops.push(running ? 'black calc(100% - 16px), transparent' : 'black');
    return `mask-image: linear-gradient(to right, ${stops.join(', ')});`;
  }

  /** Working time inside a span; idle time between bursts does not count. */
  function activeDuration(span: TraceSpan): number {
    const end = span.end ?? now;
    let total = 0;
    for (const window of windows) {
      total += Math.max(0, Math.min(end, window.end) - Math.max(span.start, window.start));
    }
    return total > 0 ? total : end - span.start;
  }

  function barText(span: TraceSpan): string {
    const cost = span.kind === 'tool' ? undefined : formatTraceCost(span.usage);
    if (span.startUnknown) return cost ?? '';
    const duration = formatTraceDuration(activeDuration(span));
    return cost ? m.agentTrace_bar_durationCost_label({ duration, cost }) : duration;
  }

  /** Right of the bar when it fits, else left; hidden when neither fits. */
  function labelSide(geo: { left: number; width: number }, text: string) {
    const labelPx = text.length * 7.2 + 14;
    const visibleLeft = Math.max(0, geo.left);
    const visibleRight = Math.min(100, geo.left + geo.width);
    if ((timelineWidth * (100 - visibleRight)) / 100 >= labelPx) return 'right';
    if ((timelineWidth * visibleLeft) / 100 >= labelPx) return 'left';
    return 'none';
  }

  /** Placed with the axis map, so squeezed gaps inside the bar stay aligned. */
  function segmentStyle(
    segment: TraceSpan['segments'][number],
    geo: { left: number; width: number },
  ) {
    const total = Math.max(0.0001, geo.width);
    const left = ((timeMap.at(segment.start) - geo.left) / total) * 100;
    const widthPct = ((timeMap.at(segment.end ?? now) - timeMap.at(segment.start)) / total) * 100;
    return `left: ${Math.max(0, left)}%; width: max(2px, ${Math.max(0, widthPct)}%);`;
  }

  async function focusRow(spanId: string) {
    focusedId = spanId;
    const index = indexById.get(spanId);
    if (index !== undefined) showHover(index);
    await tick();
    rowEls[spanId]?.focus();
  }

  function selectRow(spanId: string) {
    onSelect(selectedId === spanId ? null : spanId);
    focusedId = spanId;
  }

  /** Shows the span in its chat; its details stay open beside the bar. */
  function openRow(span: TraceSpan) {
    onSelect(span.id);
    focusedId = span.id;
    onOpenChat?.(span);
  }

  function onRowKeydown(event: KeyboardEvent, index: number) {
    const row = rows[index];
    if (!row) return;
    const move = (target: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, target))];
      if (!next) return;
      void focusRow(next.span.id);
      if (selectedId !== null) onSelect(next.span.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row.hasChildren && !row.open) onToggle(row.span.id, true);
        else if (row.open) move(index + 1);
        break;
      case 'ArrowLeft':
        if (row.open) onToggle(row.span.id, false);
        else if (row.parentId) move(indexById.get(row.parentId) ?? index);
        break;
      case 'Enter':
        openRow(row.span);
        break;
      case ' ':
        selectRow(row.span.id);
        break;
      case 'Escape':
        if (selectedId !== null) onSelect(null);
        else if (zoomSpan) onZoom(null);
        else return;
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function closeDetails() {
    const id = selectedId;
    onSelect(null);
    if (id) void focusRow(id);
  }

  /**
   * The card closed on its own (outside click, focus moving away, Escape). Focus
   * returns to the row only from inside the card; an outside click already put
   * it where the user clicked, such as a chat composer beside the overview.
   */
  function dismissDetails() {
    const focused = document.activeElement;
    if (focused instanceof Element && focused.closest('[data-trace-details]')) closeDetails();
    else onSelect(null);
  }

  /** Agents and turns long enough to read more when the axis fits them. */
  function canZoom(span: TraceSpan): boolean {
    return span.children.length > 0 && span.id !== zoomId && (span.end ?? now) - span.start >= 1000;
  }

  function zoomInto(spanId: string) {
    onSelect(null);
    onZoom(spanId);
    void focusRow(spanId);
  }

  function scrollParentOf(element: HTMLElement): HTMLElement | null {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
  }

  /** Axis time per pixel, so the live clock ticks only when something moves. */
  export function msPerPixel(): number {
    return timeMap.msPerPx;
  }

  /**
   * Centers a row selected from outside the tree, once its ancestors render.
   * Only the panel's own scroller moves; `scrollIntoView` would also shift the app.
   */
  export async function reveal(spanId: string) {
    await tick();
    const rowEl = rowEls[spanId];
    const scroller = rowEl ? scrollParentOf(rowEl) : null;
    if (!rowEl || !scroller) return;
    const view = scroller.getBoundingClientRect();
    const target = rowEl.getBoundingClientRect();
    scroller.scrollTop += target.top - view.top - (view.height - target.height) / 2;
  }
</script>

<div class="trace-waterfall relative">
  <!-- Axis -->
  <div
    class="sticky top-0 z-10 grid h-6 items-end bg-background"
    style="grid-template-columns: {spanColumn}px 1fr"
    data-trace-axis
  >
    <div class="flex min-w-0 items-end" style="padding-left: {ROW_INSET - 10}px">
      {#if zoomSpan}
        <Button
          variant="ghost-light"
          size="compact"
          class="min-w-0"
          truncateLabel
          onclick={() => onZoom(null)}
          data-trace-zoom-reset
        >
          {#snippet leadingIcon()}<Fa icon={faMagnifyingGlassMinus} size="xs" />{/snippet}
          {m.agentTrace_zoom_reset_label()}
        </Button>
      {/if}
    </div>
    <div class="relative h-full overflow-hidden" aria-hidden="true">
      {#each tickLabels as tick (tick.offsetMs)}
        <span
          class="trace-tick absolute bottom-1 type-caption text-muted-foreground tabular-nums whitespace-nowrap"
          style="left: {tick.position}%"
        >
          {formatTraceTick(tick.offsetMs)}
        </span>
      {/each}
      {#each dayMarks as mark (mark.position)}
        <span
          class="trace-tick absolute bottom-1 type-caption font-medium text-foreground whitespace-nowrap"
          style="left: {mark.position}%"
          data-trace-day
        >
          {mark.label}
        </span>
      {/each}
    </div>
  </div>

  <div class="relative">
    <div
      bind:this={treeEl}
      role="tree"
      tabindex="-1"
      aria-label={m.agentTrace_waterfall_ariaLabel()}
      class="relative flex flex-col"
      onpointermove={onPointerMove}
      onpointerleave={() => (hoverIndex = null)}
    >
      <div
        class="trace-surface pointer-events-none absolute inset-x-0 top-0 h-8 rounded-(--radius-medium) bg-selected"
        class:trace-surface--hidden={selectedIndex < 0}
        style="transform: translateY({Math.max(0, selectedIndex) * ROW_HEIGHT}px)"
        aria-hidden="true"
      ></div>
      <div
        class="trace-surface pointer-events-none absolute inset-x-0 top-0 h-8 rounded-(--radius-medium) bg-hover"
        class:trace-surface--hidden={hoverIndex === null}
        class:trace-surface--jump={hoverJump}
        style="transform: translateY({hoverY}px)"
        aria-hidden="true"
      ></div>

      {#each rows as row, index (row.span.id)}
        {@const span = row.span}
        {@const label = spanLabel(span)}
        {@const geo = geometry(span)}
        {@const text = barText(span)}
        {@const side = geo.outside || !text ? 'none' : labelSide(geo, text)}
        {@const showSegments = !row.open && span.segments.length > 0}
        {@const showTrack = row.open || (span.kind === 'agent' && showSegments)}
        <div
          bind:this={rowEls[span.id]}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={row.hasChildren ? row.open : undefined}
          aria-selected={selectedId === span.id}
          tabindex={tabStopId === span.id ? 0 : -1}
          data-trace-row={span.id}
          data-kind={span.kind}
          data-status={span.status}
          class="trace-row group/row relative grid h-8 scroll-mt-6 cursor-default rounded-(--radius-medium) outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
          style="grid-template-columns: {spanColumn}px 1fr"
          in:fly={{ tier: 'fast', distance: -4, axis: 'y' }}
          onclick={() => openRow(span)}
          onfocus={() => (focusedId = span.id)}
          onkeydown={(event) => onRowKeydown(event, index)}
        >
          <div
            class="flex min-w-0 items-center gap-1.5 pr-3"
            style="padding-left: {ROW_INSET + row.depth * indent}px"
          >
            {#if row.hasChildren}
              <Button
                variant="plain"
                size="icon-compact"
                tabindex={-1}
                class="-ml-1 size-4 shrink-0 text-muted-foreground group-hover/row:text-foreground"
                aria-label={row.open
                  ? m.agentTrace_row_collapse_ariaLabel({ name: label.name })
                  : m.agentTrace_row_expand_ariaLabel({ name: label.name })}
                onclick={(event: MouseEvent) => {
                  event.stopPropagation();
                  onToggle(span.id);
                }}
              >
                <Fa
                  icon={faChevronRight}
                  size="xs"
                  class="transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {row.open
                    ? 'rotate-90'
                    : ''}"
                />
              </Button>
            {:else}
              <span class="-ml-1 w-4 shrink-0" aria-hidden="true"></span>
            {/if}
            <span
              class="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
              aria-hidden="true"
            >
              {#if span.kind === 'agent'}
                <AgentAvatar agentId={span.agentId} variant="compact" />
              {:else if label.icon}
                <Fa icon={label.icon} size="xs" />
              {/if}
            </span>
            <span
              class="min-w-0 shrink truncate type-caption {span.contextOnly
                ? 'text-muted-foreground'
                : 'text-foreground'}"
              title={label.name}
              data-trace-name>{label.name}</span
            >
            {#if label.detail && showDetail}
              <span class="min-w-0 shrink-[3] truncate type-caption text-muted-foreground"
                >{label.detail}</span
              >
            {/if}
            {#if span.status === 'running' && span.kind !== 'agent'}
              <IntentMarkLoader size={12} class="shrink-0" />
            {:else if span.status === 'failed'}
              <Fa icon={faTriangleExclamation} size="xs" class="shrink-0 text-danger" />
            {/if}
          </div>

          <div class="relative min-w-0 overflow-hidden" data-trace-timeline>
            <div
              bind:this={barEls[span.id]}
              class="trace-bar absolute top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full transition-[left,width] duration-spring-moderate ease-spring-moderate motion-reduce:transition-none"
              class:trace-bar--track={showTrack}
              class:trace-bar--turn={!showTrack && span.kind === 'turn'}
              class:trace-bar--tool={!showTrack && span.kind === 'tool'}
              class:trace-bar--failed={!showTrack && span.status === 'failed'}
              class:trace-bar--live={!showTrack && span.status === 'running'}
              class:trace-bar--running={span.status === 'running'}
              data-trace-bar={span.id}
              style="left: {geo.left}%; width: max({MIN_BAR_PX}px, {geo.width}%); {barMask(
                geo,
                span.status === 'running',
              )}"
            >
              {#if showSegments}
                {#each span.segments as segment, segmentIndex (segmentIndex)}
                  <span
                    class="absolute inset-y-0"
                    class:trace-segment--turn={segment.kind === 'turn' && !segment.failed}
                    class:trace-segment--tool={segment.kind === 'tool' && !segment.failed}
                    class:trace-segment--failed={segment.failed}
                    class:trace-segment--live={segment.end === null && !segment.failed}
                    style={segmentStyle(segment, geo)}
                  ></span>
                {/each}
              {/if}
            </div>
            {#if side !== 'none'}
              <span
                class="absolute top-1/2 -translate-y-1/2 type-caption text-muted-foreground tabular-nums whitespace-nowrap transition-[left,right] duration-spring-moderate ease-spring-moderate motion-reduce:transition-none"
                style={side === 'right'
                  ? `left: calc(${geo.left}% + max(${MIN_BAR_PX}px, ${geo.width}%) + 8px)`
                  : `right: calc(${100 - geo.left}% + 8px)`}
              >
                {text}
              </span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <!-- Grid and now line -->
    <div
      class="pointer-events-none absolute inset-y-0 right-0"
      style="left: {spanColumn}px"
      aria-hidden="true"
    >
      {#each timeMap.ticks as tick (tick.offsetMs)}
        <span class="trace-gridline absolute inset-y-0 w-px" style="left: {tick.position}%"></span>
      {/each}
      {#if nowVisible}
        <span
          class="trace-now-line absolute inset-y-0 w-px"
          style="left: {nowPosition}%"
          data-trace-now
        >
          <span
            class="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary-ink"
          ></span>
        </span>
      {/if}
    </div>
  </div>
</div>

<Popover.Root
  open={selectedSpan !== null}
  onOpenChange={(open) => {
    if (!open) dismissDetails();
  }}
>
  {#if selectedSpan}
    <Popover.Content
      customAnchor={barEls[selectedSpan.id] ?? rowEls[selectedSpan.id] ?? null}
      side="bottom"
      align="start"
      sideOffset={10}
      collisionBoundary={paneEl}
      trapFocus={false}
      class="p-0"
      onOpenAutoFocus={(event: Event) => event.preventDefault()}
      onCloseAutoFocus={(event: Event) => event.preventDefault()}
      onInteractOutside={(event: Event) => {
        const target = event.target as Node | null;
        if (target && treeEl?.contains(target)) event.preventDefault();
      }}
    >
      <TraceDetails
        span={selectedSpan}
        durationMs={selectedSpan.startUnknown ? null : activeDuration(selectedSpan)}
        onClose={closeDetails}
        onZoom={canZoom(selectedSpan) ? () => zoomInto(selectedSpan.id) : undefined}
      />
    </Popover.Content>
  {/if}
</Popover.Root>

<style>
  .trace-tick {
    transform: translateX(4px);
    transition: left var(--spring-moderate) var(--spring-moderate-ease);
  }
  .trace-gridline {
    background: hsl(var(--foreground) / 0.06);
    transition: left var(--spring-moderate) var(--spring-moderate-ease);
  }
  .trace-now-line {
    background: hsl(var(--primary-ink) / 0.7);
    transition: left var(--spring-moderate) var(--spring-moderate-ease);
  }
  .trace-surface {
    transition:
      transform var(--spring-moderate) var(--spring-moderate-ease),
      opacity var(--spring-fast) var(--spring-fast-ease);
  }
  .trace-surface--jump {
    transition: opacity var(--spring-fast) var(--spring-fast-ease);
  }
  .trace-surface--hidden {
    opacity: 0;
  }
  /*
   * Neutral foundation; the citrus accent marks only what is running now.
   * Fills are opaque so overlapping tool calls do not stack darker.
   */
  .trace-bar--track {
    background: hsl(var(--foreground) / 0.07);
  }
  .trace-bar--turn,
  .trace-segment--turn {
    background: color-mix(in srgb, hsl(var(--foreground)) 16%, hsl(var(--background)));
  }
  .trace-bar--tool,
  .trace-segment--tool {
    background: color-mix(in srgb, hsl(var(--foreground)) 42%, hsl(var(--background)));
  }
  .trace-bar--failed,
  .trace-segment--failed {
    background: color-mix(in srgb, hsl(var(--danger)) 65%, hsl(var(--danger-background)));
  }
  .trace-bar--live,
  .trace-segment--live {
    background: color-mix(in oklab, hsl(var(--primary)) 88%, hsl(var(--foreground)));
  }
  @container style(--motion-reduced: 1) {
    .trace-tick,
    .trace-gridline,
    .trace-now-line,
    .trace-surface {
      transition: none;
    }
  }
</style>
