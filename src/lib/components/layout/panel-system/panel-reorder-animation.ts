import type { AnimationConfig } from 'svelte/animate';
import { prefersReducedMotion, spring, type SpringTierName } from '$lib/motion';

interface PanelReorderAnimationParams {
  enabled?: boolean;
  tier?: SpringTierName;
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
  tier: SpringTierName = 'moderate',
): void {
  if (prefersReducedMotion()) return;
  root.querySelectorAll<HTMLElement>(PREVIEW_PANEL_SELECTOR).forEach((element) => {
    const panelId = getPanelPositionId(element);
    const from = panelId ? fromPositions.get(panelId) : null;
    if (!from) return;
    const to = element.getBoundingClientRect();
    const deltaX = from.left - to.left;
    const deltaY = from.top - to.top;
    const scaleX = to.width > 0 ? from.width / to.width : 1;
    const scaleY = to.height > 0 ? from.height / to.height : 1;
    if (
      Math.abs(deltaX) < 1 &&
      Math.abs(deltaY) < 1 &&
      Math.abs(scaleX - 1) < 0.01 &&
      Math.abs(scaleY - 1) < 0.01
    )
      return;

    element.getAnimations().forEach((animation) => animation.cancel());
    element.style.transformOrigin = 'top left';
    const easing = getComputedStyle(element).getPropertyValue(`--spring-${tier}-ease`).trim();
    element.animate(
      [
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})` },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: spring[tier].settleMs, ...(easing && { easing }) },
    );
  });
}

export function translatePanel(
  _node: Element,
  { from, to }: { from: DOMRect; to: DOMRect },
  { enabled = true, tier = 'moderate' }: PanelReorderAnimationParams = {},
): AnimationConfig {
  const deltaX = from.left - to.left;
  const deltaY = from.top - to.top;

  return {
    duration: enabled && !prefersReducedMotion() ? spring[tier].settleMs : 0,
    easing: spring[tier].exit.easing,
    css: (_t, remaining) =>
      `transform: translate(${remaining * deltaX}px, ${remaining * deltaY}px);`,
  };
}
