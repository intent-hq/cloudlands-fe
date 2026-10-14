import { useLayoutEffect, useRef } from 'react';

type TypeaheadOptions = {
  contentSelector: string;
  itemSelector: string;
  getLabel: (item: HTMLElement) => string;
  onMatch: (content: HTMLElement, item: HTMLElement) => void;
  allowSpaces?: boolean;
};

export function useListTypeahead(open: boolean, options: TypeaheadOptions) {
  const search = useRef({ value: '', time: 0 });
  useLayoutEffect(() => {
    search.current = { value: '', time: 0 };
  }, [open]);
  return (content: HTMLElement, event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing
    )
      return;
    if (event.key.length !== 1) return;
    const previous = event.timeStamp - search.current.time < 1000 ? search.current.value : '';
    const isSpace = event.key === ' ';
    if (isSpace && (!options.allowSpaces || !previous)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(options.contentSelector) !== content)
      return;
    if (target !== content && !target.matches(options.itemSelector)) return;
    const items = Array.from(content.querySelectorAll<HTMLElement>(options.itemSelector)).filter(
      (item) =>
        item.closest(options.contentSelector) === content &&
        !item.hasAttribute('data-disabled') &&
        item.getAttribute('aria-disabled') !== 'true',
    );
    const value = previous + event.key;
    search.current = { value, time: event.timeStamp };
    const query = Array.from(value).every((key) => key === value[0]) ? value[0] : value;
    const currentLabel = target === content ? '' : options.getLabel(target);
    const current = items.findIndex((item) => options.getLabel(item) === currentLabel);
    const start = Math.max(current, 0);
    const ordered = [...items.slice(start), ...items.slice(0, start)];
    const match = ordered.find(
      (item) =>
        (query.length !== 1 || options.getLabel(item) !== currentLabel) &&
        options.getLabel(item).toLowerCase().startsWith(query.toLowerCase()),
    );
    if (isSpace && !match) return;
    event.preventDefault();
    if (match) options.onMatch(content, match);
    return true;
  };
}
