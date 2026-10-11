// Source: src/lib/components/ui/sidebar/sidebar-rail.svelte.
import { useEffect, useRef, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { useSidebar } from './context';

export function SidebarRail({
  ref,
  className,
  children,
  onClick,
  onPointerEnter,
  onPointerDown,
  ...props
}: ComponentProps<'button'>) {
  const sidebar = useSidebar();
  const suppressClick = useRef(false);
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  return (
    <Button
      {...props}
      ref={ref}
      variant="plain"
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label={m.ui_sidebar_toggle_label()}
      tabIndex={-1}
      title={m.ui_sidebar_toggle_label()}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        sidebar.requestPeek('hover');
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        event.preventDefault();
        stopDrag.current?.();
        sidebar.dismissPeek();
        const startX = event.clientX;
        const measured =
          event.currentTarget.closest('[data-slot="sidebar-container"]')?.getBoundingClientRect()
            .width ?? Number.NaN;
        const parsed = sidebar.width.endsWith('px') ? Number.parseFloat(sidebar.width) : Number.NaN;
        const startWidth = !sidebar.open
          ? 0
          : measured > 0
            ? measured
            : Number.isFinite(parsed)
              ? parsed
              : 256;
        let dragged = false;
        const move = (next: PointerEvent) => {
          const delta = (next.clientX - startX) * (sidebar.side === 'left' ? 1 : -1);
          dragged ||= Math.abs(delta) > 2;
          if (!dragged) return;
          const requested = startWidth + delta;
          sidebar.setWidth(Math.max(160, Math.min(requested, 360)));
          sidebar.setOpen(requested >= 160);
        };
        const stop = () => {
          suppressClick.current = dragged;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
          window.removeEventListener('pointercancel', stop);
          stopDrag.current = null;
        };
        stopDrag.current = stop;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
        window.addEventListener('pointercancel', stop, { once: true });
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if (!sidebar.open && sidebar.peek === 'click') sidebar.requestPeek('click');
        else sidebar.toggle();
      }}
      className={cn(
        'absolute inset-y-0 z-20 hidden h-auto w-4 rounded-none p-0 -translate-x-1/2 transition-[background-color] duration-spring-fast ease-spring-fast after:absolute after:inset-y-0 after:left-[calc(1/2*100%-1px)] after:w-px after:bg-border hover:after:bg-border motion-reduce:transition-none group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex',
        'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize [[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full [[data-side=left][data-collapsible=offcanvas]_&]:-right-2 [[data-side=right][data-collapsible=offcanvas]_&]:-left-2 group-data-[variant=inset]:inset-y-2',
        className,
      )}
    >
      {children}
    </Button>
  );
}
