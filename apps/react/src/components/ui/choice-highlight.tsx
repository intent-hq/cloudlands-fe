import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ProximityHighlight } from '@/lib/interaction/proximity-highlight';
import {
  createProximityHover,
  useProximityHover,
  type ItemRect,
  type ProximityHover,
  type ProximityAxis,
} from '@/lib/interaction/proximity-hover';
import { Spring, prefersReducedMotion } from '@/lib/motion';

function TabsIndicator({ rect }: { rect: ItemRect }) {
  const root = useRef<HTMLDivElement>(null);
  const initial = useRef(rect);
  const motions = useRef<Record<keyof ItemRect, Spring<number>> | null>(null);
  useLayoutEffect(() => {
    const values = {
      left: new Spring(initial.current.left, 'moderate'),
      top: new Spring(initial.current.top, 'moderate'),
      width: new Spring(initial.current.width, 'moderate'),
      height: new Spring(initial.current.height, 'moderate'),
    };
    motions.current = values;
    const write = () => {
      if (!root.current) return;
      root.current.style.transform = `translate3d(${values.left.current}px, ${values.top.current}px, 0)`;
      root.current.style.width = `${values.width.current}px`;
      root.current.style.height = `${values.height.current}px`;
    };
    const cleanup = Object.values(values).map((value) => value.subscribe(write));
    write();
    return () => {
      cleanup.forEach((stop) => stop());
      Object.values(values).forEach((value) => value.destroy());
      motions.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    for (const key of ['left', 'top', 'width', 'height'] as const)
      void motions.current?.[key].set(rect[key], { instant: prefersReducedMotion() });
  }, [rect]);
  return (
    <div
      ref={root}
      aria-hidden="true"
      data-tabs-indicator
      className="pointer-events-none absolute left-0 top-0 bg-card dark:bg-surface-3 shadow-(--elevation-raised)"
      style={{ borderRadius: 'var(--radius-medium)' }}
    />
  );
}

/** Connect native choice semantics to the shared proximity geometry and motion owners. */
export function ChoiceHighlight({
  containerRef,
  selector,
  selectedSelector,
  axis = 'x',
  variant = 'group',
}: {
  containerRef: RefObject<HTMLElement | null>;
  selector: string;
  selectedSelector: string;
  axis?: ProximityAxis;
  variant?: 'group' | 'default' | 'subtle' | 'underline';
}) {
  const [state, setState] = useState<{ store: ProximityHover | null; selected: number[] }>({
    store: null,
    selected: [],
  });
  useProximityHover(state.store);
  // The list host attaches its ref after child layout effects; subscribe after all refs attach.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    let items: HTMLElement[] = [];
    const store = createProximityHover(node, { axis });
    const update = () => {
      const selected = items.flatMap((item, index) =>
        item.matches(selectedSelector) ? [index] : [],
      );
      items.forEach((item, index) => {
        if (index === store.activeIndex) item.dataset.proximityActive = 'true';
        else delete item.dataset.proximityActive;
      });
      setState((previous) =>
        previous.store === store &&
        previous.selected.length === selected.length &&
        previous.selected.every((item, index) => item === selected[index])
          ? previous
          : { store, selected },
      );
    };
    const unsubscribe = store.subscribe(update);
    const register = () => {
      const nextItems = Array.from(node.querySelectorAll<HTMLElement>(selector));
      for (let index = nextItems.length; index < items.length; index++)
        store.registerItem(index, null);
      items = nextItems;
      items.forEach((item, index) => store.registerItem(index, item));
      update();
    };
    register();
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) register();
      else update();
    });
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    const focus = (event: FocusEvent) => {
      const index = items.findIndex(
        (item) => item === event.target || item.contains(event.target as Node),
      );
      if (index >= 0) store.setActiveIndex(index);
    };
    node.addEventListener('focusin', focus);
    return () => {
      observer.disconnect();
      unsubscribe();
      store.destroy();
      node.removeEventListener('focusin', focus);
    };
  }, [containerRef, selector, selectedSelector, axis]);
  if (!state.store || variant === 'underline') return null;
  const selectedHover =
    state.store.activeIndex !== null && state.selected.includes(state.store.activeIndex);
  if (variant === 'default') {
    const rect = state.store.itemRects[state.selected[0]];
    return (
      <>
        {rect && <TabsIndicator rect={rect} />}
        {!selectedHover && <ProximityHighlight store={state.store} />}
      </>
    );
  }
  return (
    <ProximityHighlight
      store={state.store}
      selectedIndexes={state.selected}
      selectedClass={
        variant === 'subtle'
          ? 'bg-card dark:bg-surface-3 shadow-(--elevation-raised)'
          : 'bg-selected'
      }
      hoverClass={variant === 'subtle' && selectedHover ? 'bg-transparent' : 'bg-hover'}
    />
  );
}
