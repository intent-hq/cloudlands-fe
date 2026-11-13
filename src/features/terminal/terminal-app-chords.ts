import {
  matchesShortcutPattern,
  isEventClaimedByCustomBinding,
  resolveShortcut,
  SHORTCUT_DEFAULTS,
  type ShortcutId,
  type ShortcutKeyboardEvent,
  type ShortcutOverrides,
} from '$lib/utils/shortcut-bindings';

/** App shortcuts that must reach the window handlers instead of being typed into xterm. */
const TERMINAL_PASSTHROUGH_IDS = [
  'panel.focus-next-column',
  'panel.focus-previous-column',
  'global.next-space-alt',
  'global.previous-space-alt',
  'navigation.go-to-tab',
] as const satisfies readonly ShortcutId[];

/**
 * True when xterm should ignore `event` so an app shortcut can handle it. xterm turns chords
 * like Ctrl+Alt+Arrow into escape sequences and ignores `defaultPrevented`, so the adapter must
 * return false from its custom key handler for the resolved navigation chords.
 */
export function isTerminalPassthroughChord(
  event: ShortcutKeyboardEvent,
  overrides: ShortcutOverrides,
  isMac: boolean,
  machineRailEnabled = false,
): boolean {
  const resolve = (id: ShortcutId) => resolveShortcut(id, overrides);
  const devicePattern = machineRailEnabled
    ? resolve('navigation.go-to-device')
    : resolveShortcut('navigation.go-to-tab', overrides) ===
        SHORTCUT_DEFAULTS['navigation.go-to-tab']
      ? SHORTCUT_DEFAULTS['navigation.go-to-device']
      : null;
  if (
    devicePattern &&
    matchesShortcutPattern(event, devicePattern, isMac) >= 0 &&
    !isEventClaimedByCustomBinding('navigation.go-to-device', event, resolve, isMac)
  )
    return true;
  return TERMINAL_PASSTHROUGH_IDS.some(
    (id) =>
      matchesShortcutPattern(event, resolve(id), isMac) >= 0 &&
      (id !== 'navigation.go-to-tab' || !isEventClaimedByCustomBinding(id, event, resolve, isMac)),
  );
}
