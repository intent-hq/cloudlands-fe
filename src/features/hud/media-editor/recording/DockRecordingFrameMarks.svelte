<script lang="ts">
  import { tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Input } from '$lib/components/ui/input';
  import {
    dockMediaGeometryRect,
    numberDockMediaMarks,
    type DockMediaEdit,
    type DockMediaGeometry,
    type DockMediaSource,
  } from '$shared/dock-media-edit';
  import {
    layoutDockMediaMarks,
    paintDockMediaMarks,
    type DockMediaPaintOp,
  } from '$features/hud/composer/dock-media-render';
  import { screenshotPath } from '../screenshot/screenshot-geometry';
  import { formatRecordingTime } from './recording-editor-model';
  import {
    dragGeometry,
    frameBox,
    frameResizable,
    moveFrameGeometry,
    resizeFrameGeometry,
    type FrameTool,
  } from './recording-frame-model';

  /**
   * Marks over the recording's frame (Capture and recording editor spec, "Drawing on
   * frames"). The art is the export's own: the canonical layout and painter draw on a
   * canvas, so what shows here is what is sent. The SVG above it holds only hit areas,
   * the selection outline, the resize handle and the shape being drawn.
   *
   * Every gesture first pauses playback (`onBegin`) and keeps the paused time: a new mark
   * belongs to the frame the gesture began on. With a tool, a drag draws (text: click,
   * type, Enter). With the pointer, a mark is selected by clicking or focusing it, moved
   * by dragging it, resized by its corner handle, nudged with the arrow keys and removed
   * with Delete while it has focus. Each gesture is one edit.
   */
  let {
    source,
    edit,
    atMs,
    tool = null,
    editable = false,
    selectedId = null,
    onBegin,
    onDraw,
    onChange,
    onSelect,
    onDelete,
  }: {
    /** A clean source: its frames carry no marks of their own. */
    source: DockMediaSource;
    edit: DockMediaEdit;
    /** The playhead; marks on screen at it are drawn. */
    atMs: number;
    tool?: FrameTool | null;
    editable?: boolean;
    selectedId?: string | null;
    /** Pause playback; returns the paused time (ms) the gesture belongs to. */
    onBegin: () => number;
    onDraw?: (kind: FrameTool, geometry: DockMediaGeometry, atMs: number) => void;
    onChange?: (markId: string, geometry: DockMediaGeometry) => void;
    onSelect?: (markId: string | null) => void;
    onDelete?: (markId: string) => void;
  } = $props();

  let width = $state(0);
  let height = $state(0);
  const box = $derived(frameBox(width, height, source.width, source.height));

  type Gesture =
    | { kind: 'draw'; pointerId: number; atMs: number; points: { x: number; y: number }[] }
    | {
        kind: 'move' | 'resize';
        pointerId: number;
        id: string;
        original: DockMediaGeometry;
        from: { x: number; y: number };
        preview: DockMediaGeometry | null;
      };
  let gesture = $state<Gesture | null>(null);
  let typing = $state<{ x: number; y: number; atMs: number; value: string } | null>(null);
  let textEntry = $state<HTMLDivElement | null>(null);
  let surface = $state<SVGSVGElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);

  // The edit as it will be once the gesture in progress is committed.
  const shownEdit = $derived.by((): DockMediaEdit => {
    const g = gesture;
    if (!g || g.kind === 'draw' || !g.preview) return edit;
    const preview = g.preview;
    return {
      ...edit,
      marks: edit.marks.map((mark) => (mark.id === g.id ? { ...mark, geometry: preview } : mark)),
    };
  });
  const drawPreview = $derived(
    gesture?.kind === 'draw' && tool && tool !== 'text' ? dragGeometry(tool, gesture.points) : null,
  );
  // Exactly the marks the export paints at this time, numbered as it numbers them.
  const visible = $derived(
    numberDockMediaMarks(shownEdit, source).filter(
      (row) => atMs >= row.mark.atMs && atMs < row.visibleUntilMs,
    ),
  );
  const ops = $derived.by((): DockMediaPaintOp[] => {
    const marks = layoutDockMediaMarks(shownEdit, source, atMs);
    return drawPreview ? [...marks, { kind: 'geometry', geometry: drawPreview }] : marks;
  });

  $effect(() => {
    const node = canvas;
    const fitted = box;
    const list = ops;
    if (!node || !fitted) return;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(fitted.width * ratio));
    const h = Math.max(1, Math.round(fitted.height * ratio));
    if (node.width !== w) node.width = w;
    if (node.height !== h) node.height = h;
    const context = node.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, w, h);
    context.setTransform(w / source.width, 0, 0, h / source.height, 0, 0);
    paintDockMediaMarks(context, list);
  });

  /** A pointer position in source pixels, inside the picture. */
  function at(event: PointerEvent): { x: number; y: number } | null {
    if (!box || !surface) return null;
    const rect = surface.getBoundingClientRect();
    return {
      x: Math.min(source.width, Math.max(0, (event.clientX - rect.left) * box.scale)),
      y: Math.min(source.height, Math.max(0, (event.clientY - rect.top) * box.scale)),
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (!editable || event.button !== 0 || !surface) return;
    const point = at(event);
    if (!point) return;
    event.preventDefault();
    if (tool === 'text') {
      typing = { ...point, atMs: onBegin(), value: '' };
      void tick().then(() => textEntry?.querySelector('input')?.focus());
      return;
    }
    if (tool) {
      const begun = onBegin();
      surface.setPointerCapture(event.pointerId);
      gesture = { kind: 'draw', pointerId: event.pointerId, atMs: begun, points: [point] };
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const hit = target?.closest<SVGGElement>('[data-frame-mark]') ?? null;
    const id = hit?.dataset.frameMark ?? null;
    const mark = id ? edit.marks.find((row) => row.id === id) : undefined;
    onSelect?.(mark ? mark.id : null);
    if (!mark || !hit) return;
    onBegin();
    hit.focus({ preventScroll: true });
    surface.setPointerCapture(event.pointerId);
    gesture = {
      kind: target?.hasAttribute('data-resize') ? 'resize' : 'move',
      pointerId: event.pointerId,
      id: mark.id,
      original: mark.geometry,
      from: point,
      preview: null,
    };
  }
  function onPointerMove(event: PointerEvent): void {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    const point = at(event);
    if (!point) return;
    if (g.kind === 'draw') {
      if (g.points.length < 4096) gesture = { ...g, points: [...g.points, point] };
      return;
    }
    const preview =
      g.kind === 'resize'
        ? resizeFrameGeometry(g.original, point, source.width, source.height)
        : moveFrameGeometry(
            g.original,
            point.x - g.from.x,
            point.y - g.from.y,
            source.width,
            source.height,
          );
    gesture = { ...g, preview };
  }
  function onPointerUp(event: PointerEvent, commit: boolean): void {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture = null;
    if (!commit) return;
    if (g.kind === 'draw') {
      if (!tool || tool === 'text') return;
      const geometry = dragGeometry(tool, g.points);
      if (geometry) onDraw?.(tool, geometry, g.atMs);
    } else if (g.preview && JSON.stringify(g.preview) !== JSON.stringify(g.original)) {
      onChange?.(g.id, g.preview);
    }
  }
  function commitText(): void {
    const value = typing;
    typing = null;
    if (!value || !box || !value.value.trim()) return;
    onDraw?.(
      'text',
      {
        kind: 'text',
        x: value.x,
        y: value.y,
        text: value.value.trim().slice(0, 10_000),
        fontSize: Math.round(16 * box.scale),
      },
      value.atMs,
    );
  }

  /**
   * Keys on a focused mark only (never window-wide, so a Delete meant for the timeline
   * or transcript never removes a mark): Delete removes it, arrows nudge it (Shift: 10x),
   * Esc lets it go.
   */
  function onMarkKeydown(event: KeyboardEvent, id: string): void {
    if (event.defaultPrevented || !editable || !box) return;
    const mark = edit.marks.find((row) => row.id === id);
    if (!mark) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDelete?.(id);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onSelect?.(null);
      (event.currentTarget as SVGElement).blur();
      return;
    }
    const step = box.scale * (event.shiftKey ? 10 : 1);
    const delta: [number, number] | undefined = (
      {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      } as Record<string, [number, number]>
    )[event.key];
    if (!delta) return;
    event.preventDefault();
    onBegin();
    onChange?.(
      id,
      moveFrameGeometry(mark.geometry, delta[0], delta[1], source.width, source.height),
    );
  }
</script>

<div class="frame-marks" bind:clientWidth={width} bind:clientHeight={height}>
  {#if box}
    <canvas
      bind:this={canvas}
      class="art"
      aria-hidden="true"
      style:left={`${box.x}px`}
      style:top={`${box.y}px`}
      style:width={`${box.width}px`}
      style:height={`${box.height}px`}
    ></canvas>
    <!-- svelte-ignore a11y_no_static_element_interactions -- drawing surface; each mark on it is a focusable control -->
    <svg
      bind:this={surface}
      class="surface"
      data-tool={tool ?? 'pointer'}
      data-editable={editable || undefined}
      style:left={`${box.x}px`}
      style:top={`${box.y}px`}
      style:width={`${box.width}px`}
      style:height={`${box.height}px`}
      viewBox={`0 0 ${source.width} ${source.height}`}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={(event) => onPointerUp(event, true)}
      onpointercancel={(event) => onPointerUp(event, false)}
      onlostpointercapture={(event) => onPointerUp(event, false)}
    >
      {#if editable}
        {#each visible as row (row.mark.id)}
          {@const g = row.mark.geometry}
          {@const b = dockMediaGeometryRect(g)}
          {@const selected = row.mark.id === selectedId}
          <g
            class="hit"
            role="button"
            tabindex={tool ? -1 : 0}
            data-frame-mark={row.mark.id}
            data-selected={selected || undefined}
            aria-pressed={selected}
            aria-label={m.dock_captureEditor_pin_ariaLabel({
              mark: `${row.n}. ${row.mark.label || row.mark.kind}`,
              time: formatRecordingTime(row.mark.atMs),
            })}
            onfocus={() => onSelect?.(row.mark.id)}
            onkeydown={(event) => onMarkKeydown(event, row.mark.id)}
          >
            {#if g.kind === 'path' || g.kind === 'arrow'}
              <path class="hit-stroke" d={screenshotPath(g)} />
            {:else}
              <rect class="hit-area" x={b.x} y={b.y} width={b.w} height={b.h} />
            {/if}
            {#if selected}
              <rect class="selection" x={b.x} y={b.y} width={b.w} height={b.h} />
              {#if frameResizable(g)}
                <rect
                  data-resize
                  class="handle"
                  x={b.x + b.w - 5 * box.scale}
                  y={b.y + b.h - 5 * box.scale}
                  width={10 * box.scale}
                  height={10 * box.scale}
                />
              {/if}
            {/if}
          </g>
        {/each}
      {/if}
    </svg>
    {#if typing}
      <div
        bind:this={textEntry}
        class="text-entry"
        style:left={`${box.x + typing.x / box.scale}px`}
        style:top={`${box.y + typing.y / box.scale}px`}
      >
        <Input
          size="sm"
          aria-label={m.dock_captureEditor_frameText_label()}
          bind:value={typing.value}
          onblur={commitText}
          onkeydown={(event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.key === 'Enter') commitText();
            else if (event.key === 'Escape') typing = null;
          }}
        />
      </div>
    {/if}
  {/if}
</div>

<style>
  .frame-marks {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .art,
  .surface {
    position: absolute;
    pointer-events: none;
  }
  .surface {
    overflow: visible;
  }
  .surface[data-editable] {
    pointer-events: auto;
    cursor: crosshair;
  }
  .surface[data-editable][data-tool='pointer'] {
    cursor: default;
  }
  .hit {
    outline: none;
  }
  .hit-area {
    fill: transparent;
  }
  .hit-stroke {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
    vector-effect: non-scaling-stroke;
  }
  .surface[data-tool='pointer'] .hit-area,
  .surface[data-tool='pointer'] .hit-stroke {
    cursor: move;
    pointer-events: all;
  }
  .surface[data-tool='pointer'] .hit-stroke {
    pointer-events: stroke;
  }
  .surface:not([data-tool='pointer']) .hit {
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
  .hit:focus-visible .selection {
    stroke-width: 2;
  }
  .handle {
    fill: hsl(var(--background));
    stroke: hsl(var(--ring));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    cursor: nwse-resize;
    pointer-events: all;
  }
  .text-entry {
    position: absolute;
    width: 12em;
    pointer-events: auto;
  }
</style>
