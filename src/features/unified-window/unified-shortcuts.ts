/**
 * Tab shortcuts in the Unified window act on the shell's cross-machine strip, but
 * keyboard focus is usually inside a machine view. Main intercepts these keys in a
 * view (`before-input-event`) and hands the command to the shell. Fixed defaults:
 * the view keeps every other shortcut.
 */

/** The fields of Electron's `Input` this mapping reads. */
export interface ShortcutInput {
  type: string;
  key: string;
  code: string;
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
}

export type UnifiedShortcut =
  | { command: 'palette' }
  | { command: 'select-index'; index: number }
  | { command: 'select-last' }
  | { command: 'next-tab' }
  | { command: 'previous-tab' }
  | { command: 'close-tab' }
  | { command: 'reopen-tab' };

export function unifiedTabShortcut(input: ShortcutInput, mac: boolean): UnifiedShortcut | null {
  if (input.type !== 'keyDown' || input.alt) return null;
  const key = input.key.toLowerCase();

  // Ctrl+Tab cycles tabs on every platform.
  if (key === 'tab' && input.control && !input.meta)
    return { command: input.shift ? 'previous-tab' : 'next-tab' };

  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return null;

  if (input.shift) {
    if (input.code === 'BracketRight') return { command: 'next-tab' };
    if (input.code === 'BracketLeft') return { command: 'previous-tab' };
    if (key === 't') return { command: 'reopen-tab' };
    return null;
  }
  if (key === 'k') return { command: 'palette' };
  if (key === 'w') return { command: 'close-tab' };
  const digit = /^Digit([1-9])$/.exec(input.code);
  if (digit) {
    const number = Number(digit[1]);
    return number === 9 ? { command: 'select-last' } : { command: 'select-index', index: number - 1 };
  }
  return null;
}
