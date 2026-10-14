import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import './panel-corner-handle.css';

interface PanelCornerHandleProps {
  onResize?: (deltaX: number, deltaY: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  /** Inline style for positioning, matching the source component contract. */
  style?: string;
}

export function PanelCornerHandle(props: PanelCornerHandleProps) {
  const button = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const callbacks = useRef(props);
  const drag = useRef({ active: false, x: 0, y: 0 });
  const lifetime = useRef<object | null>(null);
  const handlers = useRef<{ move: (event: MouseEvent) => void; up: () => void } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useLayoutEffect(() => {
    callbacks.current = props;
  });
  useLayoutEffect(() => {
    if (props.style === undefined) button.current?.removeAttribute('style');
    else button.current?.setAttribute('style', props.style);
  }, [props.style]);
  useLayoutEffect(() => {
    lifetime.current = {};
    return () => {
      lifetime.current = null;
      if (handlers.current) {
        window.removeEventListener('mousemove', handlers.current.move);
        window.removeEventListener('mouseup', handlers.current.up);
        handlers.current = null;
      }
      if (drag.current.active) document.body.classList.remove('panel-resizing');
      drag.current.active = false;
    };
  }, []);

  function handleMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
    const startedLifetime = lifetime.current;
    if (!startedLifetime) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { active: true, x: event.clientX, y: event.clientY };
    setIsDragging(true);
    callbacks.current.onResizeStart?.();
    if (lifetime.current !== startedLifetime) return;
    document.body.classList.add('panel-resizing');
    if (!handlers.current) {
      const move = (next: MouseEvent) => {
        if (!drag.current.active) return;
        const deltaX = next.clientX - drag.current.x;
        const deltaY = next.clientY - drag.current.y;
        if (deltaX !== 0 || deltaY !== 0) {
          callbacks.current.onResize?.(deltaX, deltaY);
          drag.current.x = next.clientX;
          drag.current.y = next.clientY;
        }
      };
      const up = () => {
        drag.current.active = false;
        setIsDragging(false);
        callbacks.current.onResizeEnd?.();
        document.body.classList.remove('panel-resizing');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        handlers.current = null;
      };
      handlers.current = { move, up };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
  }

  return (
    <Button
      ref={button}
      variant="ghost"
      type="button"
      className={cn('app-resize-handle panel-corner-handle rounded-none', isDragging && 'dragging')}
      data-resize-axis="both"
      data-resizing={isDragging}
      aria-label={m.layout_panelCornerHandle_resize_ariaLabel()}
      onMouseDown={handleMouseDown}
    />
  );
}
