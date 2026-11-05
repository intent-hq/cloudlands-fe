import { describe, expect, it } from 'vitest';
import { isTerminalPassthroughChord } from './terminal-app-chords';

const press = (key: string, init: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>>) => ({
  key,
  metaKey: !!init.meta,
  ctrlKey: !!init.ctrl,
  altKey: !!init.alt,
  shiftKey: !!init.shift,
});

describe('isTerminalPassthroughChord', () => {
  it('keeps Windows/Linux Ctrl+Alt+Left/Right out of xterm so the terminal types nothing', () => {
    expect(
      isTerminalPassthroughChord(press('ArrowRight', { ctrl: true, alt: true }), {}, false),
    ).toBe(true);
    expect(
      isTerminalPassthroughChord(press('ArrowLeft', { ctrl: true, alt: true }), {}, false),
    ).toBe(true);
    expect(isTerminalPassthroughChord(press('ArrowLeft', { alt: true }), {}, false)).toBe(false);
    expect(isTerminalPassthroughChord(press('ArrowLeft', { ctrl: true }), {}, false)).toBe(false);
  });

  it('passes the macOS column-focus and workspace-tab chords through', () => {
    expect(
      isTerminalPassthroughChord(press('ArrowRight', { meta: true, alt: true }), {}, true),
    ).toBe(true);
    expect(isTerminalPassthroughChord(press('}', { meta: true, shift: true }), {}, true)).toBe(
      true,
    );
    expect(isTerminalPassthroughChord(press('{', { meta: true, shift: true }), {}, true)).toBe(
      true,
    );
    expect(isTerminalPassthroughChord(press('ArrowRight', { alt: true }), {}, true)).toBe(false);
  });

  it('follows the resolved binding after a user rebinds column focus', () => {
    const overrides = { 'panel.focus-next-column': 'mod+alt+l' } as const;
    expect(
      isTerminalPassthroughChord(press('l', { ctrl: true, alt: true }), overrides, false),
    ).toBe(true);
    expect(
      isTerminalPassthroughChord(press('ArrowRight', { ctrl: true, alt: true }), overrides, false),
    ).toBe(false);
  });
});
