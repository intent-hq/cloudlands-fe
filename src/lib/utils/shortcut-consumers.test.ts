import { describe, expect, it } from 'vitest';
import { SHORTCUT_REGISTRY } from './shortcuts';
import { SHORTCUT_RUNTIME_CONSUMERS } from './shortcut-consumers';
import { matchesShortcutPattern, normalizeShortcut } from './shortcut-bindings';

describe('shortcut runtime consumer audit', () => {
  it('maps every editable registry row to a runtime consumer', () => {
    expect(Object.keys(SHORTCUT_RUNTIME_CONSUMERS)).toEqual(SHORTCUT_REGISTRY.map(({ id }) => id));
  });

  it('supports editable alternative, range, and leader sequence notation', () => {
    expect(normalizeShortcut('h/j/k/l')).toBe('h/j/k/l');
    expect(normalizeShortcut('mod+1-9')).toBe('mod+1-9');
    expect(normalizeShortcut('q + 1-9')).toBe('q + 1-9');
    expect(
      matchesShortcutPattern(
        { key: 'J', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true },
        'H/J/K/L',
        true,
      ),
    ).toBe(1);
  });
});
