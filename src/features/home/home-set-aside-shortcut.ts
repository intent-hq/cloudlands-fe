import { getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
import { matchesShortcut } from '$lib/utils/shortcut-bindings';
import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
import { isTextEntryTarget } from '$lib/utils/text-entry';

export function handleHomeSetAsideShortcut(
  event: KeyboardEvent,
  onToggle: (workspaceId: string) => void,
): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    isTextEntryTarget(event.target) ||
    isFocusInTerminal(event.target instanceof HTMLElement ? event.target : null) ||
    !matchesShortcut(
      event,
      getEffectiveShortcut('workspace.set-aside'),
      navigator.platform.toUpperCase().includes('MAC'),
    )
  )
    return false;
  const row =
    event.target instanceof Element
      ? (event.target.closest<HTMLElement>('[data-home-workspace]') ??
        event.target
          .closest('[role="option"]')
          ?.querySelector<HTMLElement>('[data-home-workspace]'))
      : null;
  const workspaceId =
    row?.dataset.homeWorkspace ??
    (event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-home-set-aside-action]')?.dataset
          .homeSetAsideAction
      : undefined);
  if (!workspaceId) return false;
  event.preventDefault();
  event.stopPropagation();
  onToggle(workspaceId);
  return true;
}
