// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_DEFAULTS,
  matchesShortcut,
  normalizeShortcut,
  type ShortcutId,
} from '$lib/utils/shortcut-bindings';
import { shortcutChord } from './shortcut-chords';

const isSingleChord = (binding: string) =>
  normalizeShortcut(binding) !== null &&
  !/\s\+\s/.test(binding) &&
  !/[1-8]-9$/.test(binding) &&
  !binding.includes('/');

const singleChordIds = (Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[]).filter((id) =>
  isSingleChord(SHORTCUT_DEFAULTS[id]),
);

describe('shortcutChord', () => {
  it('covers the panel and workspace bindings the component specs press', () => {
    expect(singleChordIds).toEqual(
      expect.arrayContaining([
        'panel.focus-next-column',
        'panel.focus-previous-column',
        'panel.create-column-right',
        'navigation.close-tab',
        'navigation.close-space-tab',
        'workspace.set-aside',
        'global.next-space-alt',
      ]),
    );
  });

  for (const mac of [true, false]) {
    const platform = mac ? 'macOS' : 'Windows/Linux';

    it(`builds a keydown the app matcher accepts for every single-chord default on ${platform}`, () => {
      const rejected = singleChordIds.filter((id) => {
        const { event } = shortcutChord(SHORTCUT_DEFAULTS[id], mac);
        return !matchesShortcut(event, SHORTCUT_DEFAULTS[id], mac);
      });
      expect(rejected).toEqual([]);
    });

    it(`builds a keydown no other single-chord default claims on ${platform}`, () => {
      const collisions = singleChordIds.flatMap((id) => {
        const { event } = shortcutChord(SHORTCUT_DEFAULTS[id], mac);
        return singleChordIds
          .filter(
            (other) =>
              other !== id &&
              SHORTCUT_DEFAULTS[other] !== SHORTCUT_DEFAULTS[id] &&
              matchesShortcut(event, SHORTCUT_DEFAULTS[other], mac),
          )
          .map((other) => `${id} -> ${other}`);
      });
      expect(collisions).toEqual([]);
    });
  }

  it('maps Mod to Meta on macOS and Control elsewhere, in Playwright key names', () => {
    expect(shortcutChord('mod+alt+right', true).press).toBe('Meta+Alt+ArrowRight');
    expect(shortcutChord('mod+alt+right', false).press).toBe('Control+Alt+ArrowRight');
    expect(shortcutChord('mod+\\', true).press).toBe('Meta+Backslash');
    expect(shortcutChord('mod+alt+pagedown', false).press).toBe('Control+Alt+PageDown');
    expect(shortcutChord('ctrl+shift+tab', true).press).toBe('Control+Shift+Tab');
    expect(shortcutChord('mod+shift+w', false).press).toBe('Control+Shift+w');
  });

  it('reports the key a browser sends while Shift is held', () => {
    expect(shortcutChord('mod+shift+]', true).event).toEqual({
      key: '}',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    });
    expect(shortcutChord('mod+shift+s', false).event).toMatchObject({ key: 'S', ctrlKey: true });
    expect(shortcutChord('mod+?', true)).toEqual({
      press: 'Meta+Shift+Slash',
      event: { key: '?', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
    });
  });

  it('rejects bindings that are not one chord', () => {
    for (const binding of ['mod+1-9', 'h/j/k/l', 'q + 1-9', 'mod+', 'hyper+k', 'mod+bogus']) {
      expect(() => shortcutChord(binding, true), binding).toThrow(/single chord/);
    }
  });
});
