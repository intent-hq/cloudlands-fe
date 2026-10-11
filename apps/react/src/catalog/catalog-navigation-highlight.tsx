// Port of sidebar-menu-highlight.svelte using the shared React motion implementation.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Spring, fade, usePresence, usePresenceTransition } from '@/lib/motion';
import type { ItemRect } from '@/lib/interaction';

function Highlight({
  rect,
  identity,
  initialRect,
  kind,
  present,
  onExit,
}: {
  rect: ItemRect;
  identity: number;
  initialRect?: ItemRect;
  kind: 'active' | 'hover' | 'focus';
  present: boolean;
  onExit: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const motion = useRef<Spring<ItemRect> | null>(null);
  const previousIdentity = useRef(identity);
  const firstUpdate = useRef(true);
  const initial = useRef(initialRect ?? rect);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const spring = new Spring(initial.current, 'moderate');
    motion.current = spring;
    const write = () => {
      const current = spring.current;
      node.style.transform = `translate3d(${current.left}px, ${current.top}px, 0)`;
      node.style.width = `${current.width}px`;
      node.style.height = `${current.height}px`;
    };
    const stop = spring.subscribe(write);
    write();
    return () => {
      stop();
      spring.destroy();
      motion.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    // Same-row geometry changes settle immediately, as in the source action.
    void motion.current?.set(rect, {
      instant: !firstUpdate.current && previousIdentity.current === identity,
    });
    firstUpdate.current = false;
    previousIdentity.current = identity;
  }, [rect, identity, initialRect]);
  usePresenceTransition(element, present, onExit, transition);
  return (
    <div
      ref={element}
      aria-hidden="true"
      data-sidebar={`menu-${kind}-highlight`}
      className={`catalog-nav-highlight-${kind} pointer-events-none absolute left-0 top-0 rounded-md`}
    />
  );
}

const transition = (node: HTMLElement) => fade(node, { tier: 'moderate' }, { direction: 'both' });
export function CatalogNavigationHighlight({
  rect,
  identity,
  initialRect,
  kind,
}: {
  rect?: ItemRect;
  identity: number | null;
  initialRect?: ItemRect;
  kind: 'active' | 'hover' | 'focus';
}) {
  const items = useMemo(
    () => (rect && identity !== null ? [{ rect, identity, initialRect }] : []),
    [rect, identity, initialRect],
  );
  const presence = usePresence(items, () => 0);
  return (
    <>
      {presence.entries.map((entry) => (
        <Highlight
          key={entry.key}
          {...entry.value}
          kind={kind}
          present={entry.present}
          onExit={() => presence.remove(entry.key)}
        />
      ))}
    </>
  );
}
