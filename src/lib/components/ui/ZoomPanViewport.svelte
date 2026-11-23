<!-- @catalog-exempt: pointer-driven zoom/pan viewport covered by __tests__/ZoomPanViewport.test.ts; no catalog fixtures yet -->

<script lang="ts">
  /**
   * ZoomPanViewport - Reusable zoom/pan viewport for arbitrary content
   *
   * Wraps snippet content (image, SVG, ...) and provides zoom/pan
   * interactions: wheel zoom centered on the cursor (trackpad pinch arrives
   * as ctrl+wheel), +/-/0 keyboard zoom, drag to pan (with click
   * suppression after a drag so host backdrop-close handlers don't fire),
   * and a bottom control bar with zoom buttons, slider, % readout and reset.
   *
   * Panning is only possible while the scaled content overflows the
   * viewport; an axis that fits stays centered and an overflowing axis
   * cannot be dragged past its edges.
   *
   * Ephemeral local state only - no Redux.
   */
  import type { Snippet } from 'svelte';
  import {
    faMagnifyingGlassMinus,
    faMagnifyingGlassPlus,
    faRotateLeft,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from './button/button.svelte';
  import { Slider } from '$lib/components/ui/slider';
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';

  interface Props {
    children: Snippet;
    /** Lower zoom bound (1 = fit). */
    minZoom?: number;
    /** Upper zoom bound. */
    maxZoom?: number;
    /** Reports scale changes after the content transform updates. */
    onScaleChange?: (scale: number) => void;
    /** True while the scaled content overflows the viewport and can be dragged. */
    pannable?: boolean;
  }

  let {
    children,
    minZoom = 0.25,
    maxZoom = 8,
    onScaleChange,
    pannable = $bindable(false),
  }: Props = $props();

  const KEYBOARD_ZOOM_FACTOR = 1.25;
  const WHEEL_ZOOM_INTENSITY = 0.0015;
  const PINCH_ZOOM_INTENSITY = 0.01;
  const DRAG_CLICK_SUPPRESS_THRESHOLD_PX = 4;
  const OVERFLOW_TOLERANCE_PX = 0.5;

  let scale = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let dragging = $state(false);

  let viewportElement: HTMLDivElement | null = $state(null);
  let contentElement: HTMLDivElement | null = $state(null);
  let viewportSize = $state({ width: 0, height: 0 });
  let contentSize = $state({ width: 0, height: 0 });

  const overflowX = $derived(
    contentSize.width * scale > viewportSize.width + OVERFLOW_TOLERANCE_PX,
  );
  const overflowY = $derived(
    contentSize.height * scale > viewportSize.height + OVERFLOW_TOLERANCE_PX,
  );

  $effect(() => {
    onScaleChange?.(scale);
  });

  $effect(() => {
    pannable = overflowX || overflowY;
  });

  /** Unscaled layout sizes: offset sizes ignore the content transform. */
  function measure() {
    if (viewportElement) {
      viewportSize = { width: viewportElement.clientWidth, height: viewportElement.clientHeight };
    }
    const child = contentElement?.firstElementChild;
    if (child instanceof HTMLElement) {
      contentSize = { width: child.offsetWidth, height: child.offsetHeight };
    } else if (child) {
      const rect = child.getBoundingClientRect();
      contentSize = { width: rect.width / scale, height: rect.height / scale };
    }
  }

  /**
   * The content's child is laid out centered in a viewport-sized box, so
   * `viewport * (1 - scale) / 2` centers it at any scale. An overflowing
   * axis may move by half its overflow either way before an edge shows.
   */
  function clampAxis(offset: number, viewport: number, content: number): number {
    const centered = (viewport * (1 - scale)) / 2;
    const overflow = content * scale - viewport;
    if (overflow <= OVERFLOW_TOLERANCE_PX) return centered;
    return Math.min(centered + overflow / 2, Math.max(centered - overflow / 2, offset));
  }

  function clampOffsets() {
    offsetX = clampAxis(offsetX, viewportSize.width, contentSize.width);
    offsetY = clampAxis(offsetY, viewportSize.height, contentSize.height);
  }

  $effect(() => {
    const viewport = viewportElement;
    const content = contentElement;
    if (!viewport || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measure();
      clampOffsets();
    });
    observer.observe(viewport);
    if (content.firstElementChild) observer.observe(content.firstElementChild);
    return () => observer.disconnect();
  });

  let dragPointerId: number | null = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let dragDistance = 0;
  let suppressNextClick = false;

  const zoomPercent = $derived(formatNumber(scale, { style: 'percent', maximumFractionDigits: 0 }));

  function clampScale(value: number): number {
    return Math.min(maxZoom, Math.max(minZoom, value));
  }

  /**
   * Zoom to `targetScale` keeping the given client point stable. With
   * `transform: translate(offset) scale(s)` and origin 0 0, the content
   * point under the cursor is `(cursor - offset) / s`; solving for the new
   * offset that maps the same content point back to the cursor gives the
   * update below.
   */
  function zoomAtPoint(clientX: number, clientY: number, targetScale: number) {
    const next = clampScale(targetScale);
    const rect = viewportElement?.getBoundingClientRect();
    const px = rect ? clientX - rect.left : 0;
    const py = rect ? clientY - rect.top : 0;
    measure();
    offsetX = px - ((px - offsetX) / scale) * next;
    offsetY = py - ((py - offsetY) / scale) * next;
    scale = next;
    clampOffsets();
  }

  function zoomAtCenter(targetScale: number) {
    const rect = viewportElement?.getBoundingClientRect();
    if (rect) {
      zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, targetScale);
    } else {
      scale = clampScale(targetScale);
      clampOffsets();
    }
  }

  function resetZoom() {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel with small deltas
    const intensity = e.ctrlKey ? PINCH_ZOOM_INTENSITY : WHEEL_ZOOM_INTENSITY;
    zoomAtPoint(e.clientX, e.clientY, scale * Math.exp(-e.deltaY * intensity));
  }

  // Attached manually because Svelte registers `onwheel` as passive, and
  // zoom must preventDefault to stop the page from scrolling.
  $effect(() => {
    const el = viewportElement;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  });

  /**
   * Keyboard zoom: `+`/`=` in, `-` out, `0` reset. Exported so a host
   * overlay can forward its keydown events; returns true when handled.
   * Modifier combos (Cmd/Ctrl+0 etc.) are left to native app shortcuts.
   */
  export function handleKeydown(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key === '+' || e.key === '=') {
      zoomAtCenter(scale * KEYBOARD_ZOOM_FACTOR);
    } else if (e.key === '-') {
      zoomAtCenter(scale / KEYBOARD_ZOOM_FACTOR);
    } else if (e.key === '0') {
      resetZoom();
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button > 0) return;
    measure();
    // Content that fits keeps the host's ordinary click and drag behavior.
    if (!overflowX && !overflowY) return;
    e.preventDefault();
    dragging = true;
    dragPointerId = e.pointerId;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    dragDistance = 0;
    const el = e.currentTarget as HTMLElement;
    if (typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    offsetX += dx;
    offsetY += dy;
    clampOffsets();
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  }

  function handlePointerEnd(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = null;
    if (dragDistance > DRAG_CLICK_SUPPRESS_THRESHOLD_PX) {
      suppressNextClick = true;
    }
    const el = e.currentTarget as HTMLElement;
    if (
      typeof el.hasPointerCapture === 'function' &&
      typeof el.releasePointerCapture === 'function' &&
      el.hasPointerCapture(e.pointerId)
    ) {
      el.releasePointerCapture(e.pointerId);
    }
  }

  // After a drag, swallow the synthesized click so a host backdrop-click
  // close handler does not fire.
  function handleClickCapture(e: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function handleSliderInput(e: Event) {
    const value = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      zoomAtCenter(value);
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={viewportElement}
  class="relative h-full w-full touch-none select-none overflow-hidden {dragging
    ? 'cursor-grabbing'
    : pannable
      ? 'cursor-grab'
      : ''}"
  role="application"
  aria-label={m.ui_zoomPanViewport_viewport_ariaLabel()}
  tabindex="0"
  data-testid="zoom-pan-viewport"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerEnd}
  onpointercancel={handlePointerEnd}
  onclickcapture={handleClickCapture}
  onkeydown={handleKeydown}
