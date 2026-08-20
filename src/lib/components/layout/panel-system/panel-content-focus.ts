/**
 * Focus predicate for dispatchFocusPanelContent (intent-hq/monorepo#2895).
 *
 * When a panel is revealed/focused, non-focusable tab types blur the current
 * document.activeElement to clear stale focus left behind in a previously
 * focused panel. Since focusPanel started emitting a reveal request on every
 * focus (#1373), that blur also fired for user-initiated focus INSIDE the
 * revealed panel itself — clicking into a browser webview or the URL bar
 * dispatched focusPanel and then blurred the very element the user clicked,
 * making it impossible to keep focus or type.
 *
 * The blur must only clear focus that lives OUTSIDE the target panel.
 *
 * Panel ids are session-scoped (`panel-${Date.now()}-${counter}`), so two
 * persisted layouts can in principle carry colliding ids. When
 * `targetLayoutId` is provided, ownership additionally requires the panel's
 * `data-layout-id` to match, so a colliding id in another layout is still
 * treated as outside.
 */
export function shouldBlurActiveElement(
  activeElement: Element | null,
  targetPanelId: string,
  targetLayoutId?: string,
): activeElement is HTMLElement {
  if (!(activeElement instanceof HTMLElement)) return false;
  const owningPanel = activeElement.closest<HTMLElement>('[data-panel-id]');
  if (owningPanel?.dataset.panelId !== targetPanelId) return true;
  return targetLayoutId !== undefined && owningPanel.dataset.layoutId !== targetLayoutId;
}

/**
 * Same ownership rule for the focusable-type branch (intent-hq/monorepo#2947):
 * only redirect focus into the panel's content (`panel:focus-content`) when the
 * current focus lives OUTSIDE the target panel. Focus the user just placed
 * inside the panel but outside the prompt (e.g. the header rename input) must
 * not be stolen. Unlike the blur predicate, null/body focus counts as outside
 * so normal reveal/cycle flows still focus the content.
 */
export function shouldRedirectFocusToPanelContent(
  activeElement: Element | null,
  targetPanelId: string,
  targetLayoutId?: string,
): boolean {
  if (activeElement === null) return true;
  return shouldBlurActiveElement(activeElement, targetPanelId, targetLayoutId);
}
