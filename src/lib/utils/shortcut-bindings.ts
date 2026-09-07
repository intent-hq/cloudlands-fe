export const SHORTCUT_DEFAULTS = {
  'global.command-palette': 'mod+shift+p',
  'global.settings': 'mod+,',
  'global.keyboard-shortcuts': 'mod+?',
  'global.command-palette-alt': 'mod+k',
  'global.toggle-spaces': 'mod+o',
  'global.new-space': 'mod+n',
  'global.search': 'mod+f',
  'global.next-space': 'ctrl+tab',
  'global.previous-space': 'ctrl+shift+tab',
  'navigation.go-to-tab': 'mod+1-9',
  'navigation.new-tab': 'mod+t',
  'navigation.close-tab': 'mod+w',
  'navigation.close-space-tab': 'mod+shift+w',
  'navigation.reopen-tab': 'mod+shift+t',
  'navigation.move-space-tab-left': 'mod+alt+shift+left',
  'navigation.move-space-tab-right': 'mod+alt+shift+right',
  'workspace.new-agent': 'mod+alt+a',
  'workspace.new-note': 'mod+alt+n',
  'workspace.new-terminal': 'mod+alt+t',
  'workspace.new-browser': 'mod+alt+b',
  'chat.send': 'enter',
  'chat.force-send': 'mod+enter',
  'chat.new-line': 'shift+enter',
  'chat.focus-input': '/',
  'chat.mention-context': '@',
  'editor.go-to-line': 'mod+g',
  'editor.save': 'mod+s',
  'editor.undo': 'mod+z',
  'editor.redo': 'mod+shift+z',
  'editor.toggle-task-list': 'mod+shift+9',
  'editor.toggle-word-wrap': 'alt+z',
  'editor.copy': 'mod+c',
  'editor.select-all': 'mod+a',
  'panel.toggle-sidebar': 'mod+b',
  'panel.create-column-right': 'mod+\\',
  'panel.focus-next-column': 'mod+shift+]',
  'panel.maximize': 'mod+shift+m',
  'panel.focus-previous-column': 'mod+shift+[',
  'panel.next-pane': 'mod+]',
  'panel.previous-pane': 'mod+[',
  'panel.move-pane-next-column': 'mod+alt+pagedown',
  'panel.move-pane-previous-column': 'mod+alt+pageup',
  'panel.copy-browser-url': 'mod+shift+c',
  'leader.navigate-panels': 'h/j/k/l',
  'leader.resize-panels': 'H/J/K/L',
  'leader.split-right': '%',
  'leader.toggle-zoom': 'z',
  'leader.close-panel': 'x',
  'leader.next-previous-panel': 'o/p',
  'leader.equalize-sizes': '=',
  'leader.jump-to-panel': 'q + 1-9',
  'leader.cycle-layout': 'space',
} as const;

export type ShortcutId = keyof typeof SHORTCUT_DEFAULTS;
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;

const MODIFIER_ORDER = ['mod', 'ctrl', 'alt', 'shift'] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  mod: 'mod',
  cmd: 'mod',
  command: 'mod',
  meta: 'mod',
  control: 'ctrl',
  ctrl: 'ctrl',
  option: 'alt',
  alt: 'alt',
  shift: 'shift',
};
const KEY_ALIASES: Record<string, string> = {
  escape: 'esc',
  return: 'enter',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  pgup: 'pageup',
  pgdn: 'pagedown',
  ' ': 'space',
};
const NAMED_KEYS = new Set([
  'backspace',
  'delete',
  'down',
  'end',
  'enter',
  'esc',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
  'home',
  'left',
  'pagedown',
  'pageup',
  'right',
  'space',
  'tab',
  'up',
]);

interface ParsedShortcut {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface ShortcutKeyboardEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_EVENT_KEYS = new Set(['alt', 'control', 'meta', 'shift']);
const SHIFTED_KEY_BASES: Record<string, string> = {
  '~': '`',
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
};
const BASE_KEY_SHIFTS = Object.fromEntries(
  Object.entries(SHIFTED_KEY_BASES).map(([shifted, base]) => [base, shifted]),
);

/** Convert a supported key press into the canonical value stored in preferences. */
export function shortcutFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
  mac: boolean,
): string | null {
  if (MODIFIER_EVENT_KEYS.has(event.key.toLowerCase())) return null;
  if (!mac && event.metaKey) return null;

  let key = event.key;
  if (event.altKey && event.code?.startsWith('Key')) key = event.code.slice(3);
  else if (event.altKey && event.code?.startsWith('Digit')) key = event.code.slice(5);

  const parts: string[] = [];
  if ((mac && event.metaKey) || (!mac && event.ctrlKey)) parts.push('mod');
  if (mac && event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(key);
  return normalizeShortcut(parts.join('+'));
}

export function isShortcutId(value: string): value is ShortcutId {
  return Object.prototype.hasOwnProperty.call(SHORTCUT_DEFAULTS, value);
}

function parseShortcut(value: string): ParsedShortcut | null {
  const input = value.trim();
  if (!input || input.includes('/')) return null;
  const parts = input
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }

  const rawKey = parts.at(-1) ?? '';
  if (MODIFIER_ALIASES[rawKey.toLowerCase()]) return null;
  const key = KEY_ALIASES[rawKey.toLowerCase()] ?? rawKey.toLowerCase();
  if (!(key.length === 1 || NAMED_KEYS.has(key))) return null;
  return {
    key,
    mod: modifiers.has('mod'),
    ctrl: modifiers.has('ctrl'),
    alt: modifiers.has('alt'),
    shift: modifiers.has('shift'),
  };
}