>
  <div
    bind:this={contentElement}
    class="flex h-full w-full items-center justify-center will-change-transform"
    style="transform: translate({offsetX}px, {offsetY}px) scale({scale}); transform-origin: 0 0;"
    data-testid="zoom-pan-content"
  >
    {@render children()}
  </div>

  <!-- Bottom zoom control bar -->
  <div
    class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 cursor-default items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm"
    role="toolbar"
    aria-label={m.ui_zoomPanViewport_controls_ariaLabel()}
    tabindex="-1"
    data-testid="zoom-pan-controls"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <Button
      variant="ghost"
      size="icon-sm"
      class="text-white hover:bg-white/20 hover:text-white"
      onclick={() => zoomAtCenter(scale / KEYBOARD_ZOOM_FACTOR)}
      aria-label={m.ui_zoomPanViewport_zoomOut_ariaLabel()}
      title={m.ui_zoomPanViewport_zoomOut_ariaLabel()}
    >
      <Fa icon={faMagnifyingGlassMinus} />
    </Button>
    <div class="w-36">
      <Slider
        class="accent-white"
        min={minZoom}
        max={maxZoom}
        step="0.01"
        value={scale}
        oninput={handleSliderInput}
        aria-label={m.ui_zoomPanViewport_zoomSlider_ariaLabel()}
        title={m.ui_zoomPanViewport_zoomSlider_ariaLabel()}
        data-testid="zoom-pan-slider"
      />
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      class="text-white hover:bg-white/20 hover:text-white"
      onclick={() => zoomAtCenter(scale * KEYBOARD_ZOOM_FACTOR)}
      aria-label={m.ui_zoomPanViewport_zoomIn_ariaLabel()}
      title={m.ui_zoomPanViewport_zoomIn_ariaLabel()}
    >
      <Fa icon={faMagnifyingGlassPlus} />
    </Button>
    <span
      class="min-w-12 text-center text-xs tabular-nums text-white/90"
      data-testid="zoom-pan-percent">{zoomPercent}</span
    >
    <Button
      variant="ghost"
      size="icon-sm"
      class="text-white hover:bg-white/20 hover:text-white"
      onclick={resetZoom}
      aria-label={m.ui_zoomPanViewport_resetZoom_ariaLabel()}
      title={m.ui_zoomPanViewport_resetZoom_ariaLabel()}
    >
      <Fa icon={faRotateLeft} />
    </Button>
  </div>
</div>
