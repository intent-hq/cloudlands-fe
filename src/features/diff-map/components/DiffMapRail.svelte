<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiffMapLayoutFileRow } from '../layout/layout-diff-map';
  import type { DiffMapFile, DiffMapFileStatus } from '../model/types';

  interface RailBucket {
    index: number;
    status: DiffMapFileStatus;
    active: boolean;
    selected: boolean;
  }

  interface Props {
    rows: DiffMapLayoutFileRow[];
    files: ReadonlyMap<string, DiffMapFile>;
    contentHeight: number;
    viewportHeight: number;
    viewportWidth: number;
    scrollTop: number;
    activePath?: string;
    selected: ReadonlySet<string>;
    controlsId: string;
    onJump: (scrollTop: number) => void;
  }

  let {
    rows,
    files,
    contentHeight,
    viewportHeight,
    viewportWidth,
    scrollTop,
    activePath,
    selected,
    controlsId,
    onJump,
  }: Props = $props();

  const safeHeight = $derived(Math.max(1, contentHeight));
  const maxScroll = $derived(Math.max(0, contentHeight - viewportHeight));
  const scrollValue = $derived(Math.min(maxScroll, Math.max(0, scrollTop)));
  const windowTop = $derived((scrollValue / safeHeight) * 100);
  const windowHeight = $derived(Math.min(100, (viewportHeight / safeHeight) * 100));
  const filesAbove = $derived(rows.filter((row) => row.y + row.h <= scrollTop).length);
  const filesBelow = $derived(rows.filter((row) => row.y >= scrollTop + viewportHeight).length);
  const accessibleLabel = $derived(
    m.diffMap_overflowRail_ariaLabel({
      above: formatInteger(filesAbove),
      below: formatInteger(filesBelow),
    }),
  );
  const bucketCount = $derived(
    Math.min(24, rows.length, Math.max(1, Math.floor(Math.max(0, viewportHeight - 8) / 12))),
  );
  const buckets = $derived.by(() => {
    const grouped = new Map<
      number,
      { statuses: Map<DiffMapFileStatus, number>; active: boolean; selected: boolean }
    >();
    for (const row of rows) {
      const center = (row.y + row.h / 2) / safeHeight;
      const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(center * bucketCount)));
      const bucket = grouped.get(index) ?? {
        statuses: new Map<DiffMapFileStatus, number>(),
        active: false,
        selected: false,
      };
      const file = files.get(row.fileId);
      const status = file?.status ?? 'modified';
      bucket.statuses.set(status, (bucket.statuses.get(status) ?? 0) + 1);
      bucket.active ||= file?.path === activePath;
      bucket.selected ||= file ? selected.has(file.path) : false;
      grouped.set(index, bucket);
    }
    return [...grouped.entries()].map(([index, bucket]): RailBucket => ({
      index,
      status: [...bucket.statuses.entries()].reduce((dominant, candidate) =>
        candidate[1] > dominant[1] ? candidate : dominant,
      )[0],
      active: bucket.active,
      selected: bucket.selected,
    }));
  });

  function jump(event: MouseEvent) {
    const bounds =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.getBoundingClientRect()
        : null;
    if (!bounds || bounds.height === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    onJump(Math.min(maxScroll, Math.max(0, ratio * contentHeight - viewportHeight / 2)));
  }

  function handleKeydown(event: KeyboardEvent) {
    const bucketStep = safeHeight / Math.max(1, bucketCount);
    const target =
      event.key === 'ArrowDown'
        ? scrollValue + bucketStep
        : event.key === 'ArrowUp'
          ? scrollValue - bucketStep
          : event.key === 'PageDown'
            ? scrollValue + viewportHeight
            : event.key === 'PageUp'
              ? scrollValue - viewportHeight
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? maxScroll
                  : undefined;
    if (target === undefined) return;
    event.preventDefault();
    onJump(Math.min(maxScroll, Math.max(0, target)));
  }
</script>

{#if contentHeight > viewportHeight}
  <Button
    variant="ghost"
    class="rail h-auto min-h-0 w-auto"
    role="scrollbar"
    aria-label={accessibleLabel}
    aria-controls={controlsId}
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={maxScroll}
    aria-valuenow={scrollValue}
    style={`width: ${viewportWidth < 320 ? '8px' : '10px'}`}
    onclick={jump}
    onkeydown={handleKeydown}
  >
    {#each buckets as bucket (bucket.index)}
      <span
        class="tick"
        class:tick--active={bucket.active}
        class:tick--selected={bucket.selected}
        data-rail-bucket
        data-status={bucket.status}
        style:top={`${(bucket.index / bucketCount) * 100}%`}
        style:height={`calc(${100 / bucketCount}% - 1px)`}
      ></span>
    {/each}
    <span class="viewport-window" style:top={`${windowTop}%`} style:height={`${windowHeight}%`}
    ></span>
  </Button>
{/if}

<style>
  :global(.rail) {
    position: absolute;
    box-sizing: border-box;
    top: 4px;
    right: 2px;
    bottom: 4px;
    overflow: hidden;
    padding: 0;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--muted) / 0.35);
  }

  :global(.rail:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
  }

  :global(.rail:hover) {
    border-color: hsl(var(--border));
    background: hsl(var(--muted) / 0.35);
  }

  .tick {
    position: absolute;
    right: 1px;
    left: 1px;
    min-height: 1px;
    background: hsl(var(--muted-foreground) / 0.65);
  }

  .tick--selected {
    box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.45);
  }

  .tick--active {
    z-index: 1;
    outline: 1px solid hsl(var(--foreground));
    outline-offset: -1px;
  }

  .tick[data-status='added'] {
    background: hsl(var(--success));
  }

  .tick[data-status='deleted'] {
    background: hsl(var(--danger));
  }

  .tick[data-status='renamed'] {
    background: hsl(var(--info));
  }

  .tick[data-status='binary'] {
    background: hsl(var(--info));
  }

  .viewport-window {
    position: absolute;
    right: 0;
    left: 0;
    min-height: 5px;
    border: 1px solid hsl(var(--foreground));
    border-radius: 2px;
    background: transparent;
    pointer-events: none;
  }
</style>
