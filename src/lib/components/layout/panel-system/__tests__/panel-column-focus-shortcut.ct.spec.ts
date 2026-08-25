import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import PanelModWShortcutHarness from './mocks/PanelModWShortcutHarness.svelte';

async function dispatchColumnFocus(
  target: Locator,
  key: '[' | ']' | '{' | '}',
  modifier: 'Meta' | 'Control',
) {
  return target.evaluate(
    (element, { key, modifier }) => {
      (element as HTMLElement).focus();
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey: true,
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
    { key, modifier },
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
      { key: ']' as const, panelId: 'p3' },
      { key: '{' as const, panelId: 'p2' },
      { key: '}' as const, panelId: 'p3' },
      { key: '[' as const, panelId: 'p2' },
    ];

    for (const targetId of targets) {
      for (const { key, panelId } of chords) {
        const result = await dispatchColumnFocus(component.getByTestId(targetId), key, modifier);
        expect(result).toEqual({ active: true, defaultPrevented: true });
        await expect(state).toHaveAttribute('data-focused-panel', panelId);
      }
    }

    await component.locator('[data-panel-id="p1"]').click({ position: { x: 20, y: 80 } });
    const unavailable = await dispatchColumnFocus(
      component.getByTestId('shortcut-terminal'),
      '[',
      modifier,
    );
    expect(unavailable).toEqual({ active: true, defaultPrevented: false });
    await expect(state).toHaveAttribute('data-focused-panel', 'p1');
  });
}
