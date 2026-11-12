import {
  expandShortcutPattern,
  normalizeShortcut,
  SHORTCUT_DEFAULTS,
  type ShortcutId,
  type ShortcutOverrides,
} from './keyboard-shortcut-bindings';
import type { DockShortcutAction } from './dock-shortcuts';
/** The dock's global shortcuts: open (linked conversation, else the index), capture, record. */
export const DOCK_SHORTCUT_IDS = ['dock.focus', 'dock.capture', 'dock.record'] as const;
/**
 * Former global dock shortcuts. A saved override for one is neither applied nor an error,
 * and it is kept as saved (never reset or deleted) when the dock shortcuts are written.
 */
export const LEGACY_DOCK_SHORTCUT_IDS = ['dock.dictate', 'dock.related'] as const;
export function isLegacyDockShortcutId(id: string): boolean {
  return (LEGACY_DOCK_SHORTCUT_IDS as readonly string[]).includes(id);
}
export type DockShortcutId = (typeof DOCK_SHORTCUT_IDS)[number];
export type DockShortcutOverrides = Partial<Record<DockShortcutId, string>>;
/** The actions global shortcuts drive (dictate is a menu command only). */
export type DockGlobalShortcutAction = 'focus' | 'capture' | 'record';
export type DockShortcutBindings = Record<DockGlobalShortcutAction, string>;
export type DockShortcutIssueCode =
  | 'invalid'
  | 'duplicate'
  | 'app-conflict'
  | 'unavailable'
  | 'save-failed'
  | 'stale'
  | 'load-failed';
export interface DockShortcutIssue {
  code: DockShortcutIssueCode;
  id?: DockShortcutId;
  otherId?: ShortcutId;
  key?: string;
}
export interface DockShortcutSettingsSnapshot {
  revision: number;
  enabled: boolean;
  capturing: boolean;
  overrides: DockShortcutOverrides;
  registered: DockShortcutAction[];
  issues: DockShortcutIssue[];
}
export function isDockShortcutId(id: string): id is DockShortcutId {
  return (DOCK_SHORTCUT_IDS as readonly string[]).includes(id);
}
export function dockShortcutAction(id: DockShortcutId): DockGlobalShortcutAction {
  return id.slice(5) as DockGlobalShortcutAction;
}
export function dockShortcutBindings(overrides: DockShortcutOverrides = {}): DockShortcutBindings {
  return Object.fromEntries(
    DOCK_SHORTCUT_IDS.map((id) => [dockShortcutAction(id), overrides[id] ?? SHORTCUT_DEFAULTS[id]]),
  ) as DockShortcutBindings;
}
/** One modified chord (or function key), never a range, sequence or global typing key. */
export function normalizeDockShortcut(value: string): string | null {
  const key = normalizeShortcut(value);
  if (!key || key.includes(' + ') || key.includes('/') || expandShortcutPattern(key).length !== 1)
    return null;
  return /^(mod|ctrl|alt)\+/.test(key) || /^(?:shift\+)?f(?:[1-9]|1[0-2])$/.test(key) ? key : null;
}
export function dockShortcutAccelerator(key: string, platform: string): string | null {
  const normalized = normalizeDockShortcut(key);
  if (!normalized) return null;
  const parts = normalized.split('+');
  const last = parts.pop()!;
  const modifiers = new Set(
    parts.map((part) =>
      part === 'mod'
        ? platform === 'darwin'
          ? 'Command'
          : 'Control'
        : part === 'ctrl'
          ? 'Control'
          : part === 'alt'
            ? 'Alt'
            : 'Shift',
    ),
  );
  const keys: Record<string, string> = {
    esc: 'Escape',
    space: 'Space',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    enter: 'Return',
    backspace: 'Backspace',
    delete: 'Delete',
    tab: 'Tab',
    home: 'Home',
    end: 'End',
  };
  return [...modifiers, keys[last] ?? last.toUpperCase()].join('+');
}
export function dockBindingIssues(
  bindings: DockShortcutBindings,
  platform: string,
  appOverrides: ShortcutOverrides = {},
): DockShortcutIssue[] {
  const issues: DockShortcutIssue[] = [];
  const seen = new Map<string, DockShortcutId>();
  for (const id of DOCK_SHORTCUT_IDS) {
    const key = bindings[dockShortcutAction(id)],
      accelerator = dockShortcutAccelerator(key, platform);
    if (!accelerator) {
      issues.push({ code: 'invalid', id, key });
      continue;
    }
    const other = seen.get(accelerator);
    if (other) issues.push({ code: 'duplicate', id, otherId: other, key });
    seen.set(accelerator, id);
    for (const otherId of Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[]) {
      if (isDockShortcutId(otherId)) continue;
      const patterns = expandShortcutPattern(appOverrides[otherId] ?? SHORTCUT_DEFAULTS[otherId]);
      if (patterns.some((pattern) => dockShortcutAccelerator(pattern, platform) === accelerator)) {
        issues.push({ code: 'app-conflict', id, otherId, key });
        break;
      }
    }
    const reserved =
      platform === 'darwin'
        ? [
            'mod+q',
            'mod+h',
            'mod+m',
            'mod+tab',
            'mod+space',
            'mod+alt+esc',
            'mod+shift+3',
            'mod+shift+4',
            'mod+shift+5',
          ]
        : ['alt+f4', 'alt+tab', 'ctrl+alt+delete'];
    if (reserved.some((pattern) => dockShortcutAccelerator(pattern, platform) === accelerator))
      issues.push({ code: 'app-conflict', id, key });
  }
  return issues;
}

export function isDockShortcutSnapshot(value: unknown): value is DockShortcutSettingsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<DockShortcutSettingsSnapshot>;
  return (
    Number.isInteger(row.revision) &&
    Number(row.revision) >= 0 &&
    typeof row.enabled === 'boolean' &&
    typeof row.capturing === 'boolean' &&
    !!row.overrides &&
    typeof row.overrides === 'object' &&
    !Array.isArray(row.overrides) &&
    Object.entries(row.overrides).every(
      ([id, key]) =>
        isDockShortcutId(id) && typeof key === 'string' && !!normalizeDockShortcut(key),
    ) &&
    Array.isArray(row.registered) &&
    row.registered.every((action) =>
      DOCK_SHORTCUT_IDS.some((id) => dockShortcutAction(id) === action),
    ) &&
    Array.isArray(row.issues) &&
    row.issues.every(
      (issue) =>
        issue &&
        [
          'invalid',
          'duplicate',
          'app-conflict',
          'unavailable',
          'save-failed',
          'stale',
          'load-failed',
        ].includes(issue.code),
    )
  );
}
