import { isCmdClickModifier } from '$shared/utils/link-helpers';

export function openHomeWorkspaceFromEvent(
  event: MouseEvent | KeyboardEvent,
  id: string,
  onopen: (id: string) => void,
): boolean {
  if (!isCmdClickModifier({ event })) return false;
  if (event instanceof MouseEvent && event.button !== 0) return false;
  if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return false;
  const control =
    event.target instanceof Element
      ? event.target.closest(
          'button, a, input, select, textarea, [role="button"], [role="menuitem"]',
        )
      : null;
  if (control && control !== event.currentTarget) return false;
  event.preventDefault();
  event.stopPropagation();
  onopen(id);
  return true;
}
