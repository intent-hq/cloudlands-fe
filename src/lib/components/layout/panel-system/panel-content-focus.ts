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
 * The blur must only clear STALE PANEL focus — focus that lives inside some
 * OTHER panel. Focus with no `[data-panel-id]` ancestor is not panel-owned at
 * all (a dialog portal / modal overlay, e.g. the New Space modal editor) and
 * must never be blurred: doing so fought the dialog focus trap, which
 * re-focused the editor with the caret at the start 100 ms after every
 * focusPanel dispatch (intent-hq/monorepo#3053).
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
  if (!owningPanel) return false;
  if (owningPanel.dataset.panelId !== targetPanelId) return true;
  return targetLayoutId !== undefined && owningPanel.dataset.layoutId !== targetLayoutId;
}

/**
 * Same ownership rule for the focusable-type branch (intent-hq/monorepo#2947):
 * only redirect focus into the panel's content (`panel:focus-content`) when the
 * current focus is stale focus in another panel. Focus the user just placed
 * inside the panel but outside the prompt (e.g. the header rename input) must
 * not be stolen, and neither must overlay-hosted focus with no panel ancestor
 * (intent-hq/monorepo#3053). Unlike the blur predicate, null/body focus counts
 * as redirectable so normal reveal/cycle flows still focus the content.
 *
 * Non-HTMLElement focus (e.g. an SVG given tabindex) counts as INSIDE
 * regardless of where it lives — a deliberate conservative bias inherited from
 * `shouldBlurActiveElement`: suppressing a redirect only skips auto-focusing
 * the prompt, while redirecting wrongly steals focus (the bug class itself).
 */
export function shouldRedirectFocusToPanelContent(
  activeElement: Element | null,
  targetPanelId: string,
  targetLayoutId?: string,
): boolean {
  if (activeElement === null) return true;
  if (activeElement === activeElement.ownerDocument.body) return true;
  return shouldBlurActiveElement(activeElement, targetPanelId, targetLayoutId);
}
