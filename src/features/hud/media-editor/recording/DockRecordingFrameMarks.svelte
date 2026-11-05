<script lang="ts">
  import { tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Input } from '$lib/components/ui/input';
  import { isTextEntryTarget } from '$lib/utils/text-entry';
  import type { DockMediaEditMark, DockMediaGeometry } from '$shared/dock-media-edit';
  import { dragGeometry, frameBox, type FrameTool } from './recording-frame-model';

  /**
   * Marks drawn over the recording's frame (Capture and recording editor spec,
   * "Drawing on frames"), in source pixels, fitted to the video's picture. With a tool,
   * a drag draws a new mark (text: click, type, Enter); with none (the pointer), a mark
   * is selected by clicking it, moved by dragging it and removed with Delete.
   */
  let {
    sourceWidth,
    sourceHeight,
    marks,
    tool = null,
    editable = false,
    selectedId = null,
    onDraw,
    onMove,
    onSelect,
    onDelete,
  }: {
    sourceWidth: number;
    sourceHeight: number;
    /** The marks on screen at the current time. */
    marks: readonly DockMediaEditMark[];
    tool?: FrameTool | null;
    editable?: boolean;
    selectedId?: string | null;
    onDraw?: (kind: FrameTool, geometry: DockMediaGeometry) => void;
    onMove?: (markId: string, dx: number, dy: number) => void;
    onSelect?: (markId: string | null) => void;
    onDelete?: (markId: string) => void;
  } = $props();

  let width = $state(0);
  let height = $state(0);
  const box = $derived(frameBox(width, height, sourceWidth, sourceHeight));

  let drawing = $state<{ pointerId: number; points: { x: number; y: number }[] } | null>(null);
  let moving = $state<{
    pointerId: number;
    id: string;
    from: { x: number; y: number };
    dx: number;
    dy: number;
  } | null>(null);
  let typing = $state<{ x: number; y: number; value: string } | null>(null);

  /** A pointer position in source pixels. */
  function at(event: PointerEvent, svg: SVGSVGElement): { x: number; y: number } | null {
    if (!box) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.min(sourceWidth, Math.max(0, (event.clientX - rect.left) * box.scale)),
      y: Math.min(sourceHeight, Math.max(0, (event.clientY - rect.top) * box.scale)),
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (!editable || event.button !== 0) return;
    const svg = event.currentTarget as SVGSVGElement;
    const point = at(event, svg);
    if (!point) return;
    if (tool === 'text') {
      typing = { ...point, value: '' };
      void tick().then(() =>
        document
          .querySelector<HTMLInputElement>('[data-frame-text] input, input[data-frame-text]')
          ?.focus(),
      );
      return;
    }
    if (tool) {
      svg.setPointerCapture(event.pointerId);
      drawing = { pointerId: event.pointerId, points: [point] };
      return;
    }
    const id = (event.target as Element).closest<SVGElement>('[data-frame-mark]')?.dataset
      .frameMark;
    onSelect?.(id ?? null);
    if (!id) return;
    svg.setPointerCapture(event.pointerId);
    moving = { pointerId: event.pointerId, id, from: point, dx: 0, dy: 0 };
  }
  function onPointerMove(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const point = at(event, svg);
    if (!point) return;
    if (drawing?.pointerId === event.pointerId)
      drawing = { ...drawing, points: [...drawing.points, point] };
    else if (moving?.pointerId === event.pointerId)
      moving = { ...moving, dx: point.x - moving.from.x, dy: point.y - moving.from.y };
  }
  function onPointerUp(event: PointerEvent, commit: boolean): void {
    if (drawing?.pointerId === event.pointerId) {
      const points = drawing.points;
      drawing = null;
      if (commit && tool && tool !== 'text') {
        const geometry = dragGeometry(tool, points);
        if (geometry) onDraw?.(tool, geometry);
      }
    } else if (moving?.pointerId === event.pointerId) {
      const move = moving;
      moving = null;
      if (commit && (Math.abs(move.dx) > 1 || Math.abs(move.dy) > 1))
        onMove?.(move.id, move.dx, move.dy);
    }
  }
  function commitText(): void {
    const value = typing;
    typing = null;
    if (!value || !box || !value.value.trim()) return;
    onDraw?.('text', {
      kind: 'text',
      x: value.x,
      y: value.y,
      text: value.value.trim().slice(0, 10_000),
      fontSize: Math.round(16 * box.scale),
    });
  }
  function onWindowKeydown(event: KeyboardEvent): void {
    if (!editable || !selectedId || isTextEntryTarget(event.target)) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    onDelete?.(selectedId);
  }

  const preview = $derived(
    drawing && tool && tool !== 'text' ? dragGeometry(tool, drawing.points) : null,
  );
  function shown(mark: DockMediaEditMark): DockMediaGeometry {
    if (moving?.id !== mark.id) return mark.geometry;
    const { dx, dy } = moving;
    const g = mark.geometry;
    switch (g.kind) {
      case 'rect':
      case 'point':
      case 'text':
        return { ...g, x: g.x + dx, y: g.y + dy };
      case 'path':
        return { ...g, points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      case 'arrow':
        return {
          ...g,
          from: { x: g.from.x + dx, y: g.from.y + dy },
          to: { x: g.to.x + dx, y: g.to.y + dy },
        };
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet shape(
  geometry: DockMediaGeometry,
  attrs: { id?: string; selected?: boolean; excluded?: boolean },
)}
  {#if geometry.kind === 'rect'}
    <rect
      x={geometry.x}
      y={geometry.y}
      width={geometry.w}
      height={geometry.h}
      data-frame-mark={attrs.id}
      data-selected={attrs.selected || undefined}
      data-excluded={attrs.excluded || undefined}
    />
  {:else if geometry.kind === 'path'}
    <polyline
      points={geometry.points.map((p) => `${p.x},${p.y}`).join(' ')}
      data-frame-mark={attrs.id}
      data-selected={attrs.selected || undefined}
      data-excluded={attrs.excluded || undefined}
    />
  {:else if geometry.kind === 'arrow'}
    <line
      x1={geometry.from.x}
      y1={geometry.from.y}
      x2={geometry.to.x}
      y2={geometry.to.y}
      marker-end="url(#frame-arrow)"
      data-frame-mark={attrs.id}
      data-selected={attrs.selected || undefined}
      data-excluded={attrs.excluded || undefined}
    />
  {:else if geometry.kind === 'text'}
    <text
      x={geometry.x}
      y={geometry.y}
      font-size={geometry.fontSize}
      data-frame-mark={attrs.id}
      data-selected={attrs.selected || undefined}
      data-excluded={attrs.excluded || undefined}>{geometry.text}</text
    >
  {:else}
    <circle
      cx={geometry.x}
      cy={geometry.y}
      r={12}
      data-frame-mark={attrs.id}
      data-selected={attrs.selected || undefined}
      data-excluded={attrs.excluded || undefined}
    />
  {/if}
{/snippet}

<div class="frame-marks" bind:clientWidth={width} bind:clientHeight={height}>
  {#if box}
    <!-- svelte-ignore a11y_no_static_element_interactions -- drawing surface; marks are also reachable from the timeline and transcript -->
    <svg
      class="surface"
      data-tool={tool ?? 'pointer'}
      data-editable={editable || undefined}
      style:left={`${box.x}px`}
      style:top={`${box.y}px`}
      style:width={`${box.width}px`}
      style:height={`${box.height}px`}
      viewBox={`0 0 ${sourceWidth} ${sourceHeight}`}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={(event) => onPointerUp(event, true)}
      onpointercancel={(event) => onPointerUp(event, false)}
      onlostpointercapture={(event) => onPointerUp(event, false)}
    >
      <defs>
        <marker
          id="frame-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {#each marks as mark (mark.id)}
        {@render shape(shown(mark), {
          id: mark.id,
          selected: mark.id === selectedId,
          excluded: !mark.included,
        })}
      {/each}
      {#if preview}{@render shape(preview, {})}{/if}
    </svg>
    {#if typing}
      <div
        class="text-entry"
        data-frame-text
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
  .surface {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }
  .surface[data-editable] {
    pointer-events: auto;
    cursor: crosshair;
  }
  .surface[data-editable][data-tool='pointer'] {
    cursor: default;
  }
  .surface :global(rect),
  .surface :global(polyline),
  .surface :global(line),
  .surface :global(circle) {
    fill: none;
    stroke: hsl(var(--primary));
    stroke-width: 3;
    vector-effect: non-scaling-stroke;
  }
  .surface :global(text) {
    fill: hsl(var(--primary));
  }
  .surface :global(marker path) {
    fill: hsl(var(--primary));
  }
  .surface :global([data-selected]) {
    stroke-dasharray: 6 4;
  }
  .surface :global([data-excluded]) {
    opacity: 0.35;
  }
  .surface[data-tool='pointer'] :global([data-frame-mark]) {
    cursor: move;
    pointer-events: all;
  }
  .text-entry {
    position: absolute;
    width: 12em;
    pointer-events: auto;
  }
</style>
