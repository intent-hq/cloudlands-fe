import {
  matchesShortcut,
  resolveShortcut,
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
] as const satisfies readonly ShortcutId[];

/**
 * True when xterm should ignore `event` so an app shortcut can handle it. xterm turns chords
 * like Ctrl+Alt+Arrow into escape sequences and ignores `defaultPrevented`, so the adapter must
 * return false from its custom key handler for the resolved column-focus and workspace-tab chords.
 */
export function isTerminalPassthroughChord(
  event: ShortcutKeyboardEvent,
  overrides: ShortcutOverrides,
  isMac: boolean,
): boolean {
  return TERMINAL_PASSTHROUGH_IDS.some((id) =>
    matchesShortcut(event, resolveShortcut(id, overrides), isMac),
  );
}
