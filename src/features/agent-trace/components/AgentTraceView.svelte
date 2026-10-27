<script lang="ts">
  /**
   * Recent agent activity on one timeline: the days it covers, its totals, and the waterfall.
   * Presentational — the panel container feeds the trace from the store; the
   * preview scene feeds fixtures and a fixed clock.
   */
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { Button } from '$lib/components/ui/button';
  import AnimatedNumber from '$lib/components/ui/AnimatedNumber.svelte';
  import { EmptyState, ErrorState } from '$lib/components/patterns/screen';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { formatDaySeparator } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { Trace, TraceSpan } from '../trace-types';
  import {
    formatCostAmount,
    formatTraceCost,
    formatTraceDuration,
    formatTraceTokens,
    totalTokens,
  } from '../utils/trace-scale';
  import { pluralLabel } from '../utils/trace-labels';
  import TraceWaterfall from './TraceWaterfall.svelte';

  interface Props {
    /** `null` until the workspace has a turn. */
    trace: Trace | null;
    status: 'idle' | 'loading' | 'ready' | 'error';
    /** Fixed clock (epoch ms) for previews; the live clock runs otherwise. */
    clock?: number;
    initialExpanded?: readonly string[];
    initialCollapsed?: readonly string[];
    initialSelectedId?: string | null;
    /** The view is on screen; the live clock pauses while it is not. */
    active?: boolean;
    onRetry?: () => void;
    /** Opens the span's agent chat at the span. */
    onOpenChat?: (span: TraceSpan) => void;
  }

  let {
    trace,
    status,
    clock,
    initialExpanded = [],
    initialCollapsed = [],
    initialSelectedId = null,
    active = true,
    onRetry,
    onOpenChat,
  }: Props = $props();

  let width = $state(0);
  let waterfallWidth = $state(0);
  let tickNow = $state(Date.now());
  const now = $derived(clock ?? tickNow);

  // Expansion: roots start open; the user's toggles win.
  // svelte-ignore state_referenced_locally
  const opened = new SvelteSet<string>(initialExpanded);
  // svelte-ignore state_referenced_locally
  const closed = new SvelteSet<string>(initialCollapsed);
  // svelte-ignore state_referenced_locally
  let selectedId = $state<string | null>(initialSelectedId);
  let zoomId = $state<string | null>(null);
  let waterfall = $state<
    { reveal: (spanId: string) => Promise<void>; msPerPixel: () => number } | undefined
  >();
  /** Index of the last failure the error count revealed. */
  let errorCursor = -1;

  /** Placeholder rows shaped like a small waterfall while the first load runs. */
  const LOADING_ROWS = [
    { depth: 0, name: 45, left: 0, width: 88 },
    { depth: 1, name: 70, left: 1, width: 12 },
    { depth: 1, name: 55, left: 10, width: 38 },
    { depth: 1, name: 62, left: 13, width: 52 },
    { depth: 1, name: 48, left: 62, width: 24 },
  ];

  /**
   * Beside other roots, a root with more tool calls than this starts collapsed
   * and its bar summarizes them. A sole root always starts open.
   */
  const AUTO_EXPAND_LIMIT = 40;

  const expanded = $derived.by(() => {
    const set = new Set<string>(opened);
    const roots = trace?.roots ?? [];
    for (const root of roots) {
      if (closed.has(root.id)) continue;
      // Its own tool calls, nested under turn rows when it has several turns.
      if (roots.length === 1 || (root.toolCount ?? 0) <= AUTO_EXPAND_LIMIT) set.add(root.id);
    }
    return set;
  });

  /** Deeper rows open on their own, level by level, while the trace fits in this many rows. */
  const AUTO_OPEN_ROWS = 40;

  /** Rows to open so a small trace shows everything; closed rows stay closed. */
  function autoOpenIds(roots: readonly TraceSpan[], isOpen: (id: string) => boolean): string[] {
    const ids: string[] = [];
    let shown = roots.length;
    let level: TraceSpan[] = [];
    for (const root of roots) {
      if (!isOpen(root.id)) continue;
      shown += root.children.length;
      const latestFirst = [...root.children].reverse();
      // The newest turn always opens, so the latest work is in view.
      const latest = latestFirst[0];
      if (latest?.children.length && !closed.has(latest.id) && !isOpen(latest.id)) {
        ids.push(latest.id);
      }
      level.push(...latestFirst);
    }
    while (level.length > 0) {
      const next: TraceSpan[] = [];
      for (const span of level) {
        if (span.children.length === 0 || closed.has(span.id)) continue;
        if (!isOpen(span.id) && !ids.includes(span.id)) {
          if (shown + span.children.length > AUTO_OPEN_ROWS) continue;
          ids.push(span.id);
        }
        shown += span.children.length;
        next.push(...[...span.children].reverse());
      }
      level = next;
    }
    return ids;
  }

  // Rows opened this way stay open as live activity grows past the budget.
  $effect(() => {
    if (!trace) return;
    for (const id of autoOpenIds(trace.roots, (id) => expanded.has(id))) opened.add(id);
  });

  // Live clock while something runs and the view is visible (a hidden tab stays
  // mounted for a while). It ticks about once per pixel the now line moves, and
  // at least once a second for the running durations.
  $effect(() => {
    if (clock !== undefined || !trace?.live || !active) return;
    let frame = 0;
    const loop = () => {
      const at = Date.now();
      if (at - tickNow >= Math.min(1000, waterfall?.msPerPixel() ?? 1000)) tickNow = at;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    if (clock !== undefined) return;
    // Day names (`Today`, `Yesterday`) stay right past midnight while nothing runs.
    const timer = setInterval(() => {
      if (!trace?.live) tickNow = Date.now();
    }, 30_000);
    return () => clearInterval(timer);
  });

  /** `Today`, `Yesterday`, a weekday, then a date. */
  function dayLabel(ms: number): string {
    return formatDaySeparator(ms, { now: new Date(now) });
  }

  /** The days the timeline covers: `Today`, or `Friday – Today`. */
  const title = $derived.by(() => {
    if (!trace) return '';
    const first = dayLabel(trace.start);
    const last = dayLabel(trace.windows[trace.windows.length - 1]?.start ?? trace.start);
    return first === last ? first : m.agentTrace_range_label({ from: first, to: last });
  });

  function toggle(spanId: string, open?: boolean) {
    const isOpen = expanded.has(spanId);
    const next = open ?? !isOpen;
    if (next === isOpen) return;
    if (next) {
      opened.add(spanId);
      closed.delete(spanId);
    } else {
      opened.delete(spanId);
      closed.add(spanId);
    }
    if (!next && selectedId !== null && selectedId !== spanId) {
      // Keep details only for rows that stay visible.
      const stillVisible = isDescendantVisible(selectedId, spanId);
      if (!stillVisible) selectedId = null;
    }
  }

  function isDescendantVisible(spanId: string, collapsedId: string): boolean {
    let found: boolean | undefined;
    const walk = (spans: readonly TraceSpan[], insideCollapsed: boolean) => {
      for (const span of spans) {
        if (found !== undefined) return;
        if (span.id === spanId) {
          found = !insideCollapsed;
          return;
        }
        walk(span.children, insideCollapsed || span.id === collapsedId);
      }
    };
    walk(trace?.roots ?? [], false);
    return found ?? false;
  }

  function zoom(spanId: string | null) {
    zoomId = spanId;
    if (spanId) toggle(spanId, true);
  }

  interface Failure {
    span: TraceSpan;
    ancestors: string[];
  }

  /** The deepest failed spans, in tree order. */
  function collectFailures(spans: readonly TraceSpan[], ancestors: string[], out: Failure[]) {
    for (const span of spans) {
      const failedChild = span.children.some((child) => child.status === 'failed');
      if (span.status === 'failed' && !failedChild) out.push({ span, ancestors });
      collectFailures(span.children, [...ancestors, span.id], out);
    }
    return out;
  }

  const failures = $derived(trace ? collectFailures(trace.roots, [], []) : []);

  /** Each click on the error count opens the next failure. */
  function showNextError() {
    if (failures.length === 0) return;
    errorCursor = (errorCursor + 1) % failures.length;
    const failure = failures[errorCursor];
    for (const id of failure.ancestors) toggle(id, true);
    if (zoomId !== null && !failure.ancestors.includes(zoomId)) zoomId = null;
    selectedId = failure.span.id;
    void waterfall?.reveal(failure.span.id);
  }

  /** Time agents were working, without the idle time between bursts. */
  const durationMs = $derived(
    trace?.windows.reduce((sum, window) => sum + (window.end ?? now) - window.start, 0) ?? 0,
  );
  const cost = $derived(formatTraceCost(trace?.stats.usage));
  const tokens = $derived(totalTokens(trace?.stats.usage));
</script>

<div
  class="agent-trace flex min-h-full flex-col gap-5 px-5 pt-4 pb-6"
  bind:clientWidth={width}
  data-live={trace?.live ? 'true' : 'false'}
>
  {#if !trace}
    {#if status === 'loading' || status === 'idle'}
      <div class="flex flex-col gap-5" role="status" aria-label={m.agentTrace_loading_label()}>
        <div class="flex flex-col gap-2.5 py-1">
          <Skeleton class="h-3.5 w-56 max-w-[70%]" />
          <Skeleton class="h-3 w-80 max-w-[90%]" />
        </div>
        <div class="flex flex-col pt-6">
          {#each LOADING_ROWS as row, index (index)}
            <div class="grid h-8 grid-cols-[36%_1fr] items-center">
              <div class="pr-3" style:padding-left="{row.depth * 20}px">
                <Skeleton class="h-3" style="width: {row.name}%" />
              </div>
              <div class="relative h-2">
                <Skeleton
                  class="absolute inset-y-0 rounded-full"
                  style="left: {row.left}%; width: {row.width}%"
                />
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="flex flex-1 items-center justify-center">
        {#if status === 'error'}
          <ErrorState density="compact" {onRetry} retryLabel={m.ui_errorToast_retry_label()}>
            {#snippet message()}{m.agentTrace_error_label()}{/snippet}
          </ErrorState>
        {:else}
          <EmptyState density="compact">
            {#snippet title()}{m.agentTrace_empty_title()}{/snippet}
            {#snippet description()}{m.agentTrace_empty_description()}{/snippet}
          </EmptyState>
        {/if}
      </div>
    {/if}
  {:else}
    <header class="flex min-w-0 flex-col gap-1">
      <h2 class="min-w-0 truncate type-body font-medium text-foreground">{title}</h2>

      <p
        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 type-caption text-muted-foreground tabular-nums"
        data-trace-stats
      >
        {#if trace.live}
          <span
            class="inline-flex h-5 items-center gap-1.5 rounded-full bg-primary px-2 font-medium text-primary-foreground"
            data-trace-live
          >
            <span
              class="size-1.5 animate-pulse rounded-full bg-primary-foreground motion-reduce:animate-none"
              aria-hidden="true"
            ></span>
            {m.agentTrace_status_live_label()}
          </span>
        {/if}
        <span class="text-foreground" data-trace-duration>{formatTraceDuration(durationMs)}</span>
        {#if cost}
          <span class="text-foreground">
            <AnimatedNumber
              value={trace.stats.usage?.cost?.amount ?? 0}
              format={(amount) =>
                formatCostAmount(amount, trace.stats.usage?.cost?.currency ?? 'USD')}
            />
          </span>
        {/if}
        {#if tokens > 0}
          <span>
            <AnimatedNumber
              value={tokens}
              format={(value) =>
                m.agentTrace_summary_tokens_label({ value: formatTraceTokens(value) })}
            />
          </span>
        {/if}
        {#if trace.stats.agents > 1}
          <span>{pluralLabel(trace.stats.agents, 'agents')}</span>
        {/if}
        {#if trace.stats.toolCalls > 0}
          <span>{pluralLabel(trace.stats.toolCalls, 'toolCalls')}</span>
        {/if}
        {#if trace.stats.errors > 0}
          <Button
            variant="plain"
            class="h-auto px-0 text-danger underline-offset-2 hover:underline"
            onclick={showNextError}
            data-trace-errors
          >
            {pluralLabel(trace.stats.errors, 'errors')}
          </Button>
        {/if}
      </p>
    </header>

    <div bind:clientWidth={waterfallWidth} class="-mx-3">
      {#if waterfallWidth > 0}
        <TraceWaterfall
          bind:this={waterfall}
          {trace}
          {now}
          width={waterfallWidth}
          {expanded}
          {selectedId}
          {zoomId}
          onToggle={toggle}
          onSelect={(spanId) => (selectedId = spanId)}
          onZoom={zoom}
          {onOpenChat}
        />
      {/if}
    </div>
  {/if}
</div>
