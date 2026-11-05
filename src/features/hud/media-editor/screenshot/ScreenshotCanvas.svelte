<script lang="ts" module>
  import type { DockImageRect, DockMarkGeometry } from '$shared/dock-evidence';
  /** Presentation only. Canonical draft is owned by the shared editor transaction. */
  export interface ScreenshotShape {
    id: string;
    geometry: DockMarkGeometry;
    label?: string;
    text?: string;
    fontSize?: number;
    blur?: boolean;
  }
  export type ScreenshotTool =
    'pointer' | 'element' | 'box' | 'draw' | 'arrow' | 'text' | 'blur' | 'crop';
</script>

<script lang="ts">
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
    onSelect: (id: string | null) => void;
    onDraw: (tool: ScreenshotTool, geometry: DockMarkGeometry) => void;
    onTransform: (id: string, geometry: DockMarkGeometry) => void;
    onDelete: (id: string) => void;
  } = $props();
  const uid = $props.id();
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
    const bounds = surface!.getBoundingClientRect();
    return screenshotPoint({ x: event.clientX, y: event.clientY }, bounds, frame);
  }
  function down(event: PointerEvent) {
    if (disabled || event.button !== 0 || !surface) return;
    event.preventDefault();
    surface.focus({ preventScroll: true });
    const hit = event.target instanceof Element ? event.target.closest('[data-shape-id]') : null;
    const id = hit?.getAttribute('data-shape-id') ?? null;
    const shape = shapes.find((s) => s.id === id);
    if (tool === 'pointer') onSelect(id);
    const start = point(event);
    if (tool === 'pointer' && !shape) return;
    surface.setPointerCapture(event.pointerId);
    gesture = {
      pointer: event.pointerId,
      start,
      points: [start],
      id: tool === 'pointer' ? id : null,
      original: tool === 'pointer' && shape ? shape.geometry : null,
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
    move(event);
    const g = gesture;
    gesture = null;
    if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (g && !g.preview && (tool === 'text' || tool === 'element')) {
      g.preview = {
        kind: 'rect',
        x: g.start.x,
        y: g.start.y,
        w: Math.min(160, frame.x + frame.w - g.start.x),
        h: Math.min(40, frame.y + frame.h - g.start.y),
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
  <!-- i18n-ignore (editor strings; caller-localized labels follow with shared shell) -->
  <svg
    bind:this={surface}
    class="canvas"
    viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
    style:aspect-ratio={`${frame.w} / ${frame.h}`}
    role="application"
    aria-label="Screenshot canvas. Arrow keys move the selected mark; Shift and arrows resize it. Delete removes it."
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (gesture = null)}
    onlostpointercapture={() => (gesture = null)}
    onkeydown={key}
  >
    <defs>
      <filter id={`${uid}-blur`}><feGaussianBlur stdDeviation="12" /></filter>
      <marker id={`${uid}-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"
        ><path d="M0,0 L6,3 L0,6" fill="none" stroke="currentColor" /></marker
      >
      {#each visible.filter((s) => s.blur) as shape (shape.id)}
        {@const b = dockGeometryRect(shape.geometry)}
        <clipPath id={`${uid}-${shape.id}`}
          ><rect x={b.x} y={b.y} width={b.w} height={b.h} /></clipPath
        >
      {/each}
    </defs>
    <image href={sourceUrl} x="0" y="0" {width} {height} />
    {#each visible as shape (shape.id)}
      {@const b = dockGeometryRect(shape.geometry)}
      <g data-shape-id={shape.id} class:selected={selectedId === shape.id} class="shape">
        {#if shape.blur}
          <g clip-path={`url(#${uid}-${shape.id})`}
            ><image href={sourceUrl} x="0" y="0" {width} {height} filter={`url(#${uid}-blur)`} /></g
          >
          <rect class="blur-hit" x={b.x} y={b.y} width={b.w} height={b.h} />
        {:else if shape.geometry.kind === 'rect'}
          <rect class="mark" x={b.x} y={b.y} width={b.w} height={b.h} />
        {:else}
          <path
            class="mark"
            d={screenshotPath(shape.geometry)}
            marker-end={shape.geometry.kind === 'arrow' ? `url(#${uid}-arrow)` : undefined}
          />
          <path class="path-hit" d={screenshotPath(shape.geometry)} />
        {/if}
        {#if shape.text}<text
            class="mark-text"
            x={b.x}
            y={b.y + (shape.fontSize ?? 20)}
            style:font-size={`${shape.fontSize ?? 20}px`}>{shape.text}</text
          >{/if}
        {#if shape.label}
          <circle
            class="badge"
            cx={Math.min(frame.x + frame.w - 10, b.x + 8)}
            cy={Math.max(frame.y + 10, b.y + 8)}
            r="10"
          />
          <text
            class="number"
            x={Math.min(frame.x + frame.w - 10, b.x + 8)}
            y={Math.max(frame.y + 10, b.y + 8)}>{shape.label}</text
          >
        {/if}
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
  .blur-hit {
    fill: transparent;
  }
  .badge {
    fill: hsl(var(--primary));
  }
  .number {
    fill: hsl(var(--primary-foreground));
    font: 600 12px system-ui;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .mark-text {
    fill: hsl(var(--primary));
    font: 500 20px system-ui;
    pointer-events: none;
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
