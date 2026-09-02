<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';

  type FixedViewport = Exclude<BrowserTabViewport, { mode: 'fit' }>;

  const MIN_VIEWPORT_PX = 320;
  const MAX_VIEWPORT_PX = 3840;
  const RESIZE_DEBOUNCE_MS = 150;

  interface Props {
    viewport: FixedViewport;
    onViewportChange: (viewport: BrowserTabViewport) => void;
    children?: Snippet;
  }

  let { viewport, onViewportChange, children }: Props = $props();
  // svelte-ignore state_referenced_locally - intentional initial size; the effect below syncs later prop changes
  let frameWidth = $state(viewport.width);
  // svelte-ignore state_referenced_locally - intentional initial size; the effect below syncs later prop changes
  let frameHeight = $state(viewport.height);
  let dragging = $state(false);
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;

  const dimensionsLabel = $derived(
    m.browser_viewport_dimensions_label({
      width: formatInteger(frameWidth),
      height: formatInteger(frameHeight),
    }),
  );

  $effect(() => {
    if (dragging) return;
    frameWidth = viewport.width;
    frameHeight = viewport.height;
  });

  function clamp(value: number): number {
    return Math.min(MAX_VIEWPORT_PX, Math.max(MIN_VIEWPORT_PX, Math.round(value)));
  }

  function dispatchCurrentSize(): void {
    onViewportChange({ mode: 'custom', width: frameWidth, height: frameHeight });
  }

  function scheduleResize(): void {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(dispatchCurrentSize, RESIZE_DEBOUNCE_MS);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = frameWidth;
    startHeight = frameHeight;
    event.currentTarget instanceof HTMLElement &&
      event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragging || event.pointerId !== pointerId) return;
    frameWidth = clamp(startWidth + event.clientX - startX);
    frameHeight = clamp(startHeight + event.clientY - startY);
    scheduleResize();
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (!dragging || event.pointerId !== pointerId) return;
    clearTimeout(resizeTimer);
    dragging = false;
    pointerId = null;
    const target = event.currentTarget;
    if (
      target instanceof HTMLElement &&
      target.hasPointerCapture?.(event.pointerId) &&
      target.releasePointerCapture
    ) {
      target.releasePointerCapture(event.pointerId);
    }
    dispatchCurrentSize();
  }

  onDestroy(() => clearTimeout(resizeTimer));
</script>

<div class="flex h-full w-full items-center justify-center overflow-hidden bg-muted/40">
  <div
    class="relative overflow-hidden border border-border bg-background shadow-sm {dragging
      ? 'ring-2 ring-primary/30'
      : ''}"
    style="width: min(100%, {frameWidth}px); height: min(100%, {frameHeight}px);"
    data-browser-device-frame
    data-width={frameWidth}
    data-height={frameHeight}
  >
    {@render children?.()}
    <span
      class="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur"
      data-browser-viewport-readout
    >
      {dimensionsLabel}
    </span>
    <button
      type="button"
      class="absolute bottom-0 right-0 z-20 size-5 cursor-nwse-resize touch-none border-0 bg-transparent p-0 after:absolute after:bottom-1 after:right-1 after:size-2 after:border-b-2 after:border-r-2 after:border-muted-foreground"
      aria-label={m.browser_viewport_resizeHandle_ariaLabel()}
      data-testid="browser-device-resize-handle"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerEnd}
      onpointercancel={handlePointerEnd}
    ></button>
  </div>
</div>
