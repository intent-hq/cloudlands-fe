<script lang="ts" module>
  import type { DockImageRect, DockMarkGeometry } from '$shared/dock-evidence';
  /** Presentation only. Canonical draft is owned by the shared editor transaction. */
  export interface ScreenshotShape {
    id: string;
    geometry: DockMarkGeometry;
    blur?: boolean;
  }
  export type ScreenshotTool =
    'pointer' | 'element' | 'box' | 'draw' | 'arrow' | 'text' | 'blur' | 'crop';
</script>

<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { dockGeometryRect } from '$shared/dock-annotation';
  import type { DockImagePoint } from '$shared/dock-evidence';
  import {
    fitScreenshotGeometry,
    moveScreenshotGeometry,
    screenshotPath,
    screenshotPoint,
    screenshotRect,
  } from './screenshot-geometry';

  let {
    sourceUrl,
    width,
    height,
    frame,
    shapes,
    tool,
    selectedId,
    disabled = false,
    raster = false,
    hidden = false,
    onSelect,
    onDraw,
    onTransform,
    onDelete,
  }: {
    sourceUrl: string;
    width: number;
    height: number;
    frame: DockImageRect;
    shapes: readonly ScreenshotShape[];
    tool: ScreenshotTool;
    selectedId: string | null;
    disabled?: boolean;
    raster?: boolean;
    hidden?: boolean;
    onSelect: (id: string | null) => void;
    onDraw: (tool: ScreenshotTool, geometry: DockMarkGeometry) => void;
    onTransform: (id: string, geometry: DockMarkGeometry) => void;
    onDelete: (id: string) => void;
  } = $props();
  let surface = $state<SVGSVGElement | null>(null);
  let gesture = $state<{
    pointer: number;
    start: DockImagePoint;
    points: DockImagePoint[];
    id: string | null;
    original: DockMarkGeometry | null;
    resize: boolean;
    preview: DockMarkGeometry | null;
  } | null>(null);
  const visible = $derived(
    shapes.map((s) =>
      gesture?.id === s.id && gesture.preview ? { ...s, geometry: gesture.preview } : s,
    ),
  );

  function point(event: PointerEvent): DockImagePoint {
    if (!surface) return { x: frame.x, y: frame.y };
    const bounds = surface.getBoundingClientRect();
    return screenshotPoint({ x: event.clientX, y: event.clientY }, bounds, frame);
  }
  function down(event: PointerEvent) {
    if (disabled || event.button !== 0 || !surface) return;
    event.preventDefault();
    surface.focus({ preventScroll: true });
    const hit = event.target instanceof Element ? event.target.closest('[data-shape-id]') : null;
    const id = hit?.getAttribute('data-shape-id') ?? null;
    const shape = shapes.find((s) => s.id === id);
    // Pressing on an existing mark selects and moves it with any drawing tool (there is
    // no pointer button); crop always drags its area.
    const selecting = tool === 'pointer' || (!!shape && tool !== 'crop');
    if (selecting) onSelect(id);
    const start = point(event);
    if (selecting && !shape) return;
    surface.setPointerCapture(event.pointerId);
    gesture = {
      pointer: event.pointerId,
      start,
      points: [start],
      id: selecting ? id : null,
      original: selecting && shape ? shape.geometry : null,
      resize: event.target instanceof Element && event.target.hasAttribute('data-resize'),
      preview: null,
    };
  }
  function move(event: PointerEvent) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const current = point(event);
    const g = gesture;
    let preview: DockMarkGeometry;
    if (g.original) {
      const bounds = dockGeometryRect(g.original);
      preview = g.resize
        ? fitScreenshotGeometry(g.original, {
            ...bounds,
            w: Math.max(2, current.x - bounds.x),
            h: Math.max(2, current.y - bounds.y),
          })
        : moveScreenshotGeometry(
            g.original,
            { x: current.x - g.start.x, y: current.y - g.start.y },
            frame,
          );
    } else if (tool === 'draw') {
      const points = g.points.length < 256 ? [...g.points, current] : g.points;
      gesture = { ...g, points, preview: { kind: 'path', points } };
      return;
    } else if (tool === 'arrow') preview = { kind: 'arrow', from: g.start, to: current };
    else preview = { kind: 'rect', ...screenshotRect(g.start, current) };
    gesture = { ...g, preview };
  }
  function up(event: PointerEvent) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const end = point(event);
    if (gesture.original && Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) < 0.001) {
      gesture = null;
      if (surface?.hasPointerCapture(event.pointerId))
        surface.releasePointerCapture(event.pointerId);
      return;
    }
    move(event);
    const g = gesture;
    gesture = null;
    if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    const dragged = g?.preview ? dockGeometryRect(g.preview) : null;
    if (
      g &&
      !g.original &&
      (tool === 'text' || tool === 'element') &&
      (!dragged || Math.min(dragged.w, dragged.h) < 2)
    ) {
      const w = Math.min(160, frame.w),
        h = Math.min(40, frame.h);
      if (w < 2 || h < 2) return;
      g.preview = {
        kind: 'rect',
        x: Math.max(frame.x, Math.min(g.start.x, frame.x + frame.w - w)),
        y: Math.max(frame.y, Math.min(g.start.y, frame.y + frame.h - h)),
        w,
        h,
      };
    }
    if (!g?.preview) return;
    const bounds = dockGeometryRect(g.preview);
    if (!g.original && Math.max(bounds.w, bounds.h) < 2) return;
    if (g.id) onTransform(g.id, g.preview);
    else onDraw(tool, g.preview);
  }
  function key(event: KeyboardEvent) {
    if (disabled || !selectedId) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      onDelete(selectedId);
      return;
    }
    const shifts: Record<string, DockImagePoint> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const shift = shifts[event.key];
    const shape = shapes.find((s) => s.id === selectedId);
    if (!shift || !shape || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      const b = dockGeometryRect(shape.geometry);
      onTransform(
        shape.id,
        fitScreenshotGeometry(shape.geometry, {
          ...b,
          w: Math.max(2, Math.min(frame.x + frame.w - b.x, b.w + shift.x)),
          h: Math.max(2, Math.min(frame.y + frame.h - b.y, b.h + shift.y)),
        }),
      );
    } else onTransform(shape.id, moveScreenshotGeometry(shape.geometry, shift, frame));
  }
