// Source: Bits internal/tabbable and MenuContentState.handleTabKeyDown.
import { focusable, isFocusable, isTabbable, tabbable } from 'tabbable';
import { setMenuTabStop } from '$lib/components/ui/menu/menu-roving-focus';
import { useListTypeahead } from '@/lib/interaction/list-typeahead';

export function useMenuTypeahead(open: boolean) {
  return useListTypeahead(open, {
    contentSelector: '[role="menu"]',
    itemSelector: '[data-menu-item]',
    getLabel: (item) => item.textContent?.trim() ?? '',
    onMatch: (content, item) => {
      setMenuTabStop(content, item);
      item.focus();
    },
  });
}

export function handleMenuNavigationKey(content: HTMLElement, event: KeyboardEvent, loop: boolean) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest('[role="menu"]') !== content) return;
  if (target !== content && !target.matches('[data-menu-item]')) return;
  const items = Array.from(content.querySelectorAll<HTMLElement>('[data-menu-item]')).filter(
    (item) =>
      item.closest('[role="menu"]') === content &&
      !item.hasAttribute('data-disabled') &&
      item.getAttribute('aria-disabled') !== 'true',
  );
  if (!items.length) return;
  const current = items.indexOf(target);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (current === -1) next = event.key === 'ArrowDown' ? 0 : items.length - 1;
  else {
    next = current + (event.key === 'ArrowDown' ? 1 : -1);
    next = loop
      ? (next + items.length) % items.length
      : Math.max(0, Math.min(next, items.length - 1));
  }
  // Radix defers roving focus; the next native key must reach the new row immediately.
  event.preventDefault();
  setMenuTabStop(content, items[next]);
  items[next].focus();
  return true;
}

export function getAdjacentTabStop(current: HTMLElement, backwards: boolean) {
  const options = { getShadowRoot: true };
  const doc = current.ownerDocument;
  const isCurrentTabbable = isTabbable(current, options);
  if (!isCurrentTabbable && !isFocusable(current, options)) return doc.body;
  const candidates = isCurrentTabbable ? tabbable(doc.body, options) : focusable(doc.body, options);
  if (backwards) candidates.reverse();
  const index = candidates.indexOf(current);
  if (index === -1) return doc.body;
  const remaining = candidates.slice(index + 1);
  return isCurrentTabbable
    ? remaining[0]
    : (remaining.find((node) => isTabbable(node, options)) ?? doc.body);
}

/** Radix blocks native Tab; reproduce the source's native path and scope edge loop. */
export function getInlineTabStop(content: HTMLElement, backwards: boolean, loop: boolean) {
  const active = content.ownerDocument.activeElement;
  const candidates = tabbable(content, { includeContainer: false, getShadowRoot: true });
  if (loop && candidates.length) {
    if (backwards && active === candidates[0]) return candidates.at(-1);
    if (!backwards && active === candidates.at(-1)) return candidates[0];
  }
  return getAdjacentTabStop(active instanceof HTMLElement ? active : content, backwards);
}
