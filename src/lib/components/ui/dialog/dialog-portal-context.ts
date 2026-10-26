import { getContext, setContext } from 'svelte';

const DIALOG_PORTAL_CONTEXT = Symbol('dialog-portal-target');
type PortalTarget = () => HTMLElement | null;

export function provideDialogPortalTarget(target: PortalTarget): void {
  setContext(DIALOG_PORTAL_CONTEXT, target);
}

/**
 * Keep an owned popup in its dialog's stacking and focus scope. Consumers must
 * use absolute positioning inside the transformed dialog; the dialog must keep
 * overflow visible and place scrolling/clipping on its body instead.
 * Outside a dialog, undefined preserves the primitive's normal body portal.
 */
export function useDialogPortalTarget(): () => HTMLElement | undefined {
  const target = getContext<PortalTarget | undefined>(DIALOG_PORTAL_CONTEXT);
  return () => target?.() ?? undefined;
}

const OPEN_POPUP_ESCAPE_SOURCE = [
  '[data-bits-floating-content-wrapper]',
  '[role="combobox"][aria-expanded="true"]',
  '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]',
].join(', ');

/**
 * Escape that an open popup inside `dialog` should handle through its own
 * bits-ui escape layer: a dialog-owned popup is mounted (portalled as a direct
 * child, see above), or the key came from inside a popup or from a popup
 * trigger that is currently expanded (inline Select/Combobox/menu).
 */
export function escapeBelongsToOpenPopup(
  dialog: HTMLElement | null,
  event: KeyboardEvent,
): boolean {
  if (dialog?.querySelector(':scope > [data-bits-floating-content-wrapper]')) return true;
  return event.target instanceof Element && event.target.closest(OPEN_POPUP_ESCAPE_SOURCE) !== null;
}
