import type { KeyboardShortcutManager } from '$lib/utils/keyboardShortcuts';
import { resolveShortcut, type ShortcutId } from '$lib/utils/shortcut-bindings';

export function registerWorkspaceSpacesShortcut(
  manager: KeyboardShortcutManager,
  options: {
    toggleSpaces: () => void;
    resolveBinding?: (id: ShortcutId) => string;
  },
): void {
  manager.register({
    key: 'o',
    binding: () =>
      options.resolveBinding?.('global.toggle-spaces') ??
      resolveShortcut('global.toggle-spaces', {}),
    description: 'Toggle All Spaces', // i18n-ignore (shortcut registry metadata)
    action: options.toggleSpaces,
  });
}
