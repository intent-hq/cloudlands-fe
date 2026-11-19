/**
 * Key state of the recent-agent switcher, the app's Cmd+Tab: hold the chord's modifier, press
 * its key again to move (Shift moves back), release the modifier to open the selected agent,
 * Esc to cancel. The first press selects the second entry, so a quick press and release returns
 * to the previous agent. A chord with no modifier to hold keeps the switcher open until Enter.
 */
import { shortcutHeldModifiers, type HeldShortcutModifiers } from '$lib/utils/shortcut-bindings';

export type SwitcherState =
  | { open: false }
  | {
      open: true;
      index: number;
      /** No modifier to release: Enter or a click opens the selection. */
      sticky: boolean;
    };

export type SwitcherEvent =
  | { type: 'chord'; backwards: boolean; sticky: boolean }
  | { type: 'move'; delta: number }
  | { type: 'point'; index: number }
  | { type: 'release' }
  | { type: 'confirm' }
  | { type: 'cancel' };

export interface SwitcherStep {
  state: SwitcherState;
  /** Index of the entry to open, when this step chose one. */
  open?: number;
}

export const SWITCHER_CLOSED: SwitcherState = { open: false };

function wrap(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/** Advance the switcher for `count` entries. */
export function stepSwitcher(
  state: SwitcherState,
  event: SwitcherEvent,
  count: number,
): SwitcherStep {
  if (count === 0) return { state: SWITCHER_CLOSED };
  if (!state.open) {
    if (event.type !== 'chord') return { state };
    const index = count === 1 ? 0 : event.backwards ? count - 1 : 1;
    return { state: { open: true, index, sticky: event.sticky } };
  }
  switch (event.type) {
    case 'chord':
      return { state: { ...state, index: wrap(state.index + (event.backwards ? -1 : 1), count) } };
    case 'move':
      return { state: { ...state, index: wrap(state.index + event.delta, count) } };
    case 'point':
      return { state: { ...state, index: wrap(event.index, count) } };
    case 'release':
      return state.sticky ? { state } : { state: SWITCHER_CLOSED, open: wrap(state.index, count) };
    case 'confirm':
      return { state: SWITCHER_CLOSED, open: wrap(state.index, count) };
    case 'cancel':
      return { state: SWITCHER_CLOSED };
  }
}

/** The modifiers the switcher waits on, or null when the binding holds none (sticky mode). */
export function switcherHeldModifiers(binding: string, mac: boolean): HeldShortcutModifiers | null {
  const held = shortcutHeldModifiers(binding, mac);
  return held && (held.metaKey || held.ctrlKey || held.altKey) ? held : null;
}

/** True once any modifier the switcher waits on is no longer held. */
export function isSwitcherModifierReleased(
  held: HeldShortcutModifiers,
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>,
): boolean {
  return (
    (held.metaKey && !event.metaKey) ||
    (held.ctrlKey && !event.ctrlKey) ||
    (held.altKey && !event.altKey)
  );
}

/** Key names of each held modifier; Linux browsers have reported the Super key as all three. */
const MODIFIER_KEYS = {
  metaKey: ['Meta', 'OS', 'Super'],
  ctrlKey: ['Control'],
  altKey: ['Alt'],
} as const;

/**
 * True when `event` releases a modifier the switcher waits on. Only that key's release counts:
 * releasing Tab while Cmd stays down must not open the selection, even where the Tab key-up
 * reports no modifiers.
 */
export function isSwitcherModifierKeyUp(
  held: HeldShortcutModifiers,
  event: Pick<KeyboardEvent, 'key'>,
): boolean {
  return (Object.keys(MODIFIER_KEYS) as (keyof typeof MODIFIER_KEYS)[]).some(
    (flag) => held[flag] && (MODIFIER_KEYS[flag] as readonly string[]).includes(event.key),
  );
}
