// Source: src/lib/components/ui/ZoomPanViewport.svelte.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The source application viewport is keyboard focusable; its native key listener implements zoom shortcuts. */
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  ArrowCounterClockwiseIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { createFormatters } from '$shared/i18n/formatters';

export interface ZoomPanViewportHandle {
  /** Forward native overlay key events; true means the zoom shortcut was consumed. */
  handleKeydown: (event: KeyboardEvent) => boolean;
}

export interface ZoomPanViewportProps {
  children: ReactNode;
  minZoom?: number;
  maxZoom?: number;
  onScaleChange?: (scale: number) => void;
  ref?: Ref<ZoomPanViewportHandle>;
}

const KEYBOARD_ZOOM_FACTOR = 1.25;
const WHEEL_ZOOM_INTENSITY = 0.0015;
const PINCH_ZOOM_INTENSITY = 0.01;
const DRAG_CLICK_SUPPRESS_THRESHOLD_PX = 4;
const { formatNumber } = createFormatters(getLocale);
type Transform = { scale: number; offsetX: number; offsetY: number };

export function ZoomPanViewport({
  children,
  minZoom = 0.25,
  maxZoom = 8,
  onScaleChange,
  ref,
}: ZoomPanViewportProps) {
  const [transform, setTransform] = useState<Transform>({ scale: 1, offsetX: 0, offsetY: 0 });
  // Event handlers see each update immediately, including multiple wheel events per render.
  const currentTransform = useRef(transform);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ pointerId: null as number | null, x: 0, y: 0, distance: 0 });
  const suppressNextClick = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY } = transform;

  useEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);

  function updateTransform(next: Transform) {
    currentTransform.current = next;
    setTransform(next);
  }
  function clampScale(value: number) {
    return Math.min(maxZoom, Math.max(minZoom, value));
  }
  function zoomAtPoint(clientX: number, clientY: number, targetScale: number) {
    const next = clampScale(targetScale);
    const rect = viewport.current?.getBoundingClientRect();
    const px = rect ? clientX - rect.left : 0;
    const py = rect ? clientY - rect.top : 0;
    const current = currentTransform.current;
    updateTransform({
      scale: next,
      offsetX: px - ((px - current.offsetX) / current.scale) * next,
      offsetY: py - ((py - current.offsetY) / current.scale) * next,
    });
  }
  function zoomAtCenter(targetScale: number) {
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, targetScale);
    else updateTransform({ ...currentTransform.current, scale: clampScale(targetScale) });
  }
  function resetZoom() {
    updateTransform({ scale: 1, offsetX: 0, offsetY: 0 });
  }
  function handleKeydown(event: KeyboardEvent): boolean {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === '+' || event.key === '=') {
      zoomAtCenter(currentTransform.current.scale * KEYBOARD_ZOOM_FACTOR);
    } else if (event.key === '-') {
      zoomAtCenter(currentTransform.current.scale / KEYBOARD_ZOOM_FACTOR);
    } else if (event.key === '0') {
      resetZoom();
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  }
  useImperativeHandle(ref, () => ({ handleKeydown }));

  const handleNativeKeydown = useEffectEvent(handleKeydown);
  const handleWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    const intensity = event.ctrlKey ? PINCH_ZOOM_INTENSITY : WHEEL_ZOOM_INTENSITY;
    zoomAtPoint(
      event.clientX,
      event.clientY,
      currentTransform.current.scale * Math.exp(-event.deltaY * intensity),
    );
  });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.addEventListener('wheel', handleWheel, { passive: false });
    element.addEventListener('keydown', handleNativeKeydown);
    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('keydown', handleNativeKeydown);
    };
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button > 0) return;
    setDragging(true);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current.pointerId === null || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    current.distance += Math.abs(dx) + Math.abs(dy);
    updateTransform({
      ...currentTransform.current,
      offsetX: currentTransform.current.offsetX + dx,
      offsetY: currentTransform.current.offsetY + dy,
    });
    current.x = event.clientX;
    current.y = event.clientY;
  }
  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current.pointerId === null || event.pointerId !== current.pointerId) return;
    setDragging(false);
    current.pointerId = null;
    if (current.distance > DRAG_CLICK_SUPPRESS_THRESHOLD_PX) suppressNextClick.current = true;
    const element = event.currentTarget;
    if (
      typeof element.hasPointerCapture === 'function' &&
      typeof element.releasePointerCapture === 'function' &&
      element.hasPointerCapture(event.pointerId)
    ) {
      element.releasePointerCapture(event.pointerId);
    }
  }
  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressNextClick.current) return;
    suppressNextClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={viewport}
      className={cn(
        'relative h-full w-full touch-none select-none overflow-hidden',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      role="application"
      aria-label={m.ui_zoomPanViewport_viewport_ariaLabel()}
      tabIndex={0}
      data-testid="zoom-pan-viewport"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={handleClickCapture}
    >
      <div
        className="flex h-full w-full items-center justify-center will-change-transform"
        style={{
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
        data-testid="zoom-pan-content"
      >
        {children}
      </div>
      <div
        className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 cursor-default items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm"
        role="toolbar"
        aria-label={m.ui_zoomPanViewport_controls_ariaLabel()}
        tabIndex={-1}
        data-testid="zoom-pan-controls"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/20 hover:text-white"
          onClick={() => zoomAtCenter(currentTransform.current.scale / KEYBOARD_ZOOM_FACTOR)}
          aria-label={m.ui_zoomPanViewport_zoomOut_ariaLabel()}
          title={m.ui_zoomPanViewport_zoomOut_ariaLabel()}
        >
          <MagnifyingGlassMinusIcon aria-hidden="true" />
        </Button>
        <div className="w-36">
          <Slider
            className="accent-white"
            min={minZoom}
            max={maxZoom}
            step="0.01"
            value={scale}
            onInput={(event) => {
              const value = Number.parseFloat(event.currentTarget.value);
              if (Number.isFinite(value)) zoomAtCenter(value);
            }}
            aria-label={m.ui_zoomPanViewport_zoomSlider_ariaLabel()}
            title={m.ui_zoomPanViewport_zoomSlider_ariaLabel()}
            data-testid="zoom-pan-slider"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/20 hover:text-white"
          onClick={() => zoomAtCenter(currentTransform.current.scale * KEYBOARD_ZOOM_FACTOR)}
          aria-label={m.ui_zoomPanViewport_zoomIn_ariaLabel()}
          title={m.ui_zoomPanViewport_zoomIn_ariaLabel()}
        >
          <MagnifyingGlassPlusIcon aria-hidden="true" />
        </Button>
        <span
          className="min-w-12 text-center text-xs tabular-nums text-white/90"
          data-testid="zoom-pan-percent"
        >
          {formatNumber(scale, { style: 'percent', maximumFractionDigits: 0 })}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/20 hover:text-white"
          onClick={resetZoom}
          aria-label={m.ui_zoomPanViewport_resetZoom_ariaLabel()}
          title={m.ui_zoomPanViewport_resetZoom_ariaLabel()}
        >
          <ArrowCounterClockwiseIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default ZoomPanViewport;