</script>

<div class="canvas-stage">
  <svg
    bind:this={surface}
    class="canvas"
    class:raster
    class:hidden
    viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
    style:aspect-ratio={`${frame.w} / ${frame.h}`}
    role="application"
    aria-label={m.dock_screenshotEditor_canvas()}
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (gesture = null)}
    onlostpointercapture={() => (gesture = null)}
    onkeydown={key}
  >
    <image
      href={sourceUrl}
      x={raster ? frame.x : 0}
      y={raster ? frame.y : 0}
      width={raster ? frame.w : width}
      height={raster ? frame.h : height}
    />
    {#each visible as shape (shape.id)}
      {@const b = dockGeometryRect(shape.geometry)}
      <g data-shape-id={shape.id} class:selected={selectedId === shape.id} class="shape">
        {#if shape.geometry.kind === 'rect'}
          <rect class="shape-hit" x={b.x} y={b.y} width={b.w} height={b.h} />
        {:else}<path class="path-hit" d={screenshotPath(shape.geometry)} />{/if}
        {#if selectedId === shape.id}
          <rect class="selection" x={b.x} y={b.y} width={b.w} height={b.h} />
          <rect
            data-resize
            class="handle"
            x={b.x + b.w - 5}
            y={b.y + b.h - 5}
            width="10"
            height="10"
          />
        {/if}
      </g>
    {/each}
    {#if gesture?.preview && !gesture.id}
      {@const b = dockGeometryRect(gesture.preview)}
      {#if gesture.preview.kind === 'rect'}<rect
          class="mark preview"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
        />{:else}<path class="mark preview" d={screenshotPath(gesture.preview)} />{/if}
    {/if}
  </svg>
</div>

<style>
  .canvas-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: 24px;
    background: hsl(var(--muted));
    border-radius: var(--radius-medium);
  }
  .canvas {
    display: block;
    width: 100%;
    height: auto;
    max-height: 100%;
    touch-action: none;
    outline: none;
    overflow: hidden;
  }
  .canvas.hidden {
    visibility: hidden;
  }
  .canvas:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 4px;
  }
  .shape {
    cursor: move;
  }
  .mark {
    fill: transparent;
    stroke: hsl(var(--primary));
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .path-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 16;
    vector-effect: non-scaling-stroke;
  }
  .shape-hit {
    fill: transparent;
  }
  .selection {
    fill: none;
    stroke: hsl(var(--ring));
    stroke-width: 1;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .handle {
    fill: hsl(var(--background));
    stroke: hsl(var(--ring));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    cursor: nwse-resize;
  }
  .preview {
    pointer-events: none;
  }
</style>
