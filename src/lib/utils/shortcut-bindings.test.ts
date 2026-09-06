import { describe, expect, it } from 'vitest';

import {
  applyShortcutCapture,
  matchesShortcutPattern,
  getShortcutSequenceTrigger,
  SHORTCUT_DEFAULTS,
  matchesShortcut,
  normalizeShortcut,
  resolveShortcut,
  sanitizeShortcutOverrides,
  shortcutFromKeyboardEvent,
} from './shortcut-bindings';
import { SHORTCUT_REGISTRY, SHORTCUTS } from './shortcuts';

describe('shortcut bindings', () => {
  it('gives every listed shortcut one stable default', () => {
    expect(SHORTCUT_REGISTRY).toHaveLength(Object.keys(SHORTCUT_DEFAULTS).length);
    expect(new Set(SHORTCUT_REGISTRY.map(({ id }) => id)).size).toBe(SHORTCUT_REGISTRY.length);
    expect(SHORTCUT_REGISTRY.map(({ defaultKey }) => defaultKey)).toEqual(
      SHORTCUT_REGISTRY.map(({ id }) => SHORTCUT_DEFAULTS[id]),
    );
  });

  it('normalizes aliases and rejects incomplete or malformed chords', () => {
    expect(normalizeShortcut(' Command + Option + P ')).toBe('mod+alt+p');
    expect(normalizeShortcut('ctrl+shift+ArrowLeft')).toBe('ctrl+shift+left');
    expect(normalizeShortcut('mod+')).toBeNull();
    expect(normalizeShortcut('mod+ctrl')).toBeNull();
    expect(normalizeShortcut('mod+shift+not-a-key')).toBeNull();
  });

  it('matches mod against the current platform with exact modifiers', () => {
    const macEvent = {
      key: 'P',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    };
    expect(matchesShortcut(macEvent, 'mod+shift+p', true)).toBe(true);
    expect(matchesShortcut(macEvent, 'mod+shift+p', false)).toBe(false);
    expect(matchesShortcut({ ...macEvent, altKey: true }, 'mod+shift+p', true)).toBe(false);
  });

  it('matches shifted digits and slash across browser key reporting variants', () => {
    const modifiers = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    expect(matchesShortcut({ key: '(', ...modifiers }, 'mod+shift+9', true)).toBe(true);
    expect(matchesShortcut({ key: '9', ...modifiers }, 'mod+shift+9', true)).toBe(true);
    expect(matchesShortcut({ key: '?', ...modifiers }, 'mod+?', true)).toBe(true);
    expect(matchesShortcut({ key: '/', ...modifiers }, 'mod+?', true)).toBe(true);
  });

  it('converts platform modifiers and pressed keys into canonical bindings', () => {
    const keyPress = {
      key: 'P',
      code: 'KeyP',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
    };
    expect(shortcutFromKeyboardEvent(keyPress, false)).toBe('mod+shift+p');
    expect(shortcutFromKeyboardEvent({ ...keyPress, metaKey: true, ctrlKey: false }, true)).toBe(
      'mod+shift+p',
    );
    expect(shortcutFromKeyboardEvent({ ...keyPress, ctrlKey: true }, true)).toBe('ctrl+shift+p');
  });

  it('rejects modifier-only and unrepresentable key presses', () => {
    expect(
      shortcutFromKeyboardEvent(
        {
          key: 'Control',
          code: 'ControlLeft',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        },
        false,
      ),
    ).toBeNull();
    expect(
      shortcutFromKeyboardEvent(
        {
          key: 'Dead',
          code: 'Quote',
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        false,
      ),
    ).toBeNull();
  });

  it('keeps valid known overrides and ignores unknown, default, and malformed values', () => {
    const overrides = sanitizeShortcutOverrides({
      'global.settings': 'cmd+shift+,',
      'chat.send': 'return',
      'global.search': 'mod+',
      unknown: 'mod+x',
    });
    expect(overrides).toEqual({ 'global.settings': 'mod+shift+,' });
    expect(resolveShortcut('global.settings', overrides)).toBe('mod+shift+,');
    expect(resolveShortcut('global.search', overrides)).toBe('mod+f');
  });

  it('defines one overridable creation chord for every workspace resource', () => {
    expect({
      agent: SHORTCUT_DEFAULTS['workspace.new-agent'],
      note: SHORTCUT_DEFAULTS['workspace.new-note'],
      terminal: SHORTCUT_DEFAULTS['workspace.new-terminal'],
      browser: SHORTCUT_DEFAULTS['workspace.new-browser'],
    }).toEqual({
      agent: 'mod+alt+a',
      note: 'mod+alt+n',
      terminal: 'mod+alt+t',
      browser: 'mod+alt+b',
    });
    expect(resolveShortcut('workspace.new-note', { 'workspace.new-note': 'mod+shift+n' })).toBe(
      'mod+shift+n',
    );
  });

  it('does not reject contextual duplicate defaults', () => {
    expect(SHORTCUTS.NEW_TAB.key).not.toBe(SHORTCUTS.NEW_AGENT.key);
    expect(SHORTCUTS.SEND.key).toBe(SHORTCUTS.CONFIRM.key);
  });

  it('preserves ranges and directional alternatives when capturing collective shortcuts', () => {
    expect(applyShortcutCapture('navigation.go-to-tab', 'alt+4')).toBe('alt+1-9');
    expect(normalizeShortcut('mod+shift+1-9')).toBe('mod+shift+1-9');
    expect(applyShortcutCapture('leader.navigate-panels', 'ctrl+x')).toBe('ctrl+h/j/k/l');
    expect(applyShortcutCapture('leader.resize-panels', 'mod+x')).toBe('mod+H/J/K/L');
    expect(applyShortcutCapture('leader.jump-to-panel', 'alt+x')).toBe('alt+x + 1-9');

    expect(normalizeShortcut('ctrl+h/j/k/l')).toBe('ctrl+h/ctrl+j/ctrl+k/ctrl+l');
    expect(normalizeShortcut('mod+H/J/K/L')).toBe(
      'mod+shift+h/mod+shift+j/mod+shift+k/mod+shift+l',
    );
    for (const [index, key] of ['h', 'j', 'k', 'l'].entries()) {
      expect(
        matchesShortcutPattern(
          { key, metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
          'ctrl+h/ctrl+j/ctrl+k/ctrl+l',
          true,
        ),
      ).toBe(index);
    }
    expect(normalizeShortcut('alt+x + 1-9')).toBe('alt+x + 1-9');
    expect(getShortcutSequenceTrigger('alt+x + 1-9')).toBe('alt+x');
  });
});
