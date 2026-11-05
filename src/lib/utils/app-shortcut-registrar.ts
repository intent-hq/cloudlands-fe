import type { KeyboardShortcut, KeyboardShortcutManager } from './keyboardShortcuts';
import type { ShortcutId } from './shortcut-bindings';

export type AppShortcutRegistration = KeyboardShortcut & { shortcutId?: ShortcutId };

/**
 * Build the app layout's `register` function. Every option is forwarded unchanged
 * (preferLocal, allowInTerminal, enabled, ...), so a registration behaves in the app exactly
 * as it does in unit tests that register on a manager directly. `shortcutId` resolves the
 * user's effective binding at event time when no explicit `binding` is given.
 */
export function createAppShortcutRegistrar(
  manager: Pick<KeyboardShortcutManager, 'register'>,
  resolveBinding: (id: ShortcutId) => string,
): (registration: AppShortcutRegistration) => void {
  return ({ shortcutId, ...shortcut }) => {
    manager.register({
      ...shortcut,
      meta: !!shortcut.meta,
      ctrl: !!shortcut.ctrl,
      shift: !!shortcut.shift,
      alt: !!shortcut.alt,
      binding: shortcut.binding ?? (shortcutId ? () => resolveBinding(shortcutId) : undefined),
    });
  };
}
