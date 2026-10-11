import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Spring,
  fade,
  onReducedMotionChange,
  prefersReducedMotion,
  usePresence,
  usePresenceTransition,
  type SpringTierName,
} from '@/lib/motion';
import { reconcileSelectionGroups, type SelectedIndexes } from '@/lib/interaction/merge-split';
import {
  useProximityHover,
  type ItemRect,
  type ProximityHover,
} from '@/lib/interaction/proximity-hover';

export interface ProximityHighlightProps {
  store: ProximityHover;
  selectedIndexes?: SelectedIndexes;
  selectedClass?: string;
  hoverClass?: string;
  className?: string;
}
const noSelection: readonly number[] = [];
const selectedExit = (node: HTMLElement) => fade(node, { tier: 'moderate' }, { direction: 'both' });
const hoverExit = (node: HTMLElement) => fade(node, { tier: 'fast' }, { direction: 'both' });

function HighlightRect({
  rect,
  kind,
  className,
  present,
  onExit,
  tier = 'moderate',
}: {
  rect: ItemRect;
  kind: 'selected' | 'hover';
  className: string;
  present: boolean;
  onExit: () => void;
  tier?: SpringTierName;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const motions = useRef<{
    top: Spring<number>;
    left: Spring<number>;
    width: Spring<number>;
    height: Spring<number>;
  } | null>(null);
  const target = useRef(rect);
  useLayoutEffect(() => {
    target.current = rect;
  }, [rect]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const initial = target.current;
    const values = {
      top: new Spring(initial.top, tier),
      left: new Spring(initial.left, tier),
      width: new Spring(initial.width, tier),
      height: new Spring(initial.height, tier),
    };
    motions.current = values;
    const write = () => {
      node.style.transform = `translate3d(${values.left.current}px,${values.top.current}px,0)`;
      node.style.width = `${values.width.current}px`;
      node.style.height = `${values.height.current}px`;
    };
    const cleanups = Object.values(values).map((motion) => motion.subscribe(write));
    const reduce = onReducedMotionChange(() => {
      if (!prefersReducedMotion(node.ownerDocument)) return;
      for (const key of ['top', 'left', 'width', 'height'] as const)
        void values[key].set(target.current[key], { instant: true });
    }, node.ownerDocument);
    write();
    return () => {
      cleanups.forEach((stop) => stop());
      reduce();
      Object.values(values).forEach((motion) => motion.destroy());
      motions.current = null;
    };
  }, [tier]);
  useLayoutEffect(() => {
    for (const key of ['top', 'left', 'width', 'height'] as const)
      void motions.current?.[key].set(rect[key]);
  }, [rect, tier]);
  usePresenceTransition(
    ref,
    present,
    onExit,
    kind === 'hover' ? hoverExit : selectedExit,
    true,
    false,
  );
  return (
    <div
      ref={ref}
      data-proximity-highlight={kind}
      className={cn('absolute', className)}
      style={{ borderRadius: 'var(--radius-row)' }}
    />
  );
}

/** Source: ProximityHighlight.svelte. One continuous hover rectangle, stable merged selection groups. */
export function ProximityHighlight({
  store,
  selectedIndexes = noSelection,
  selectedClass = 'bg-selected',
  hoverClass = 'bg-hover',
  className,
}: ProximityHighlightProps) {
  useProximityHover(store);
  const rects = store.itemRects;
  const [selection, setSelection] = useState(() => ({
    rects,
    selectedIndexes,
    ...reconcileSelectionGroups([], rects, selectedIndexes, 1),
  }));
  let groups = selection.groups;
  if (selection.rects !== rects || selection.selectedIndexes !== selectedIndexes) {
    const next = reconcileSelectionGroups(
      selection.groups,
      rects,
      selectedIndexes,
      selection.nextId,
    );
    groups = next.groups;
    setSelection({ rects, selectedIndexes, ...next });
  }
  const selected = usePresence(groups, (group) => group.id);
  const activeRect = store.activeIndex === null ? undefined : rects[store.activeIndex];
  const sessionId = store.sessionId;
  const active = useMemo(
    () => (activeRect ? [{ id: sessionId, rect: activeRect }] : []),
    [activeRect, sessionId],
  );
  const hover = usePresence(active, (entry) => entry.id);
  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0', className)}>
      {selected.entries.map(({ key, value, present }) => (
        <HighlightRect
          key={key}
          rect={value.rect}
          kind="selected"
          className={selectedClass}
          present={present}
          onExit={() => selected.remove(key)}
        />
      ))}
      {hover.entries.map(({ key, value, present }) => (
        <HighlightRect
          key={key}
          rect={value.rect}
          kind="hover"
          className={hoverClass}
          present={present}
          onExit={() => hover.remove(key)}
        />
      ))}
    </div>
  );
}
