<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import type { DiffMapLayoutRow } from '../layout/layout-diff-map';

  interface Props {
    rows: DiffMapLayoutRow[];
    contentHeight: number;
    viewportHeight: number;
    scrollTop: number;
    activePath?: string;
    selected: ReadonlySet<string>;
    onJump: (scrollTop: number) => void;
  }

  let { rows, contentHeight, viewportHeight, scrollTop, activePath, selected, onJump }: Props =
    $props();

  const safeHeight = $derived(Math.max(1, contentHeight));
  const windowTop = $derived((scrollTop / safeHeight) * 100);
  const windowHeight = $derived(Math.min(100, (viewportHeight / safeHeight) * 100));

  function jump(event: MouseEvent) {
    const bounds =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.getBoundingClientRect()
        : null;
    if (!bounds || bounds.height === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    onJump(Math.max(0, ratio * contentHeight - viewportHeight / 2));
  }
</script>

<button
  type="button"
  class="rail"
  aria-label={m.workspace_multiSelectSidebar_overviewTab_label()}
  onclick={jump}
>
  {#each rows as row (row.fileId)}
    <span
      class="tick"
      class:tick--active={row.fileId === activePath}
      class:tick--selected={selected.has(row.fileId)}
      style:top={`${(row.y / safeHeight) * 100}%`}
    ></span>
  {/each}
  <span class="viewport-window" style:top={`${windowTop}%`} style:height={`${windowHeight}%`}
  ></span>
</button>

<style>
  .rail {
    position: absolute;
    top: 4px;
    right: 2px;
    bottom: 4px;
    width: 14px;
    overflow: hidden;
    padding: 0;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--muted) / 0.55);
  }

  .rail:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
  }

  .tick {
    position: absolute;
    right: 2px;
    left: 2px;
    height: 1px;
    background: hsl(var(--muted-foreground) / 0.65);
  }

  .tick--selected {
    height: 2px;
    background: hsl(var(--accent-foreground));
  }

  .tick--active {
    z-index: 1;
    height: 3px;
    background: hsl(var(--primary));
  }

  .viewport-window {
    position: absolute;
    right: 0;
    left: 0;
    min-height: 5px;
    border: 1px solid hsl(var(--primary));
    border-radius: 2px;
    background: hsl(var(--primary) / 0.1);
    pointer-events: none;
  }
</style>
