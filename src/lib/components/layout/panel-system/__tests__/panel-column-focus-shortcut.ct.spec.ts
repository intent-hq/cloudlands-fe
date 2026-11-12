import { expect, test } from '../../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import { SHORTCUT_DEFAULTS } from '$lib/utils/shortcut-bindings';
import { shortcutChord, type ShortcutKeydown } from '../../../../../test/shortcut-chords';
import PanelModWShortcutHarness from './mocks/PanelModWShortcutHarness.svelte';

async function dispatchChord(target: Locator, chord: ShortcutKeydown) {
  return target.evaluate((element, chord) => {
    (element as HTMLElement).focus();
    const event = new KeyboardEvent('keydown', { ...chord, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return {
      active: document.activeElement === element,
      defaultPrevented: event.defaultPrevented,
    };
  }, chord);
}

for (const { platform, navigatorPlatform, isMac } of [
  { platform: 'macOS', navigatorPlatform: 'MacIntel', isMac: true },
  { platform: 'Windows/Linux', navigatorPlatform: 'Linux x86_64', isMac: false },
] as const) {
  const nextColumn = shortcutChord(SHORTCUT_DEFAULTS['panel.focus-next-column'], isMac).event;
  const previousColumn = shortcutChord(
    SHORTCUT_DEFAULTS['panel.focus-previous-column'],
    isMac,
  ).event;

  test(`focuses adjacent columns from editable panel targets on ${platform}`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((value) => {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value });
    }, navigatorPlatform);
    const component = await mount(PanelModWShortcutHarness, { props: { isMac } });
    const state = component.getByTestId('mod-w-state');
    const targets = ['shortcut-input', 'shortcut-editor', 'shortcut-terminal'];
    const chords = [
      { chord: nextColumn, panelId: 'p3' },
      { chord: previousColumn, panelId: 'p2' },
      { chord: nextColumn, panelId: 'p3' },
      { chord: previousColumn, panelId: 'p2' },
    ];

    for (const targetId of targets) {
      for (const { chord, panelId } of chords) {
        const result = await dispatchChord(component.getByTestId(targetId), chord);
        expect(result).toEqual({ active: true, defaultPrevented: true });
        await expect(state).toHaveAttribute('data-focused-panel', panelId);
      }
    }

    await component.locator('[data-panel-id="p1"]').click({ position: { x: 20, y: 80 } });
    const unavailable = await dispatchChord(
      component.getByTestId('shortcut-terminal'),
      previousColumn,
    );
    expect(unavailable).toEqual({ active: true, defaultPrevented: false });
    await expect(state).toHaveAttribute('data-focused-panel', 'p1');
  });

  test(`only the full column-focus chord moves focus from editable targets on ${platform}`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((value) => {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value });
    }, navigatorPlatform);
    const component = await mount(PanelModWShortcutHarness, { props: { isMac } });
    const state = component.getByTestId('mod-w-state');
    await expect(state).toHaveAttribute('data-focused-panel', 'p2');

    // The workspace-switching chords (column focus before #4205) must not move column focus.
    const otherChords = (['global.next-space-alt', 'global.previous-space-alt'] as const).map(
      (id) => shortcutChord(SHORTCUT_DEFAULTS[id], isMac).event,
    );
    // The chord minus one modifier (e.g. Mod+Arrow, Alt+Arrow) is a caret move in editable
    // content; leave it alone.
    const partialChords = [nextColumn, previousColumn].flatMap((chord) => [
      ...(chord.altKey ? [{ ...chord, altKey: false }] : []),
      ...(chord.metaKey || chord.ctrlKey ? [{ ...chord, metaKey: false, ctrlKey: false }] : []),
    ]);
    for (const targetId of ['shortcut-input', 'shortcut-editor', 'shortcut-terminal']) {
      for (const chord of otherChords) {
        await dispatchChord(component.getByTestId(targetId), chord);
        await expect(state).toHaveAttribute('data-focused-panel', 'p2');
      }
      for (const chord of partialChords) {
        const result = await dispatchChord(component.getByTestId(targetId), chord);
        expect(result).toEqual({ active: true, defaultPrevented: false });
        await expect(state).toHaveAttribute('data-focused-panel', 'p2');
      }
    }
  });
}
