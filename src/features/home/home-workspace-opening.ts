import { isCmdClickModifier } from '$shared/utils/link-helpers';

function isNestedControl(event: MouseEvent | KeyboardEvent): boolean {
  const control =
    event.target instanceof Element
      ? event.target.closest(
          'button, a, input, select, textarea, [role="button"], [role="menuitem"]',
        )
      : null;
  return Boolean(control && control !== event.currentTarget);
}

export function openHomeWorkspaceFromEvent(
  event: MouseEvent | KeyboardEvent,
  id: string,
  onopen: (id: string) => void,
): boolean {
  if (!isCmdClickModifier({ event })) return false;
  if (event instanceof MouseEvent && event.button !== 0) return false;
  if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return false;
  if (isNestedControl(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  onopen(id);
  return true;
}

/**
 * Opens a Home workspace on a primary-button double-click of its row or card.
 * Double-clicks that land on a nested control (row menu, PR links) keep that
 * control's own behavior. A Cmd/Ctrl double-click is left alone: its first click
 * already opened the workspace through the modifier path.
 */
export function openHomeWorkspaceFromDoubleClick(
  event: MouseEvent,
  id: string,
  onopen: (id: string) => void,
): boolean {
  if (event.button !== 0 || isCmdClickModifier({ event }) || isNestedControl(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  onopen(id);
  return true;
}

/** Stops the repeat mousedown of a double-click from selecting the word under the cursor. */
export function preventRepeatClickTextSelection(event: MouseEvent): void {
  if (event.detail > 1 && !isNestedControl(event)) event.preventDefault();
}

/**
 * Swallows the repeat click of a double-click (`detail > 1`) so the first click's
 * selection stays put instead of toggling off just before the workspace opens.
 */
export function ignoreRepeatHomeWorkspaceClick(event: MouseEvent): boolean {
  if (event.detail < 2 || isNestedControl(event)) return false;
  event.stopPropagation();
  return true;
}
