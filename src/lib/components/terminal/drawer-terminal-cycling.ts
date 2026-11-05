import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';

/**
 * Direction for Mod+Shift+] / [ terminal cycling in a terminal drawer, or null when the drawer
 * should not claim the chord. Only a terminal inside `drawer` with 2+ drawer terminals cycles;
 * everywhere else (including terminals in columns) the chord falls through to workspace tab
 * switching, which the keyboard manager runs as a `preferLocal` fallback.
 */
export function drawerTerminalCycleDirection(
  event: KeyboardEvent,
  drawer: Element | null | undefined,
  terminalCount: number,
): 1 | -1 | null {
  // Mod is Cmd on macOS and Ctrl elsewhere, matching what TerminalAdapter keeps out of xterm.
  const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const isMod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!isMod || !event.shiftKey || event.altKey) return null;
  // Shift+] produces } on US keyboards, so accept both.
  const direction =
    event.key === ']' || event.key === '}' ? 1 : event.key === '[' || event.key === '{' ? -1 : null;
  if (direction === null || terminalCount < 2 || !drawer) return null;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target || !drawer.contains(target) || !isFocusInTerminal(target)) return null;
  return direction;
}

/**
 * The drawer's window keydown handler: claims Mod+Shift+] / [ (preventDefault +
 * stopImmediatePropagation, so the workspace-tab fallback never runs) and cycles. Returns
 * whether the drawer claimed the event.
 */
export function handleDrawerTerminalCycleKeydown(
  event: KeyboardEvent,
  drawer: Element | null | undefined,
  terminalCount: number,
  cycle: (direction: 1 | -1) => void,
): boolean {
  const direction = drawerTerminalCycleDirection(event, drawer, terminalCount);
  if (!direction) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  cycle(direction);
  return true;
}
