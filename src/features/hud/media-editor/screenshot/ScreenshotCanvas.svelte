<script lang="ts" module>
  import type { DockMediaBlurStroke } from '$shared/dock-media-edit';
  import type { DockImageRect, DockMarkGeometry } from '$shared/dock-evidence';
  /** Hit regions only; the canonical renderer owns every painted mark. */
  export interface ScreenshotShape {
    id: string;
    geometry: DockMarkGeometry;
    blur?: boolean;
    blurStroke?: DockMediaBlurStroke;
    text?: { value: string; fontSize: number; padding: number; width: number; wrapped: boolean };
  }
  export type ScreenshotTool =
    'pointer' | 'element' | 'box' | 'draw' | 'arrow' | 'text' | 'blur' | 'crop';
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { DOCK_MEDIA_PAINT } from '$features/hud/composer/dock-media-render';
  import { layoutDockMediaText } from '$shared/dock-media-edit';
  import {
    annotationHandles,
    resizeAnnotationGeometry,
    type AnnotationHandleId,
  } from '../annotation-selection';
  import { Textarea } from '$lib/components/ui/textarea';
  import { isTextEntryTarget } from '$lib/utils/text-entry';
  import { m } from '$shared/paraglide/messages.js';
  import { dockGeometryRect } from '$shared/dock-annotation';
  import type { DockImagePoint } from '$shared/dock-evidence';
  import {
    fitScreenshotGeometry,
    moveScreenshotGeometry,
    screenshotPath,
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
    selectedIds = [],
    documentKey,
    brushRadius,
    onBlurStroke,
    onGesturePreview,
    onGesturePending,
    cropCandidate = null,
    editingTextId = $bindable(null),
    editingRasterReady = true,
    disabled = false,
    raster = false,
    hidden = false,
    redactionPending = false,
    onRasterReady,
    onRasterError,
    pendingRedactions = [],
    onSelect,
    onSelectAll,
    onDraw,
    onTransform,
    onDelete,
    onCropChange,
    onText,
  }: {
    sourceUrl: string;
    width: number;
    height: number;
    frame: DockImageRect;
    shapes: readonly ScreenshotShape[];
    tool: ScreenshotTool;
    selectedId: string | null;
    selectedIds?: readonly string[];
    documentKey: string;
    brushRadius: number;
    onBlurStroke: (points: DockImagePoint[], radius: number) => void;
    onGesturePreview: (preview: { id: string; geometry: DockMarkGeometry } | null) => void;
    onGesturePending: (pending: boolean) => void;
    cropCandidate?: DockImageRect | null;
    editingTextId?: string | null;
    editingRasterReady?: boolean;
    disabled?: boolean;
    raster?: boolean;
    hidden?: boolean;
    redactionPending?: boolean;
    onRasterReady?: (url: string) => void;
    onRasterError?: (url: string) => void;
    pendingRedactions?: readonly ScreenshotShape[];
    onSelect: (id: string | null, event?: PointerEvent | MouseEvent | KeyboardEvent) => void;
    onSelectAll: () => void;
    onDraw: (
      tool: ScreenshotTool,
      geometry: DockMarkGeometry,
      creationUnit?: number,
      autoWidthText?: boolean,
    ) => void;
    onTransform: (id: string, geometry: DockMarkGeometry) => void;
    onDelete: (id?: string) => void;
    onCropChange: (crop: DockImageRect) => void;
    onText: (id: string, value: string) => void;
  } = $props();
  let loadedUrl = $state<string | null>(null);
  let cursor = $state<DockImagePoint | null>(null);
  let surface = $state<SVGSVGElement | null>(null);
  let unit = $state(1);
  let gesture = $state<{
    pointer: number;
    start: DockImagePoint;
    points: DockImagePoint[];
    id: string | null;
    original: DockMarkGeometry | null;
    resize: AnnotationHandleId | null;
    preview: DockMarkGeometry | null;
    radius: number;
    tool: ScreenshotTool;
  } | null>(null);
  let cropGesture = $state<{
    pointer: number;
    start: DockImagePoint;
    original: DockImageRect;
    handle: string; // move, draw, or one of the eight compass handles
  } | null>(null);
  let textInput = $state<HTMLTextAreaElement | null>(null);
  let textValue = $state('');
  let textSession = $state<{ id: string; document: string; original: string } | null>(null);
  const textShape = $derived(shapes.find((shape) => shape.id === editingTextId && shape.text));
  const textLayout = $derived.by(() => {
    const text = textShape?.text;
    if (!text) return null;
    return layoutDockMediaText({
      kind: 'text',
      x: 0,
      y: 0,
      text: textValue,
      fontSize: text.fontSize,
      ...(text.wrapped
        ? { style: 'sticky' as const, width: text.width, padding: text.padding }
        : {}),
    });
  });
  const textLeading = $derived.by(() => {
    const fontSize = textShape?.text?.fontSize ?? 1;
    if (typeof document === 'undefined') return -fontSize * 0.2;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return -fontSize * 0.2;
    context.font = `${fontSize}px ${DOCK_MEDIA_PAINT.fontFamily}`;
    const alphabetic = context.measureText('Mg');
    context.textBaseline = 'top';
    const top = context.measureText('Mg');
    // Canvas top baseline and the browser's 1.4 line box share this font's metrics.
    return (
      (alphabetic.fontBoundingBoxAscent + alphabetic.fontBoundingBoxDescent - fontSize * 1.4) / 2 -
      top.fontBoundingBoxAscent
    );
  });
  const textWidth = $derived.by(() => {
    const text = textShape?.text;
    if (!text || !textLayout) return 0;
    if (text.wrapped || typeof document === 'undefined') return textLayout.width + 2 * unit;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return textLayout.width + 2 * unit;
    context.font = `${text.fontSize}px ${DOCK_MEDIA_PAINT.fontFamily}`;
    return (
      Math.max(...textValue.split('\n').map((line) => context.measureText(line).width)) + 2 * unit
    );
  });
  $effect(() => {
    onGesturePending(!!gesture || !!cropGesture);
  });
  $effect(() => {
    onGesturePreview(
      gesture?.id && gesture.preview ? { id: gesture.id, geometry: gesture.preview } : null,
    );
  });
  onDestroy(() => {
    onGesturePending(false);
    onGesturePreview(null);
  });
  $effect(() => {
    const currentTool = tool,
      cropping = !!cropCandidate;
    untrack(() => {
      if (gesture && gesture.tool !== currentTool) {
        const pointer = gesture.pointer;
        gesture = null;
        release(pointer);
      }
      if (cropGesture && !cropping) {
        const pointer = cropGesture.pointer;
        cropGesture = null;
        release(pointer);
      }
    });
  });
  const visible = $derived(
    shapes.map((shape) =>
      gesture?.id === shape.id && gesture.preview ? { ...shape, geometry: gesture.preview } : shape,
    ),
  );
  const handles = $derived(
    cropCandidate
      ? [
          { id: 'nw', x: cropCandidate.x, y: cropCandidate.y },
          { id: 'n', x: cropCandidate.x + cropCandidate.w / 2, y: cropCandidate.y },
          { id: 'ne', x: cropCandidate.x + cropCandidate.w, y: cropCandidate.y },
          {
            id: 'e',
            x: cropCandidate.x + cropCandidate.w,
            y: cropCandidate.y + cropCandidate.h / 2,
          },
          { id: 'se', x: cropCandidate.x + cropCandidate.w, y: cropCandidate.y + cropCandidate.h },
          {
            id: 's',
            x: cropCandidate.x + cropCandidate.w / 2,
            y: cropCandidate.y + cropCandidate.h,
          },
          { id: 'sw', x: cropCandidate.x, y: cropCandidate.y + cropCandidate.h },
          { id: 'w', x: cropCandidate.x, y: cropCandidate.y + cropCandidate.h / 2 },
        ]
      : [],
  );
  $effect(() => {
    const svg = surface,
      currentFrame = frame;
    if (!svg) return;
    const resize = () => {
      const box = svg.getBoundingClientRect();
      unit =
        1 / Math.max(0.0001, Math.min(box.width / currentFrame.w, box.height / currentFrame.h));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(svg);
    resize();
    return () => observer.disconnect();
  });
  $effect(() => {
    const identity = documentKey;
    untrack(() => {
      const pointers = [gesture?.pointer, cropGesture?.pointer];
      gesture = null;
      cropGesture = null;
      textSession = null;
      editingTextId = null;
      cursor = null;
      loadedUrl = null;
      for (const pointer of pointers) if (pointer !== undefined) release(pointer);
    });
    void identity;
  });
  $effect(() => {
    const id = editingTextId;
    const shape = textShape;
    if (!id || disabled) {
      textSession = null;
      return;
    }
    if (!shape?.text) return;
    if (textSession?.id === id && textSession.document === documentKey) return;
    textSession = { id, document: documentKey, original: shape.text.value };
    textValue = shape.text.value;
  });
  $effect(() => {
    if (textInput && textSession) {
      textInput.focus({ preventScroll: true });
      textInput.select();
    }
  });
  function finishText(save: boolean) {
    const session = textSession,
      value = textValue;
    textSession = null;
    editingTextId = null;
    if (save && !disabled && session?.document === documentKey && value !== session.original)
      onText(session.id, value);
  }
  function point(event: PointerEvent | MouseEvent, clamped = true): DockImagePoint {
    // Invert the actual SVG transform, including preserveAspectRatio letterboxing.
    const matrix = surface?.getScreenCTM();
    if (!matrix) return { x: frame.x, y: frame.y };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return clamped
      ? { x: clamp(p.x, frame.x, frame.x + frame.w), y: clamp(p.y, frame.y, frame.y + frame.h) }
      : { x: p.x, y: p.y };
  }
  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }
  function release(pointer: number) {
    if (surface?.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
  }
  function down(event: PointerEvent) {
    if (disabled || event.button !== 0 || !surface) return;
    const start = point(event, false);
    if (
      start.x < frame.x ||
      start.y < frame.y ||
      start.x > frame.x + frame.w ||
      start.y > frame.y + frame.h
    )
      return;
    event.preventDefault();
    finishText(true);
    surface.focus({ preventScroll: true });
    if (cropCandidate) {
      const handle =
        event.target instanceof Element ? event.target.getAttribute('data-crop-handle') : null;
      const inside =
        start.x >= cropCandidate.x &&
        start.x <= cropCandidate.x + cropCandidate.w &&
        start.y >= cropCandidate.y &&
        start.y <= cropCandidate.y + cropCandidate.h;
      cropGesture = {
        pointer: event.pointerId,
        start,
        original: { ...cropCandidate },
        handle: handle ?? (inside ? 'move' : 'draw'),
      };
      surface.setPointerCapture(event.pointerId);
      return;
    }
    const hit = event.target instanceof Element ? event.target.closest('[data-shape-id]') : null;
    const id = hit?.getAttribute('data-shape-id') ?? null;
    const shape = shapes.find((item) => item.id === id);
    const selecting = tool === 'pointer';
    if (selecting) onSelect(id, event);
    if (selecting && !shape) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    surface.setPointerCapture(event.pointerId);
    gesture = {
      pointer: event.pointerId,
      start,
      points: [start],
      id: selecting ? id : null,
      original: selecting && shape ? shape.geometry : null,
      resize: (event.target instanceof Element
        ? event.target.getAttribute('data-resize')
        : null) as AnnotationHandleId | null,
      preview: null,
      radius: brushRadius,
      tool: selecting ? 'pointer' : tool,
    };
  }
  function moveCrop(event: PointerEvent) {
    const g = cropGesture;
    if (!g || g.pointer !== event.pointerId) return;
    const p = point(event),
      b = g.original,
      dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    const minW = Math.min(2, frame.w),
      minH = Math.min(2, frame.h);
    if (g.handle === 'move') {
      onCropChange({
        ...b,
        x: clamp(b.x + dx, frame.x, frame.x + frame.w - b.w),
        y: clamp(b.y + dy, frame.y, frame.y + frame.h - b.h),
      });
      return;
    }
    if (g.handle === 'draw') {
      const rect = screenshotRect(g.start, p);
      if (rect.w >= minW && rect.h >= minH) onCropChange(rect);
      return;
    }
    let left = b.x,
      top = b.y,
      right = b.x + b.w,
      bottom = b.y + b.h;
    if (g.handle.includes('w')) left = clamp(b.x + dx, frame.x, right - minW);
    if (g.handle.includes('e')) right = clamp(b.x + b.w + dx, left + minW, frame.x + frame.w);
    if (g.handle.includes('n')) top = clamp(b.y + dy, frame.y, bottom - minH);
    if (g.handle.includes('s')) bottom = clamp(b.y + b.h + dy, top + minH, frame.y + frame.h);
    onCropChange({ x: left, y: top, w: right - left, h: bottom - top });
  }
  function move(event: PointerEvent) {
    const hover = point(event, false);
    cursor =
      hover.x >= frame.x &&
      hover.y >= frame.y &&
      hover.x <= frame.x + frame.w &&
      hover.y <= frame.y + frame.h
        ? hover
        : null;
    if (cropGesture) {
      moveCrop(event);
      return;
    }
    const g = gesture;
    if (!g || g.pointer !== event.pointerId) return;
    const current = point(event);
    let preview: DockMarkGeometry;
    if (g.original) {
      const b = dockGeometryRect(g.original);
      const stroke = shapes.find((shape) => shape.id === g.id)?.blurStroke;
      if (stroke && !g.resize) {
        // A brush may cover the source edge; clamp its centers, not its overhanging radius.
        const xs = stroke.points.map((p) => p.x),
          ys = stroke.points.map((p) => p.y);
        const dx = clamp(
          current.x - g.start.x,
          frame.x - Math.min(...xs),
          frame.x + frame.w - Math.max(...xs),
        );
        const dy = clamp(
          current.y - g.start.y,
          frame.y - Math.min(...ys),
          frame.y + frame.h - Math.max(...ys),
        );
        preview = { kind: 'rect', ...b, x: b.x + dx, y: b.y + dy };
      } else if (g.resize) {
        preview = resizeAnnotationGeometry(
          g.original,
          g.resize,
          current.x - g.start.x,
          current.y - g.start.y,
          frame,
        );
      } else
        preview = moveScreenshotGeometry(
          g.original,
          { x: current.x - g.start.x, y: current.y - g.start.y },
          frame,
        );
    } else if (g.tool === 'draw' || g.tool === 'blur') {
      const previous = g.points.at(-1)!;
      const points =
        g.points.length < (g.tool === 'blur' ? 4096 : 256) &&
        Math.hypot(current.x - previous.x, current.y - previous.y) > 0.1
          ? [...g.points, current]
          : g.points;
      gesture = { ...g, points, preview: { kind: 'path', points } };
      return;
    } else if (g.tool === 'arrow') preview = { kind: 'arrow', from: g.start, to: current };
    else preview = { kind: 'rect', ...screenshotRect(g.start, current) };
    gesture = { ...g, preview };
  }
  function up(event: PointerEvent) {
    if (cropGesture?.pointer === event.pointerId) {
      moveCrop(event);
      cropGesture = null;
      release(event.pointerId);
      return; // Local candidate only.
    }
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const end = point(event);
    if (gesture.original && Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) < 0.001) {
      gesture = null;
      release(event.pointerId);
      return;
    }
    move(event);
    const g = gesture;
    gesture = null;
    release(event.pointerId);
    if (g && !g.original && g.tool === 'blur') {
      onBlurStroke(g.points, g.radius);
      return;
    }
    const b = g?.preview ? dockGeometryRect(g.preview) : null;
    const autoWidthText = !!g && !g.original && g.tool === 'text' && (!b || Math.min(b.w, b.h) < 2);
    if (g && autoWidthText) {
      const w = Math.min(160 * unit, frame.w, 4096),
        h = Math.min(40 * unit, frame.h);
      if (w < 2 || h < 2) return;
      g.preview = {
        kind: 'rect',
        x: clamp(g.start.x, frame.x, frame.x + frame.w - w),
        y: clamp(g.start.y, frame.y, frame.y + frame.h - h),
        w,
        h,
      };
    }
    if (!g?.preview) return;
    const bounds = dockGeometryRect(g.preview);
    if (!g.original && Math.max(bounds.w, bounds.h) < 2) return;
    if (g.id) onTransform(g.id, g.preview);
    else onDraw(g.tool, g.preview, unit, autoWidthText);
  }
  function cancelPointer() {
    const crop = cropGesture;
    cropGesture = null;
    gesture = null;
    if (crop) onCropChange(crop.original);
  }
  function key(event: KeyboardEvent) {
    if (disabled || (tool !== 'pointer' && !cropCandidate)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !cropCandidate) {
      event.preventDefault();
      event.stopPropagation();
      onSelectAll();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !cropCandidate) {
      event.preventDefault();
      event.stopPropagation();
      onDelete();
      return;
    }
    const shifts: Record<string, DockImagePoint> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const delta = shifts[event.key];
    if (!delta || event.metaKey || event.ctrlKey || event.altKey) return;
    if (cropCandidate) {
      event.preventDefault();
      event.stopPropagation();
      const b = cropCandidate;
      onCropChange(
        event.shiftKey
          ? {
              ...b,
              w: clamp(b.w + delta.x, Math.min(2, frame.w), frame.x + frame.w - b.x),
              h: clamp(b.h + delta.y, Math.min(2, frame.h), frame.y + frame.h - b.y),
            }
          : {
              ...b,
              x: clamp(b.x + delta.x, frame.x, frame.x + frame.w - b.w),
              y: clamp(b.y + delta.y, frame.y, frame.y + frame.h - b.h),
            },
      );
      return;
    }
    const shape = shapes.find((item) => item.id === selectedId);
    if (!shape) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      const b = dockGeometryRect(shape.geometry);
      onTransform(
        shape.id,
        fitScreenshotGeometry(shape.geometry, {
          ...b,
          w: clamp(b.w + delta.x, 2, frame.x + frame.w - b.x),
          h: clamp(b.h + delta.y, 2, frame.y + frame.h - b.y),
        }),
      );
    } else onTransform(shape.id, moveScreenshotGeometry(shape.geometry, delta, frame));
  }
  function doubleClick(event: MouseEvent) {
    if (disabled || tool !== 'pointer' || cropCandidate || isTextEntryTarget(event.target)) return;
    const targetId =
      event.target instanceof Element
        ? event.target.closest('[data-shape-id]')?.getAttribute('data-shape-id')
        : null;
    // Pointer capture can retarget a native double-click to the SVG itself.
    const at = point(event, false);
    const id =
      targetId ??
      shapes.findLast((shape) => {
        if (!shape.text) return false;
        const b = dockGeometryRect(shape.geometry);
        return at.x >= b.x && at.y >= b.y && at.x <= b.x + b.w && at.y <= b.y + b.h;
      })?.id;
    if (id && shapes.some((shape) => shape.id === id && shape.text)) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(id);
      editingTextId = id;
    }
  }
