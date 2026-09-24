/** Resolve one panel-local Find owner without trusting stale layout focus flags. */
export function getPanelFindOwner(event: KeyboardEvent): HTMLElement | null {
  const doc = document;
  const target =
    event.target instanceof Element && event.target !== doc.body ? event.target : doc.activeElement;
  if (target && target !== doc.body && target !== doc.documentElement) {
    return (
      target.closest<HTMLElement>('[data-panel-find-shortcut-owner="true"]') ??
      target
        .closest('[data-panel-id]')
        ?.querySelector<HTMLElement>('[data-panel-find-shortcut-owner="true"]') ??
      null
    );
  }
  const focused = doc.querySelectorAll<HTMLElement>(
    '[data-panel-find-shortcut-owner="true"][data-panel-find-focused="true"]',
  );
  return focused.length === 1 ? focused[0] : null;
}
