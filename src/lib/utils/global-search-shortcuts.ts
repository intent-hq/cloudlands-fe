import type { KeyboardShortcutManager } from './keyboardShortcuts';

/** Keep the global search fallback behind panel-local find, not other app commands. */
export function registerGlobalSearchShortcuts(
  manager: KeyboardShortcutManager,
  options: { isMac: boolean; openSearch: () => void; resolveBinding: () => string },
): void {
  manager.register({
    key: 'f',
    meta: options.isMac,
    ctrl: !options.isMac,
    shift: true,
    description: 'Search in files', // i18n-ignore (shortcut registry metadata)
    action: options.openSearch,
  });
  manager.register({
    key: 'f',
    meta: options.isMac,
    ctrl: !options.isMac,
    binding: options.resolveBinding,
    preferLocal: true,
    description: 'Search', // i18n-ignore (shortcut registry metadata)
    action: options.openSearch,
  });
}
