import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { formatInteger } from '$lib/i18n/format';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
import { m } from '$shared/paraglide/messages.js';

const MIN_VIEWPORT_PX = 320;
const MAX_VIEWPORT_PX = 3840;
const RESIZE_DEBOUNCE_MS = 150;

export interface BrowserDeviceFrameProps {
  viewport: BrowserTabViewport;
  onViewportChange: (viewport: BrowserTabViewport) => void;
  children?: ReactNode;
}

function clamp(value: number): number {
  return Math.min(MAX_VIEWPORT_PX, Math.max(MIN_VIEWPORT_PX, Math.round(value)));
}

export function BrowserDeviceFrame({
  viewport,
  onViewportChange,
  children,
}: BrowserDeviceFrameProps) {
  const [size, setSize] = useState(() => ({
    width: viewport.mode === 'fit' ? MIN_VIEWPORT_PX : viewport.width,
    height: viewport.mode === 'fit' ? MIN_VIEWPORT_PX : viewport.height,
  }));
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const currentSize = useRef(size);
  const currentCallback = useRef(onViewportChange);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isFit = viewport.mode === 'fit';

  if (
    !dragging &&
    viewport.mode !== 'fit' &&
    (size.width !== viewport.width || size.height !== viewport.height)
  ) {
    setSize({ width: viewport.width, height: viewport.height });
  }

  useLayoutEffect(() => {
    currentSize.current = size;
    currentCallback.current = onViewportChange;
  }, [size, onViewportChange]);

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const publishSize = (width: number, height: number) => setAvailable({ width, height });
    publishSize(node.clientWidth, node.clientHeight);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(([entry]) => {
            publishSize(
              entry?.contentRect.width ?? node.clientWidth,
              entry?.contentRect.height ?? node.clientHeight,
            );
          });
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => () => clearTimeout(resizeTimer.current), []);

  function dispatchCurrentSize() {
    currentCallback.current({ mode: 'custom', ...currentSize.current });
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (isFit || event.button !== 0) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ...currentSize.current,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    const next = {
      width: clamp(start.width + event.clientX - start.x),
      height: clamp(start.height + event.clientY - start.y),
    };
    currentSize.current = next;
    setSize(next);
    clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(dispatchCurrentSize, RESIZE_DEBOUNCE_MS);
  }

  function handlePointerEnd(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    clearTimeout(resizeTimer.current);
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    dispatchCurrentSize();
  }

  const scale =
    !isFit && available.width > 0 && available.height > 0
      ? Math.min(1, available.width / size.width, available.height / size.height)
      : 1;

  return (
    <div
      ref={container}
      className={`flex h-full w-full items-center justify-center overflow-hidden ${isFit ? 'bg-background' : 'bg-muted/40'}`}
      data-browser-device-frame-container
    >
      <div
        className={`relative overflow-hidden bg-background ${isFit ? 'h-full w-full' : dragging ? 'ring-2 ring-primary/30' : ''}`}
        style={{
          width: isFit ? undefined : size.width * scale,
          height: isFit ? undefined : size.height * scale,
        }}
        data-browser-device-frame={isFit ? undefined : ''}
        data-width={isFit ? undefined : size.width}
        data-height={isFit ? undefined : size.height}
      >
        {children}
        {!isFit && (
          <>
            <span
              className="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2 rounded bg-background/90 px-1.5 py-0.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
              data-browser-viewport-readout
            >
              {m.browser_viewport_dimensions_label({
                width: formatInteger(size.width),
                height: formatInteger(size.height),
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              iconOnly
              className="absolute bottom-0 right-0 z-20 size-5 cursor-nwse-resize touch-none border-0 bg-transparent p-0 after:absolute after:bottom-1 after:right-1 after:size-2 after:border-b-2 after:border-r-2 after:border-muted-foreground"
              aria-label={m.browser_viewport_resizeHandle_ariaLabel()}
              data-testid="browser-device-resize-handle"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            />
          </>
        )}
      </div>
    </div>
  );
}
