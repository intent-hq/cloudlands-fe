import { expect, test } from '../../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import PanelModWShortcutHarness from './mocks/PanelModWShortcutHarness.svelte';

type Chord = { key: string; altKey?: boolean; shiftKey?: boolean };

// Focus Next/Previous Column is Mod+Alt+Right/Left (moved from Mod+Shift+] / [ in #4205).
const nextColumn: Chord = { key: 'ArrowRight', altKey: true };
const previousColumn: Chord = { key: 'ArrowLeft', altKey: true };

async function dispatchChord(target: Locator, chord: Chord, modifier: 'Meta' | 'Control' | null) {
  return target.evaluate(
    (element, { chord, modifier }) => {
      (element as HTMLElement).focus();
      const event = new KeyboardEvent('keydown', {
        key: chord.key,
        altKey: chord.altKey ?? false,
        shiftKey: chord.shiftKey ?? false,
        metaKey: modifier === 'Meta',
        ctrlKey: modifier === 'Control',
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return {
        active: document.activeElement === element,
        defaultPrevented: event.defaultPrevented,
      };
    },
    { chord, modifier },
  );
}

for (const { platform, navigatorPlatform, isMac, modifier } of [
  { platform: 'macOS', navigatorPlatform: 'MacIntel', isMac: true, modifier: 'Meta' },
  {
    platform: 'Windows/Linux',
    navigatorPlatform: 'Linux x86_64',
    isMac: false,
    modifier: 'Control',
  },
] as const) {
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
        const result = await dispatchChord(component.getByTestId(targetId), chord, modifier);
        expect(result).toEqual({ active: true, defaultPrevented: true });
        await expect(state).toHaveAttribute('data-focused-panel', panelId);
      }
    }

    await component.locator('[data-panel-id="p1"]').click({ position: { x: 20, y: 80 } });
    const unavailable = await dispatchChord(
      component.getByTestId('shortcut-terminal'),
      previousColumn,
      modifier,
    );
    expect(unavailable).toEqual({ active: true, defaultPrevented: false });
    await expect(state).toHaveAttribute('data-focused-panel', 'p1');
  });

  test(`only Mod+Alt+Arrow moves column focus from editable targets on ${platform}`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((value) => {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value });
    }, navigatorPlatform);
    const component = await mount(PanelModWShortcutHarness, { props: { isMac } });
    const state = component.getByTestId('mod-w-state');
    await expect(state).toHaveAttribute('data-focused-panel', 'p2');

    // Former column chords (now workspace switching) must not move column focus.
    const formerChords: Chord[] = [']', '}', '[', '{'].map((key) => ({ key, shiftKey: true }));
    for (const targetId of ['shortcut-input', 'shortcut-editor', 'shortcut-terminal']) {
      for (const chord of formerChords) {
        await dispatchChord(component.getByTestId(targetId), chord, modifier);
        await expect(state).toHaveAttribute('data-focused-panel', 'p2');
      }
    }

    // Mod+Arrow and Alt+Arrow alone are caret moves in editable content; leave them alone.
    for (const targetId of ['shortcut-input', 'shortcut-editor', 'shortcut-terminal']) {
      for (const key of ['ArrowRight', 'ArrowLeft']) {
        const modOnly = await dispatchChord(component.getByTestId(targetId), { key }, modifier);
        expect(modOnly).toEqual({ active: true, defaultPrevented: false });
        const altOnly = await dispatchChord(
          component.getByTestId(targetId),
          { key, altKey: true },
          null,
        );
        expect(altOnly).toEqual({ active: true, defaultPrevented: false });
        await expect(state).toHaveAttribute('data-focused-panel', 'p2');
      }
    }
  });
}
