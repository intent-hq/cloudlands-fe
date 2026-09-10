const MENU_CONTENT_SELECTOR = '[data-slot="menu-content"], [data-slot="menu-sub-content"]';

function belongsToContent(item: HTMLElement, content: HTMLElement): boolean {
  return item.closest(MENU_CONTENT_SELECTOR) === content;
}

function isEnabled(item: HTMLElement): boolean {
  return !item.hasAttribute('data-disabled') && item.getAttribute('aria-disabled') !== 'true';
}

export function getMenuItems(content: HTMLElement): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>('[data-menu-item]')).filter((item) =>
    belongsToContent(item, content),
  );
}

export function setMenuTabStop(content: HTMLElement, active?: HTMLElement | null): void {
  const items = getMenuItems(content);
  const enabledItems = items.filter(isEnabled);
  const highlighted = enabledItems.find((item) => item.hasAttribute('data-highlighted'));
  const nextActive =
    active && enabledItems.includes(active) ? active : (highlighted ?? enabledItems[0]);
  for (const item of items) item.tabIndex = item === nextActive ? 0 : -1;
}

export function syncMenuTabStopFromFocus(content: HTMLElement, target: EventTarget | null): void {
  const item = target instanceof Element ? target.closest<HTMLElement>('[data-menu-item]') : null;
  if (item && belongsToContent(item, content) && isEnabled(item)) setMenuTabStop(content, item);
}

export function getPageTargetIndex(
  items: HTMLElement[],
  currentIndex: number,
  viewport: HTMLElement,
  direction: -1 | 1,
): number {
  if (items.length === 0) return -1;
  const startIndex = Math.min(Math.max(currentIndex, 0), items.length - 1);
  const fallback = Math.min(Math.max(startIndex + direction, 0), items.length - 1);
  const pageHeight = viewport.clientHeight || viewport.getBoundingClientRect().height;
  if (pageHeight <= 0) return fallback;

  const currentRect = items[startIndex].getBoundingClientRect();
  const targetCenter = currentRect.top + currentRect.height / 2 + direction * pageHeight;
  let bestIndex = fallback;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = fallback; index >= 0 && index < items.length; index += direction) {
    const rect = items[index].getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - targetCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function handleMenuPageKey(content: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'PageUp' && event.key !== 'PageDown') return false;
  const items = getMenuItems(content).filter(isEnabled);
  if (items.length === 0) return false;
  const focused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-menu-item]')
      : null;
  const currentIndex = Math.max(
    0,
    focused ? items.indexOf(focused) : items.findIndex((item) => item.tabIndex === 0),
  );
  const target =
    items[getPageTargetIndex(items, currentIndex, content, event.key === 'PageDown' ? 1 : -1)];
  if (!target) return false;
  event.preventDefault();
  setMenuTabStop(content, target);
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: 'nearest' });
  return true;
}