</script>

<svelte:window
  onkeydowncapture={(event) => {
    if (event.key === 'Escape' && (gesture || cropGesture)) {
      event.preventDefault();
      cancelPointer();
    }
  }}
/>

<div class="canvas-stage">
  <svg
    bind:this={surface}
    class="canvas"
    class:hidden
    data-tool={tool}
    viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
    preserveAspectRatio="xMidYMid meet"
    role="application"
    aria-label={m.dock_screenshotEditor_canvas()}
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={cancelPointer}
    onlostpointercapture={cancelPointer}
    onpointerleave={() => {
      if (!gesture) cursor = null;
    }}
    onkeydown={key}
    ondblclick={doubleClick}
  >
    {#if loadedUrl}
      <image
        href={loadedUrl}
        x={raster ? frame.x : 0}
        y={raster ? frame.y : 0}
        width={raster ? frame.w : width}
        height={raster ? frame.h : height}
      />
    {/if}
    {#each [sourceUrl] as incomingUrl (incomingUrl)}
      <image
        href={incomingUrl}
        x={raster ? frame.x : 0}
        y={raster ? frame.y : 0}
        width={raster ? frame.w : width}
        height={raster ? frame.h : height}
        onload={(event) => {
          // This node belongs to one URL for its entire lifetime. Delayed events
          // from a retired node cannot acknowledge its replacement's resource.
          if (incomingUrl !== sourceUrl || event.currentTarget.href.baseVal !== incomingUrl) return;
          loadedUrl = incomingUrl;
          onRasterReady?.(incomingUrl);
        }}
        onerror={(event) => {
          if (incomingUrl === sourceUrl && event.currentTarget.href.baseVal === incomingUrl)
            onRasterError?.(incomingUrl);
        }}
      />
    {/each}
    {#if redactionPending}
      <g class="pending-redactions" aria-hidden="true">
        {#each pendingRedactions as shape (shape.id)}
          {#if shape.blurStroke}
            {#if shape.blurStroke.points.length === 1}
              <circle
                cx={shape.blurStroke.points[0].x}
                cy={shape.blurStroke.points[0].y}
                r={shape.blurStroke.radius}
              />
            {:else}
              <path
                fill="none"
                stroke="currentColor"
                stroke-width={shape.blurStroke.radius * 2}
                d={screenshotPath({ kind: 'path', points: shape.blurStroke.points })}
              />
            {/if}
          {:else}
            {@const bounds = dockGeometryRect(shape.geometry)}
            <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} />
          {/if}
        {/each}
      </g>
    {/if}
    <g class:cropping={!!cropCandidate}>
      {#if tool === 'pointer' && !cropCandidate}
        {#each visible as shape (shape.id)}
          {@const b = dockGeometryRect(shape.geometry)}
          <g data-shape-id={shape.id} class="shape">
            {#if shape.blurStroke}
              <path
                class="brush-hit"
                style:stroke-width={shape.blurStroke.radius * 2}
                d={shape.blurStroke.points.length === 1
                  ? `M${shape.blurStroke.points[0].x},${shape.blurStroke.points[0].y}l.001,0`
                  : screenshotPath({ kind: 'path', points: shape.blurStroke.points })}
              />
            {:else if shape.geometry.kind === 'rect'}<rect
                class="shape-hit"
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
              />
            {:else}<path class="path-hit" d={screenshotPath(shape.geometry)} />{/if}
            {#if !cropCandidate && editingTextId !== shape.id && (selectedIds.includes(shape.id) || selectedId === shape.id)}
              {#each annotationHandles(shape.geometry) as handle (handle.id)}
                <rect
                  data-resize={handle.id}
                  class="selection-hit"
                  style:cursor={handle.id === 'from' || handle.id === 'to'
                    ? 'move'
                    : handle.id === 'nw' || handle.id === 'se'
                      ? 'nwse-resize'
                      : 'nesw-resize'}
                  x={clamp(
                    handle.x - 8 * unit,
                    frame.x,
                    frame.x + frame.w - Math.min(16 * unit, frame.w),
                  )}
                  y={clamp(
                    handle.y - 8 * unit,
                    frame.y,
                    frame.y + frame.h - Math.min(16 * unit, frame.h),
                  )}
                  width={Math.min(16 * unit, frame.w)}
                  height={Math.min(16 * unit, frame.h)}
                />
                <circle class="selection-handle" cx={handle.x} cy={handle.y} r={2.5 * unit} />
              {/each}
            {/if}
          </g>
        {/each}
      {/if}
    </g>
    {#if gesture?.preview && !gesture.id}
      {@const b = dockGeometryRect(gesture.preview)}
      {#if tool === 'blur'}
        <path
          class="brush-guide"
          style:stroke-width={gesture.radius * 2}
          d={screenshotPath(gesture.preview)}
        />
      {:else if gesture.preview.kind === 'rect'}<rect
          class="mark preview"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
        />
      {:else}<path class="mark preview" d={screenshotPath(gesture.preview)} />{/if}
    {/if}
    {#if tool === 'blur' && cursor && !disabled && !cropCandidate}
      <circle class="brush-cursor" cx={cursor.x} cy={cursor.y} r={brushRadius} />
    {/if}
    {#if cropCandidate}
      {@const c = cropCandidate}
      <path
        class="crop-dim"
        fill-rule="evenodd"
        d={`M${frame.x},${frame.y}h${frame.w}v${frame.h}h${-frame.w}Z M${c.x},${c.y}h${c.w}v${c.h}h${-c.w}Z`}
      />
      <rect class="crop-boundary" x={c.x} y={c.y} width={c.w} height={c.h} />
      {#each handles as handle (handle.id)}
        <rect
          class="handle crop-handle"
          data-crop-handle={handle.id}
          style:cursor={`${handle.id}-resize`}
          x={clamp(handle.x - 5 * unit, frame.x, frame.x + frame.w - 10 * unit)}
          y={clamp(handle.y - 5 * unit, frame.y, frame.y + frame.h - 10 * unit)}
          width={10 * unit}
          height={10 * unit}
        />
      {/each}
    {/if}
    {#if textShape?.text && textLayout && textSession && editingRasterReady}
      {@const b = dockGeometryRect(textShape.geometry)}
      <foreignObject
        x={b.x}
        y={b.y}
        width={Math.min(frame.x + frame.w - b.x, Math.max(12 * unit, textWidth))}
        height={Math.min(frame.y + frame.h - b.y, textLayout.height)}
        style:overflow="visible"
      >
        <div
          class="inline-text"
          style:font-size={`${textShape.text.fontSize}px`}
          style:font-family={DOCK_MEDIA_PAINT.fontFamily}
          style:--capture-text-accent={DOCK_MEDIA_PAINT.accent}
          style:--capture-text-halo={DOCK_MEDIA_PAINT.halo}
          style:--capture-text-stroke={`${2 * Math.max(1, Math.max(width, height) / 1440)}px`}
          style:--capture-text-outline={`${unit}px`}
          style:--capture-text-leading={`${textLeading}px`}
          style:padding={`${textShape.text.padding}px`}
          onpointerdown={(event) => event.stopPropagation()}
          onkeydown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              finishText(false);
              surface?.focus();
            } else if (
              (event.metaKey || event.ctrlKey) &&
              (event.key === 'Enter' || event.key.toLowerCase() === 's')
            ) {
              event.preventDefault();
              finishText(true);
              surface?.focus();
            }
          }}
          role="group"
        >
          <Textarea
            bind:ref={textInput}
            bind:value={textValue}
            class="text-input"
            maxlength={10000}
            wrap={textShape.text.wrapped ? 'soft' : 'off'}
            aria-label={m.dock_screenshotEditor_text()}
            minHeight={0}
            noFocusStyle
            onblur={() => finishText(true)}
          />
        </div>
      </foreignObject>
    {/if}
  </svg>
</div>

<style>
  .canvas-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: hsl(var(--muted));
    border-radius: var(--radius-medium);
  }
  .canvas {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 0;
    touch-action: none;
    outline: none;
    overflow: hidden;
  }
  .canvas.hidden {
    visibility: hidden;
  }
  .canvas:focus-visible {
    outline: none;
  }
  .canvas:focus-visible .selection-handle {
    fill: hsl(var(--primary-ink));
  }
  .pending-redactions {
    fill: currentColor;
    color: hsl(var(--muted-foreground));
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .shape {
    cursor: move;
  }
  .cropping {
    pointer-events: none;
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
  .brush-hit {
    fill: none;
    stroke: transparent;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .brush-guide {
    fill: none;
    stroke: hsl(var(--primary) / 0.25);
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .brush-cursor {
    fill: transparent;
    stroke: hsl(var(--foreground));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .selection-hit {
    fill: transparent;
    stroke: none;
    pointer-events: all;
  }
  .selection-handle {
    fill: hsl(var(--background));
    stroke: hsl(var(--primary-ink));
    stroke-width: 1;
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
  .crop-dim {
    fill: hsl(var(--background) / 0.65);
    pointer-events: none;
  }
  .crop-boundary {
    fill: transparent;
    stroke: hsl(var(--primary));
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    cursor: move;
  }
  .inline-text {
    width: 100%;
    height: 100%;
    line-height: 1.4;
    box-sizing: border-box;
    outline: var(--capture-text-outline) solid hsl(var(--ring));
  }
  .inline-text :global(.text-input) {
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 0;
    resize: none;
    font: inherit;
    font-weight: 400;
    letter-spacing: normal;
    -webkit-font-smoothing: auto;
    line-height: inherit;
    border-radius: 0;
    border: 0;
    background: transparent;
    color: var(--capture-text-accent);
    caret-color: var(--capture-text-accent);
    -webkit-text-stroke: var(--capture-text-stroke) var(--capture-text-halo);
    paint-order: stroke fill;
    position: relative;
    top: var(--capture-text-leading);
    box-shadow: none;
  }
</style>
