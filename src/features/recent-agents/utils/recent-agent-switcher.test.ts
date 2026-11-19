import { describe, expect, it } from 'vitest';
import {
  isSwitcherModifierReleased,
  matchSwitcherChord,
  stepSwitcher,
  switcherHeldModifiers,
  SWITCHER_CLOSED,
  type SwitcherEvent,
  type SwitcherState,
} from './recent-agent-switcher';

const chord = (backwards = false, sticky = false): SwitcherEvent => ({
  type: 'chord',
  backwards,
  sticky,
});

function run(events: SwitcherEvent[], count: number) {
  let state: SwitcherState = SWITCHER_CLOSED;
  let opened: number | undefined;
  for (const event of events) {
    const step = stepSwitcher(state, event, count);
    state = step.state;
    if (step.open !== undefined) opened = step.open;
  }
  return { state, opened };
}

function key(
  key: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('stepSwitcher', () => {
  it('a quick press and release opens the previous agent', () => {
    expect(run([chord(), { type: 'release' }], 4)).toEqual({ state: SWITCHER_CLOSED, opened: 1 });
  });

  it('each further press moves on, wrapping past the end', () => {
    expect(run([chord(), chord(), chord(), chord(), { type: 'release' }], 3).opened).toBe(1);
  });

  it('Shift moves backwards, and a first backwards press starts at the oldest entry', () => {
    expect(run([chord(true), { type: 'release' }], 4).opened).toBe(3);
    expect(run([chord(), chord(), chord(true), { type: 'release' }], 4).opened).toBe(1);
  });

  it('a single entry opens that entry', () => {
    expect(run([chord(), { type: 'release' }], 1).opened).toBe(0);
  });

  it('does not open with nothing to show', () => {
    expect(run([chord()], 0).state).toEqual(SWITCHER_CLOSED);
  });

  it('Esc closes without opening anything', () => {
    expect(run([chord(), chord(), { type: 'cancel' }, { type: 'release' }], 4)).toEqual({
      state: SWITCHER_CLOSED,
      opened: undefined,
    });
  });

  it('a pointed entry is the one the release opens', () => {
    expect(run([chord(), { type: 'point', index: 3 }, { type: 'release' }], 4).opened).toBe(3);
  });

  it('a sticky switcher ignores the release and opens on confirm', () => {
    const held = run([chord(false, true), { type: 'move', delta: 1 }, { type: 'release' }], 4);
    expect(held.state).toMatchObject({ open: true, index: 2 });
    expect(held.opened).toBeUndefined();

    expect(
      run([chord(false, true), { type: 'move', delta: -1 }, { type: 'confirm' }], 4).opened,
    ).toBe(0);
  });

  it('ignores everything but the chord while closed', () => {
    expect(run([{ type: 'release' }, { type: 'confirm' }, { type: 'move', delta: 1 }], 4)).toEqual({
      state: SWITCHER_CLOSED,
      opened: undefined,
    });
  });
});

describe('matchSwitcherChord', () => {
  it('reads Option+Tab forward and Option+Shift+Tab backward on macOS', () => {
    expect(matchSwitcherChord(key('Tab', { altKey: true }), 'alt+tab', true)).toBe('forward');
    expect(matchSwitcherChord(key('Tab', { altKey: true, shiftKey: true }), 'alt+tab', true)).toBe(
      'backward',
    );
    expect(matchSwitcherChord(key('Tab', { metaKey: true }), 'alt+tab', true)).toBeNull();
  });

  it('never opens without a binding (no default on Windows)', () => {
    expect(matchSwitcherChord(key('Tab', { altKey: true }), '', false)).toBeNull();
    expect(switcherHeldModifiers('', false)).toBeNull();
  });

  it('reads Super+Tab on Linux from the Meta key', () => {
    expect(matchSwitcherChord(key('Tab', { metaKey: true }), 'super+tab', false)).toBe('forward');
    expect(matchSwitcherChord(key('Tab', { ctrlKey: true }), 'super+tab', false)).toBeNull();
  });

  it('rejects other chords, and a Shift binding has no backwards chord', () => {
    expect(matchSwitcherChord(key('Tab', { altKey: true }), 'ctrl+tab', false)).toBeNull();
    expect(matchSwitcherChord(key('Tab'), 'ctrl+tab', false)).toBeNull();
    expect(
      matchSwitcherChord(key('Tab', { ctrlKey: true, shiftKey: true }), 'ctrl+shift+tab', false),
    ).toBe('forward');
    expect(matchSwitcherChord(key('Tab', { ctrlKey: true }), 'ctrl+shift+tab', false)).toBeNull();
  });
});

describe('switcher release', () => {
  it('waits on the platform modifier of the binding', () => {
    expect(switcherHeldModifiers('super+tab', false)).toEqual({
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    });
    expect(switcherHeldModifiers('mod+tab', true)).toEqual({
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    });
    expect(switcherHeldModifiers('mod+tab', false)).toEqual({
      metaKey: false,
      ctrlKey: true,
      altKey: false,
    });
  });

  it('has nothing to wait on for a chord without a held modifier', () => {
    expect(switcherHeldModifiers('f6', false)).toBeNull();
    expect(switcherHeldModifiers('shift+f6', false)).toBeNull();
  });

  it('notices when a held modifier is let go, not when Shift is', () => {
    const held = { metaKey: false, ctrlKey: true, altKey: false };
    expect(
      isSwitcherModifierReleased(held, { metaKey: false, ctrlKey: false, altKey: false }),
    ).toBe(true);
    expect(isSwitcherModifierReleased(held, { metaKey: false, ctrlKey: true, altKey: false })).toBe(
      false,
    );
  });
});
