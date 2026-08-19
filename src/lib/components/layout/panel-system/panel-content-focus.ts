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
 */
export function shouldBlurActiveElement(
  activeElement: Element | null,
  targetPanelId: string,
): activeElement is HTMLElement {
  if (!(activeElement instanceof HTMLElement)) return false;
  const owningPanel = activeElement.closest<HTMLElement>('[data-panel-id]');
  return owningPanel?.dataset.panelId !== targetPanelId;
}