export function normalizeShortcut(value: string): string | null {
  const input = value.trim();
  if (input.includes('/')) {
    const alternatives = input.split('/').map((part) => part.trim());
    const first = alternatives[0] ?? '';
    const commonPrefix = first.includes('+') ? `${first.slice(0, first.lastIndexOf('+'))}+` : '';
    const normalized = alternatives.map((part, index) => {
      const candidate =
        index > 0 && commonPrefix && !part.includes('+') ? commonPrefix + part : part;
      const rawKey = candidate.slice(candidate.lastIndexOf('+') + 1);
      const parsed = parseShortcut(
        /^[A-Z]$/.test(rawKey)
          ? `${candidate.slice(0, -1)}shift+${rawKey.toLowerCase()}`
          : candidate,
      );
      if (!parsed) return null;
      const modifiers = MODIFIER_ORDER.filter((modifier) => parsed[modifier]);
      return [...modifiers, parsed.key].join('+');
    });
    if (normalized.some((part) => !part)) return null;
    return normalized.join('/');
  }
  const rangeMatch = input.match(/^(.*\+)?([1-8])-9$/i);
  if (rangeMatch) {
    const parsed = parseShortcut(`${rangeMatch[1] ?? ''}${rangeMatch[2]}`);
    if (!parsed) return null;
    const modifiers = MODIFIER_ORDER.filter((modifier) => parsed[modifier]);
    return `${modifiers.length ? `${modifiers.join('+')}+` : ''}${rangeMatch[2]}-9`;
  }
  const sequenceMatch = input.match(/^(.+?)\s+\+\s+([1-8]-9)$/);
  if (sequenceMatch) {
    const trigger = normalizeShortcut(sequenceMatch[1]);
    return trigger ? `${trigger} + ${sequenceMatch[2]}` : null;
  }
  const parsed = parseShortcut(value);
  if (!parsed) return null;
  const modifiers = MODIFIER_ORDER.filter((modifier) => parsed[modifier]);
  return [...modifiers, parsed.key].join('+');
}

/** Preserve a collective shortcut's range/alternatives while changing its captured chord. */
export function applyShortcutCapture(id: ShortcutId, captured: string): string {
  const defaultBinding = SHORTCUT_DEFAULTS[id];
  const modifiers = captured.includes('+')
    ? `${captured.slice(0, captured.lastIndexOf('+'))}+`
    : '';
  const sequenceMatch = defaultBinding.match(/^(.+?)\s+\+\s+([1-8]-9)$/);
  if (sequenceMatch) return `${captured} + ${sequenceMatch[2]}`;

  const rangeMatch = defaultBinding.match(/^(?:.*\+)?([1-8]-9)$/);
  if (rangeMatch) return `${modifiers}${rangeMatch[1]}`;

  if (defaultBinding.includes('/')) return `${modifiers}${defaultBinding}`;

  return captured;
}

export function getShortcutSequenceTrigger(shortcut: string): string | null {
  return shortcut.match(/^(.+?)\s+\+\s+[1-8]-9$/)?.[1] ?? null;
}

/** Expand a displayed alternative/range binding into the concrete keys it represents. */
function expandShortcutPattern(shortcut: string): string[] {
  const rangeMatch = shortcut.match(/^(.*\+)?([1-8])-9$/);
  if (rangeMatch) {
    const prefix = rangeMatch[1] ?? '';
    return Array.from(
      { length: 10 - Number(rangeMatch[2]) },
      (_, index) => `${prefix}${Number(rangeMatch[2]) + index}`,
    );
  }
  const alternatives = shortcut.split('/');
  const first = alternatives[0] ?? '';
  const commonPrefix = first.includes('+') ? `${first.slice(0, first.lastIndexOf('+'))}+` : '';
  return alternatives.map((part, index) => {
    const token = part.trim();
    const binding =
      index > 0 && commonPrefix && !token.includes('+') ? commonPrefix + token : token;
    return /^[A-Z]$/.test(binding)
      ? `shift+${binding.toLowerCase()}`
      : binding === 'space'
        ? 'space'
        : binding;
  });
}

export function matchesShortcutPattern(
  event: ShortcutKeyboardEvent,
  shortcut: string,
  mac: boolean,
): number {
  return expandShortcutPattern(shortcut).findIndex((binding) =>
    matchesShortcut(event, binding, mac),
  );
}

export function matchesShortcut(
  event: ShortcutKeyboardEvent,
  shortcut: string,
  mac: boolean,
): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  const eventKey = KEY_ALIASES[event.key.toLowerCase()] ?? event.key.toLowerCase();
  const implicitShift = parsed.key.length === 1 && '~!@#$%^&*()_+{}|:"<>?'.includes(parsed.key);
  const equivalentKeys = new Set([
    eventKey,
    SHIFTED_KEY_BASES[eventKey],
    event.shiftKey ? BASE_KEY_SHIFTS[eventKey] : undefined,
  ]);
  return (
    equivalentKeys.has(parsed.key) &&
    event.metaKey === (parsed.mod && mac) &&
    event.ctrlKey === (parsed.ctrl || (parsed.mod && !mac)) &&
    event.altKey === parsed.alt &&
    event.shiftKey === (parsed.shift || implicitShift)
  );
}

export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const overrides: ShortcutOverrides = {};
  for (const [id, shortcut] of Object.entries(value)) {
    if (!isShortcutId(id) || typeof shortcut !== 'string') continue;
    const normalized = normalizeShortcut(shortcut);
    if (normalized && normalized !== SHORTCUT_DEFAULTS[id]) overrides[id] = normalized;
  }
  return overrides;
}

export function resolveShortcut(id: ShortcutId, overrides: ShortcutOverrides): string {
  return overrides[id] ?? SHORTCUT_DEFAULTS[id];
}
