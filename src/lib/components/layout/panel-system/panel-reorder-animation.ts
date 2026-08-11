import type { AnimationConfig } from 'svelte/animate';
import { cubicOut } from 'svelte/easing';

interface PanelReorderAnimationParams {
  duration?: number;
  easing?: (t: number) => number;
}

const PREVIEW_PANEL_SELECTOR = '[data-panel-layout-preview-panel]';

function getPanelPositionId(element: HTMLElement): string | null {
  return element.dataset.panelLayoutPreviewPanel ?? element.dataset.panelId ?? null;
}

export function capturePanelPositions(
  root: ParentNode | null,
  selector = PREVIEW_PANEL_SELECTOR,
): Map<string, DOMRect> {
  const positions = new Map<string, DOMRect>();
  root?.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const panelId = getPanelPositionId(element);
    if (panelId) positions.set(panelId, element.getBoundingClientRect());
  });
  return positions;
}

export function animatePanelPreviewPositions(
  root: ParentNode,
  fromPositions: ReadonlyMap<string, DOMRect>,
  duration = 240,
): void {
  root.querySelectorAll<HTMLElement>(PREVIEW_PANEL_SELECTOR).forEach((element) => {
    const panelId = getPanelPositionId(element);
    const from = panelId ? fromPositions.get(panelId) : null;
    if (!from) return;
    const to = element.getBoundingClientRect();
    const deltaX = from.left - to.left;
    const deltaY = from.top - to.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate(
      [
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  });
}

export function translatePanel(
  _node: Element,
  { from, to }: { from: DOMRect; to: DOMRect },
  { duration = 180, easing = cubicOut }: PanelReorderAnimationParams = {},
): AnimationConfig {
  const deltaX = from.left - to.left;
  const deltaY = from.top - to.top;

  return {
    duration,
    easing,
    css: (_t, remaining) =>
      `transform: translate(${remaining * deltaX}px, ${remaining * deltaY}px);`,
  };
}
