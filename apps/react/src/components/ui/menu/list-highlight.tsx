// Source: menu-list-highlight.svelte; uses the shared React proximity/spring owner.
import * as React from 'react';
import { createProximityHover, ProximityHighlight, type ProximityHover } from '@/lib/interaction';

const itemSelector =
  '[data-menu-item], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';
export function ListHighlight({
  activeIndex,
  onActiveIndexChange,
}: {
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
}) {
  const marker = React.useRef<HTMLSpanElement>(null);
  const [hover, setHover] = React.useState<ProximityHover | null>(null);
  const [selected, setSelected] = React.useState<number[]>([]);
  const [pressed, setPressed] = React.useState(false);
  const latest = React.useRef({ activeIndex, onActiveIndexChange });
  React.useLayoutEffect(() => {
    latest.current = { activeIndex, onActiveIndexChange };
    if (activeIndex !== undefined && !hover?.pointerPosition) hover?.setActiveIndex(activeIndex);
  }, [activeIndex, onActiveIndexChange, hover]);
  React.useLayoutEffect(() => {
    const container = marker.current?.parentElement;
    if (!container) return;
    container.dataset.listOverlay = '';
    const instance = createProximityHover(container);
    setHover(instance);
    let items: HTMLElement[] = [];
    let keyboard = false;
    let syncing = false;
    let lastPointer: number | null | undefined;
    const focusedIndex = () => {
      const index = items.indexOf(document.activeElement as HTMLElement);
      return index < 0 ? null : index;
    };
    const sync = () => {
      const next = Array.from(container.querySelectorAll<HTMLElement>(itemSelector)).filter(
        (item) =>
          item.closest('[data-list-overlay]') === container &&
          !item.hasAttribute('data-disabled') &&
          item.getAttribute('aria-disabled') !== 'true',
      );
      if (next.length !== items.length || next.some((item, i) => item !== items[i])) {
        items.forEach((_, i) => instance.registerItem(i, null));
        items = next;
        items.forEach((item, i) => instance.registerItem(i, item));
      } else instance.measure();
      const nextSelected = items.flatMap((item, i) =>
        item.hasAttribute('data-selected') ||
        item.getAttribute('aria-selected') === 'true' ||
        item.getAttribute('aria-checked') === 'true'
          ? [i]
          : [],
      );
      setSelected((old) =>
        old.length === nextSelected.length && old.every((value, i) => value === nextSelected[i])
          ? old
          : nextSelected,
      );
      if (keyboard) instance.setActiveIndex(focusedIndex());
      else if (latest.current.activeIndex !== undefined && !instance.pointerPosition)
        instance.setActiveIndex(latest.current.activeIndex);
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === 'attributes' ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(itemSelector) || node.querySelector(itemSelector)),
            ),
        )
      )
        sync();
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-highlighted',
        'data-selected',
        'data-state',
        'data-disabled',
        'aria-selected',
        'aria-checked',
        'aria-disabled',
      ],
    });
    const unsubscribe = instance.subscribe(() => {
      if (syncing) return;
      if (keyboard) {
        const index = focusedIndex();
        if (instance.activeIndex !== index) {
          syncing = true;
          instance.setActiveIndex(index);
          syncing = false;
        }
      } else if (instance.pointerPosition && instance.activeIndex !== lastPointer) {
        lastPointer = instance.activeIndex;
        latest.current.onActiveIndexChange?.(lastPointer);
      } else if (!instance.pointerPosition) lastPointer = undefined;
    });
    const onKey = () => {
      keyboard = true;
      setPressed(false);
      queueMicrotask(() => {
        if (keyboard) instance.setActiveIndex(focusedIndex());
      });
    };
    const onMove = () => {
      keyboard = false;
    };
    const onLeave = () => {
      keyboard = true;
      setPressed(false);
      instance.setActiveIndex(focusedIndex());
    };
    const onFocus = () => {
      instance.setActiveIndex(focusedIndex());
    };
    const onDown = (event: PointerEvent) => {
      const item = event.target instanceof Element ? event.target.closest(itemSelector) : null;
      if (event.button === 0 && items.includes(item as HTMLElement)) {
        keyboard = false;
        setPressed(true);
        instance.setActiveIndex(items.indexOf(item as HTMLElement));
      }
    };
    const onUp = () => setPressed(false);
    container.addEventListener('keydown', onKey, true);
    container.addEventListener('pointermove', onMove, true);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('focusin', onFocus);
    container.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    sync();
    return () => {
      observer.disconnect();
      unsubscribe();
      instance.destroy();
      container.removeEventListener('keydown', onKey, true);
      container.removeEventListener('pointermove', onMove, true);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('focusin', onFocus);
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      delete container.dataset.listOverlay;
    };
  }, []);
  return (
    <span ref={marker} data-slot="menu-list-highlight" className="contents" aria-hidden="true">
      {hover && (
        <ProximityHighlight
          store={hover}
          selectedIndexes={selected}
          hoverClass={
            pressed
              ? selected.includes(hover.activeIndex ?? -1)
                ? 'bg-hover menu-selection-pressed'
                : 'bg-active'
              : 'bg-hover'
          }
        />
      )}
    </span>
  );
}
