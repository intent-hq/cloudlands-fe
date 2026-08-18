const WORKSPACE_COLUMN_SCROLL_DURATION_MS = 360;
const activeHorizontalScrollFrames = new WeakMap<HTMLElement, number>();

function horizontalTolerance(): number {
  return 0.5 / Math.max(1, globalThis.devicePixelRatio || 1);
}

function horizontalLayoutScale(container: HTMLElement, viewport: DOMRect): number {
  const layoutWidth = container.clientWidth || container.offsetWidth;
  const visualWidth = viewport.right - viewport.left;
  if (layoutWidth <= 0 || visualWidth <= 0) return 1;
  return visualWidth / layoutWidth;
}

function parseScrollPadding(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getHorizontalRevealViewport(container: HTMLElement, viewport: DOMRect): DOMRect {
  const explicitInset = Number.parseFloat(container.dataset.workspaceRevealInset ?? '');
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(container) : null;
  const startPadding = Number.isFinite(explicitInset)
    ? explicitInset
    : parseScrollPadding(style?.scrollPaddingInlineStart ?? '');
  const endPadding = Number.isFinite(explicitInset)
    ? explicitInset
    : parseScrollPadding(style?.scrollPaddingInlineEnd ?? '');
  const scale = horizontalLayoutScale(container, viewport);
  const left = viewport.left + startPadding * scale;
  const right = viewport.right - endPadding * scale;
  return right > left ? ({ ...viewport, left, right } as DOMRect) : viewport;
}

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

function writeHorizontalScroll(
  container: HTMLElement,
  targetLeft: number,
  behavior: ScrollBehavior,
): void {
  const clampedLeft = Math.max(0, targetLeft);
  if (behavior === 'smooth') {
    animateHorizontalScroll(container, clampedLeft);
    return;
  }
  cancelHorizontalScroll(container);
  container.scrollLeft = clampedLeft;
}

export function findWorkspaceColumn(
  container: HTMLElement,
  workspaceId: string,
): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>('[data-workspace-column]')].find(
      (candidate) => candidate.dataset.workspaceColumn === workspaceId,
    ) ?? null
  );
}

export function findWorkspacePanel(
  container: HTMLElement,
  workspaceId: string,
  panelId: string,
): HTMLElement | null {
  const workspaceColumn = findWorkspaceColumn(container, workspaceId);
  return (
    [...(workspaceColumn?.querySelectorAll<HTMLElement>('[data-panel-id]') ?? [])].find(
      (candidate) => candidate.dataset.panelId === panelId,
    ) ?? null
  );
}

export function scrollWorkspaceColumnIntoView(
  container: HTMLElement,
  workspaceId: string,
  behavior: ScrollBehavior = 'auto',
  inline: ScrollLogicalPosition = 'nearest',
): boolean {
  const column = findWorkspaceColumn(container, workspaceId);
  if (!column) return false;
  if (inline === 'start') {
    const viewport = container.getBoundingClientRect();
    const revealViewport = getHorizontalRevealViewport(container, viewport);
    const columnRect = column.getBoundingClientRect();
    const offset =
      (columnRect.left - revealViewport.left) / horizontalLayoutScale(container, viewport);
    if (Math.abs(offset) < 1) return false;

    const targetLeft = Math.max(0, container.scrollLeft + offset);
    writeHorizontalScroll(container, targetLeft, behavior);
    return true;
  }
  if (inline === 'nearest' && isHorizontallyVisible(container, column)) return false;
  const viewport = container.getBoundingClientRect();
  const revealViewport = getHorizontalRevealViewport(container, viewport);
  const columnRect = column.getBoundingClientRect();
  const delta =
    getMinimumHorizontalRevealDelta(revealViewport, columnRect) /
    horizontalLayoutScale(container, viewport);
  writeHorizontalScroll(container, container.scrollLeft + delta, behavior);
  return true;
}

export function scrollWorkspacePanelIntoView(
  container: HTMLElement,
  workspaceId: string,
  panelId: string,
  behavior: ScrollBehavior = 'auto',
): boolean {
  const panel = findWorkspacePanel(container, workspaceId, panelId);
  if (!panel) return false;
  if (isHorizontallyVisible(container, panel)) {
    // A newer focus request owns the viewport even when its target is already
    // visible. Stop an older smooth reveal before it moves this panel away.
    cancelHorizontalScroll(container);
    return false;
  }
  const viewport = container.getBoundingClientRect();
  const revealViewport = getHorizontalRevealViewport(container, viewport);
  const delta =
    getMinimumHorizontalRevealDelta(revealViewport, panel.getBoundingClientRect()) /
    horizontalLayoutScale(container, viewport);
  writeHorizontalScroll(container, container.scrollLeft + delta, behavior);
  return true;
}

function getMinimumHorizontalRevealDelta(viewport: DOMRect, target: DOMRect): number {
  const tolerance = horizontalTolerance();
  const viewportWidth = viewport.right - viewport.left;
  const targetWidth = target.right - target.left;
  if (targetWidth > viewportWidth + tolerance) {
    if (target.left > viewport.left + tolerance) return target.left - viewport.left;
    if (target.right < viewport.right - tolerance) return target.right - viewport.right;
    return 0;
  }
  if (target.left < viewport.left - tolerance) return target.left - viewport.left;
  if (target.right > viewport.right + tolerance) return target.right - viewport.right;
  return 0;
}

function isHorizontallyVisible(container: HTMLElement, target: HTMLElement): boolean {
  const viewport = container.getBoundingClientRect();
  const revealViewport = getHorizontalRevealViewport(container, viewport);
  const targetRect = target.getBoundingClientRect();
  if (revealViewport.right <= revealViewport.left || targetRect.right <= targetRect.left) {
    return false;
  }
  const tolerance = horizontalTolerance();
  return (
    targetRect.left >= revealViewport.left - tolerance &&
    targetRect.right <= revealViewport.right + tolerance
  );
}
