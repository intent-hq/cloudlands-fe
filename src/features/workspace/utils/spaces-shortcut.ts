import type { KeyboardShortcut } from '$lib/utils/keyboardShortcuts';

export function createSpacesShortcut(action: () => void, binding: () => string): KeyboardShortcut {
  return {
    key: 'o',
    meta: true,
    description: 'Toggle All Spaces (Mac)', // i18n-ignore (shortcut registry metadata, not rendered in UI)
    binding,
    action,
  };
}
