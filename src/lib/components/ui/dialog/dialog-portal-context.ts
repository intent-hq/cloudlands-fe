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
