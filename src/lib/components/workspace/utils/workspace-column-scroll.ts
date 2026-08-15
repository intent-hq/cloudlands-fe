const WORKSPACE_COLUMN_SCROLL_DURATION_MS = 360;
const activeHorizontalScrollFrames = new WeakMap<HTMLElement, number>();

function cancelHorizontalScroll(container: HTMLElement): void {
  const frame = activeHorizontalScrollFrames.get(container);
  if (frame !== undefined) cancelAnimationFrame(frame);
  activeHorizontalScrollFrames.delete(container);
}

function animateHorizontalScroll(container: HTMLElement, targetLeft: number): void {
  cancelHorizontalScroll(container);
  const startLeft = container.scrollLeft;
  const distance = targetLeft - startLeft;
  let startTime: number | null = null;

  const animate = (currentTime: number) => {
    startTime ??= currentTime;
    const progress = Math.min((currentTime - startTime) / WORKSPACE_COLUMN_SCROLL_DURATION_MS, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    container.scrollLeft = startLeft + distance * eased;
    if (progress < 1) {
      activeHorizontalScrollFrames.set(container, requestAnimationFrame(animate));
    } else {
      activeHorizontalScrollFrames.delete(container);
    }
  };

  activeHorizontalScrollFrames.set(container, requestAnimationFrame(animate));
}

export function scrollWorkspaceColumnIntoView(
  container: HTMLElement,
  workspaceId: string,
  behavior: ScrollBehavior = 'auto',
  inline: ScrollLogicalPosition = 'nearest',
): boolean {
  const column = [...container.querySelectorAll<HTMLElement>('[data-workspace-column]')].find(
    (candidate) => candidate.dataset.workspaceColumn === workspaceId,
  );
  if (!column) return false;
  if (inline === 'start') {
    const viewport = container.getBoundingClientRect();
    const columnRect = column.getBoundingClientRect();
    const offset = columnRect.left - viewport.left;
    if (Math.abs(offset) < 1) return false;

    const targetLeft = Math.max(0, container.scrollLeft + offset);
    if (behavior === 'smooth') {
      animateHorizontalScroll(container, targetLeft);
    } else {
      cancelHorizontalScroll(container);
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ left: targetLeft, behavior });
      } else {
        container.scrollLeft = targetLeft;
      }
    }
    return true;
  }
  if (inline === 'nearest' && isHorizontallyVisible(container, column)) return false;

  column.scrollIntoView?.({ behavior, block: 'nearest', inline });
  return true;
}

export function scrollWorkspacePanelIntoView(
  container: HTMLElement,
  workspaceId: string,
  panelId: string,
  behavior: ScrollBehavior = 'auto',
): boolean {
  const workspaceColumn = [
    ...container.querySelectorAll<HTMLElement>('[data-workspace-column]'),
  ].find((candidate) => candidate.dataset.workspaceColumn === workspaceId);
  const panel = [...(workspaceColumn?.querySelectorAll<HTMLElement>('[data-panel-id]') ?? [])].find(
    (candidate) => candidate.dataset.panelId === panelId,
  );
  if (!panel) return false;
  if (isHorizontallyVisible(container, panel)) return false;

  panel.scrollIntoView?.({ behavior, block: 'nearest', inline: 'end' });
  return true;
}

function isHorizontallyVisible(container: HTMLElement, target: HTMLElement): boolean {
  const viewport = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (viewport.right <= viewport.left || targetRect.right <= targetRect.left) return false;

  return targetRect.right > viewport.left && targetRect.left < viewport.right;
}
