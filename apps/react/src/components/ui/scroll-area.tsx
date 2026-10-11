// Based on shadcn/ui scroll-area; orientation and edge fades mirror scroll-area.svelte.
import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  orientation?: 'vertical' | 'horizontal' | 'both';
  scrollbarXClasses?: string;
  scrollbarYClasses?: string;
  fadeEdges?: boolean;
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
};
export function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  scrollbarXClasses,
  scrollbarYClasses,
  fadeEdges = true,
  viewportRef,
  viewportProps,
  ...props
}: ScrollAreaProps) {
  const viewport = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(viewportRef, () => viewport.current!, []);
  const [edges, setEdges] = React.useState({ top: true, bottom: true, left: true, right: true });
  const updateEdges = React.useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const next = {
      top: node.scrollTop <= 0,
      bottom: node.scrollTop + node.clientHeight >= node.scrollHeight - 1,
      left: node.scrollLeft <= 0,
      right: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1,
    };
    setEdges((previous) =>
      Object.keys(next).every(
        (key) => previous[key as keyof typeof next] === next[key as keyof typeof next],
      )
        ? previous
        : next,
    );
  }, []);
  React.useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [updateEdges]);
  const masks: string[] = [];
  // Black is mask opacity, not a physical product color.
  if (fadeEdges && orientation !== 'horizontal' && (!edges.top || !edges.bottom))
    masks.push(
      `linear-gradient(to bottom, ${edges.top ? 'black 0' : 'transparent 0, black 12px'}, ${edges.bottom ? 'black 100%' : 'black calc(100% - 12px), transparent 100%'})`,
    );
  if (fadeEdges && orientation !== 'vertical' && (!edges.left || !edges.right))
    masks.push(
      `linear-gradient(to right, ${edges.left ? 'black 0' : 'transparent 0, black 12px'}, ${edges.right ? 'black 100%' : 'black calc(100% - 12px), transparent 100%'})`,
    );
  const mask = masks.length ? masks.join(', ') : undefined;
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      data-orientation={orientation}
      className={cn('relative overflow-hidden', className)}
      type="scroll"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...viewportProps}
        ref={viewport}
        data-slot="scroll-area-viewport"
        tabIndex={0}
        className={cn(
          'size-full rounded-[inherit] transition-[mask-image] duration-(--motion-fast) focus-visible:outline focus-visible:-outline-offset-1 motion-reduce:transition-none',
          viewportProps?.className,
        )}
        style={{ maskImage: mask, WebkitMaskImage: mask, ...viewportProps?.style }}
        onScroll={(event) => {
          updateEdges();
          viewportProps?.onScroll?.(event);
        }}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' && (
        <ScrollBar orientation="vertical" className={scrollbarYClasses} />
      )}
      {orientation !== 'vertical' && (
        <ScrollBar orientation="horizontal" className={scrollbarXClasses} />
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
export function ScrollBar({
  orientation = 'vertical',
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      forceMount
      {...props}
    >
      {children}
      <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
export { ScrollBar as Scrollbar };
