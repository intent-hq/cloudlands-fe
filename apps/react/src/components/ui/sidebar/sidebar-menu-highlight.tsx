// Source: sidebar-menu-highlight.svelte. Independent active rectangles preserve nested levels.
import { useLayoutEffect, useRef } from 'react';
import { Spring, fade, usePresenceTransition } from '@/lib/motion';
import type { ItemRect } from '@/lib/interaction';
import { cn } from '@/lib/utils';
const transition = (node: HTMLElement) => fade(node, { tier: 'moderate' });
export function SidebarMenuHighlight({
  rect,
  initialRect,
  identity,
  kind,
  present = true,
  onExit = () => {},
}: {
  rect: ItemRect;
  initialRect?: ItemRect;
  identity: number;
  kind: 'active' | 'hover' | 'focus';
  present?: boolean;
  onExit?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const initial = useRef(initialRect ?? rect);
  const target = useRef({ rect, identity });
  const motion = useRef<{ value: Spring<ItemRect>; identity: number; rect: ItemRect } | null>(null);
  useLayoutEffect(() => {
    target.current = { rect, identity };
  }, [rect, identity]);
  useLayoutEffect(() => {
    const value = new Spring(initial.current, 'moderate');
    motion.current = { value, identity: target.current.identity, rect: target.current.rect };
    const write = () => {
      if (!root.current) return;
      const box = value.current;
      root.current.style.transform = `translate3d(${box.left}px,${box.top}px,0)`;
      root.current.style.width = `${box.width}px`;
      root.current.style.height = `${box.height}px`;
    };
    const stop = value.subscribe(write);
    write();
    void value.set(target.current.rect);
    return () => {
      stop();
      value.destroy();
      motion.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (!motion.current || motion.current.rect === rect) return;
    motion.current.rect = rect;
    const sameRow = motion.current.identity === identity;
    motion.current.identity = identity;
    void motion.current.value.set(rect, { instant: sameRow });
  }, [rect, identity]);
  usePresenceTransition(root, present, onExit, transition);
  return (
    <div
      ref={root}
      aria-hidden="true"
      data-sidebar={`menu-${kind}-highlight`}
      className={cn(
        'pointer-events-none absolute left-0 top-0 rounded-md',
        { active: 'bg-active z-0', hover: 'bg-hover z-0', focus: 'border-focus-ring z-20 border' }[
          kind
        ],
      )}
    />
  );
}
