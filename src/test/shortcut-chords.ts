/**
 * Turns one shortcut binding from `SHORTCUT_DEFAULTS` into the keys a test presses, so a
 * spec follows the table when a shortcut moves instead of pressing a stale copy.
 *
 * Pass the binding string, not the id: the spec then imports `$lib/utils/shortcut-bindings`
 * itself, and changed-test selection (which follows a spec's direct imports) reruns it
 * whenever the table changes.
 */

export interface ShortcutKeydown {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutChord {
  /** Playwright `keyboard.press` / `locator.press` string, e.g. `Meta+Alt+ArrowRight`. */
  press: string;
  /** `KeyboardEvent` init for a dispatched `keydown`, as a US-layout browser reports it. */
  event: ShortcutKeydown;
}

const NAMED_KEYS: Record<string, { key: string; press: string }> = {
  left: { key: 'ArrowLeft', press: 'ArrowLeft' },
  right: { key: 'ArrowRight', press: 'ArrowRight' },
  up: { key: 'ArrowUp', press: 'ArrowUp' },
  down: { key: 'ArrowDown', press: 'ArrowDown' },
  pageup: { key: 'PageUp', press: 'PageUp' },
  pagedown: { key: 'PageDown', press: 'PageDown' },
  home: { key: 'Home', press: 'Home' },
  end: { key: 'End', press: 'End' },
  enter: { key: 'Enter', press: 'Enter' },
  esc: { key: 'Escape', press: 'Escape' },
  tab: { key: 'Tab', press: 'Tab' },
  space: { key: ' ', press: 'Space' },
  backspace: { key: 'Backspace', press: 'Backspace' },
  delete: { key: 'Delete', press: 'Delete' },
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`f${index + 1}`, `F${index + 1}`]).map(
      ([id, name]) => [id, { key: name, press: name }],
    ),
  ),
};

const SHIFTED: Record<string, string> = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
};
const UNSHIFTED = Object.fromEntries(Object.entries(SHIFTED).map(([base, top]) => [top, base]));

// Playwright reads a bare punctuation character as text; a key name presses the physical key.
const PRESS_NAMES: Record<string, string> = {
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
};

const MODIFIERS = new Set(['mod', 'ctrl', 'alt', 'shift']);

function notSingleChord(binding: string, why: string): Error {
  return new Error(`"${binding}" is not a single chord (${why})`);
}

export function shortcutChord(binding: string, mac: boolean): ShortcutChord {
  if (/\s\+\s/.test(binding)) throw notSingleChord(binding, 'key sequence');
  if (/[1-8]-9$/.test(binding)) throw notSingleChord(binding, 'key range');
  if (binding.length > 1 && binding.includes('/'))
    throw notSingleChord(binding, 'alternatives');

  const parts = binding.split('+');
  const token = parts.pop() ?? '';
  const modifiers = new Set(parts);
  if (!token || parts.some((part) => !MODIFIERS.has(part)) || modifiers.size !== parts.length)
    throw notSingleChord(binding, 'unknown or repeated modifier');

  let key: string;
  let press: string;
  let shift = modifiers.has('shift');
  const named = NAMED_KEYS[token];
  if (named) {
    ({ key, press } = named);
  } else if (token.length === 1) {
    const lower = token.toLowerCase();
    const base = UNSHIFTED[lower];
    if (base) shift = true;
    const physical = base ?? lower;
    key = /^[a-z]$/.test(lower) && shift ? lower.toUpperCase() : (shift && SHIFTED[lower]) || lower;
    press = PRESS_NAMES[physical] ?? physical;
  } else {
    throw notSingleChord(binding, `unknown key "${token}"`);
  }

  const event: ShortcutKeydown = {
    key,
    metaKey: mac && modifiers.has('mod'),
    ctrlKey: modifiers.has('ctrl') || (!mac && modifiers.has('mod')),
    altKey: modifiers.has('alt'),
    shiftKey: shift,
  };
  const names = [
    event.metaKey && 'Meta',
    event.ctrlKey && 'Control',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
  ].filter(Boolean);
  return { press: [...names, press].join('+'), event };
}
