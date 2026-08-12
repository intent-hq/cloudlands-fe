<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    storageKey,
    minWidth,
    maxWidth,
    defaultWidth,
    restoreStoredWidth,
    transientWidthDelta,
    growWithDefaultWidth,
    resizeWithDefaultWidth,
    syncWithDefaultWidth,
    doSkipResize,
    showHandleIndicator,
    resizeScrollContainer,
    onWidthChange,
    onResizeEnd,
    children,
  }: {
    storageKey?: string;
    minWidth?: number;
    maxWidth?: number;
    defaultWidth?: number;
    restoreStoredWidth?: boolean;
    transientWidthDelta?: number;
    growWithDefaultWidth?: boolean;
    resizeWithDefaultWidth?: boolean;
    syncWithDefaultWidth?: boolean;
    doSkipResize?: boolean;
    showHandleIndicator?: boolean;
    resizeScrollContainer?: HTMLElement | null;
    onWidthChange?: (width: number) => void;
    onResizeEnd?: (previousWidth: number, nextWidth: number) => void;
    children?: Snippet<[any]>;
  } = $props();
</script>

<div
  data-testid="mock-resizable-panel"
  data-storage-key={storageKey}
  data-min-width={minWidth}
  data-max-width={maxWidth}
  data-default-width={defaultWidth}
  data-restore-stored-width={restoreStoredWidth}
  data-transient-width-delta={transientWidthDelta}
  data-grow-with-default-width={growWithDefaultWidth}
  data-resize-with-default-width={resizeWithDefaultWidth}
  data-sync-with-default-width={syncWithDefaultWidth}
  data-skip-resize={doSkipResize}
  data-show-handle-indicator={showHandleIndicator}
  data-resize-scroll-container={resizeScrollContainer ? 'true' : 'false'}
>
  {@render children?.({ isCollapsed: false })}
  <button
    aria-label="Resize panel (double-click to reset)"
    data-mock-resize-handle
    onclick={() => onResizeEnd?.(1320, 1440)}
  ></button>
  <button aria-label="Report mock width" data-mock-width-change onclick={() => onWidthChange?.(720)}
  ></button>
</div>
