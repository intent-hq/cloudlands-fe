import { describe, expect, it } from 'vitest';

import {
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

  it('does not reject contextual duplicate defaults', () => {
    expect(SHORTCUTS.NEW_TAB.key).toBe(SHORTCUTS.NEW_AGENT.key);
    expect(SHORTCUTS.SEND.key).toBe(SHORTCUTS.CONFIRM.key);
  });
});
