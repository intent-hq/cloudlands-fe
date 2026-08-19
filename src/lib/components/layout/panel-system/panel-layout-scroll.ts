export function findPanelElement(container: HTMLElement, panelId: string): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>('[data-panel-id]')].find(
      (candidate) => candidate.dataset.panelId === panelId,
    ) ?? null
  );
}

export function scrollPanelIntoView(
  container: HTMLElement,
  panelId: string,
  behavior: ScrollBehavior = 'auto',
): boolean {
  const panel = findPanelElement(container, panelId);
  if (!panel) return false;

  const viewport = container.getBoundingClientRect();
  const target = panel.getBoundingClientRect();
  if (viewport.right <= viewport.left || target.right <= target.left) return false;

  const panelWidth = target.right - target.left;
  const viewportWidth = viewport.right - viewport.left;
  const visualDelta =
    panelWidth > viewportWidth
      ? target.left - viewport.left
      : target.left < viewport.left
        ? target.left - viewport.left
        : target.right > viewport.right
          ? target.right - viewport.right
          : 0;
  if (Math.abs(visualDelta) < 1) return false;

  const layoutWidth = container.clientWidth || container.offsetWidth;
  const scale = layoutWidth > 0 ? viewportWidth / layoutWidth : 1;
  const nextLeft = Math.max(0, container.scrollLeft + visualDelta / (scale || 1));
  if (behavior === 'smooth') {
    container.scrollTo({ left: nextLeft, top: container.scrollTop, behavior });
  } else {
    container.scrollLeft = nextLeft;
  }
  return true;
}
