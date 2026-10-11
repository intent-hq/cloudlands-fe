// React adapter for choice-group-state.svelte.ts; ephemeral DOM focus and proximity only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createProximityHover, ProximityHighlight, type ProximityHover } from '@/lib/interaction';
export function useChoiceRows() {
  const root = useRef<HTMLDivElement>(null);
  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    root.current = node;
  }, []);
  const [rows, setRows] = useState<
    { element: HTMLButtonElement; value: string | undefined; disabled: boolean }[]
  >([]);
  const [active, setActive] = useState<string>();
  const [highlight, setHighlight] = useState<{ store: ProximityHover | null; selected: number[] }>({
    store: null,
    selected: [],
  });
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const store = createProximityHover(node, { axis: 'xy' });
    let items: HTMLButtonElement[] = [];
    const sync = () => {
      const next = Array.from(
        node.querySelectorAll<HTMLButtonElement>('[data-choice-value]'),
      ).filter((item) => item.closest('[data-choice-group]') === node);
      for (let index = next.length; index < items.length; index++) store.registerItem(index, null);
      items = next;
      items.forEach((item, index) => store.registerItem(index, item));
      const snapshot = items.map((element) => ({
        element,
        value: element.dataset.choiceValue,
        disabled: element.disabled,
      }));
      setRows((previous) =>
        previous.length === snapshot.length &&
        previous.every(
          (row, index) =>
            row.element === snapshot[index].element &&
            row.value === snapshot[index].value &&
            row.disabled === snapshot[index].disabled,
        )
          ? previous
          : snapshot,
      );
      setHighlight((previous) => {
        const selected = items.flatMap((item, index) =>
          item.getAttribute('aria-checked') === 'true' ? [index] : [],
        );
        return previous.store === store &&
          selected.length === previous.selected.length &&
          selected.every((item, index) => item === previous.selected[index])
          ? previous
          : { store, selected };
      });
    };
    const focus = (event: FocusEvent) => {
      const index = items.indexOf(event.target as HTMLButtonElement);
      if (index >= 0) {
        setActive(items[index].dataset.choiceValue);
        store.setActiveIndex(index);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-checked', 'disabled', 'data-choice-value'],
    });
    node.addEventListener('focusin', focus);
    return () => {
      observer.disconnect();
      node.removeEventListener('focusin', focus);
      store.destroy();
    };
  }, []);
  const keyboardValue =
    rows.find((row) => !row.disabled && row.value === active)?.value ??
    rows.find((row) => !row.disabled)?.value;
  return {
    attachRoot,
    rows,
    keyboardValue,
    highlight,
    focusAdjacent(value: string, direction: 1 | -1) {
      const enabled = rows.filter((row) => !row.disabled);
      const index = enabled.findIndex((row) => row.value === value);
      if (index >= 0)
        enabled[(index + direction + enabled.length) % enabled.length]?.element.focus();
    },
  };
}
export function ChoiceRowsHighlight({
  state,
  selectedClass = 'bg-selected',
}: {
  state: ReturnType<typeof useChoiceRows>;
  selectedClass?: string;
}) {
  return state.highlight.store ? (
    <ProximityHighlight
      store={state.highlight.store}
      selectedIndexes={state.highlight.selected}
      selectedClass={selectedClass}
    />
  ) : null;
}
