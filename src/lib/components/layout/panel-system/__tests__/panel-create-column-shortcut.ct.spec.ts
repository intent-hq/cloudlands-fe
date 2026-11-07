import { expect, test } from '../../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import { SHORTCUT_DEFAULTS } from '$lib/utils/shortcut-bindings';
import { shortcutChord } from '../../../../../test/shortcut-chords';
import PanelModWShortcutHarness from './mocks/PanelModWShortcutHarness.svelte';

const createColumn = (mac: boolean) =>
  shortcutChord(SHORTCUT_DEFAULTS['panel.create-column-right'], mac);

/**
 * Waits until a chord the layout did not handle reaches xterm after `input` as a control
 * sequence (not as typed text), and returns the whole terminal input.
 */
async function terminalInputAfter(state: Locator, input: string): Promise<string> {
  let received = '';
  await expect
    .poll(async () => {
      received = JSON.parse((await state.getAttribute('data-terminal-input'))!);
      return (
        received.length > input.length &&
        received.startsWith(input) &&
        received.charCodeAt(input.length) < 0x20
      );
    })
    .toBe(true);
  return received;
}

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach('column-shortcut-final-state', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const { platform, navigatorPlatform, isMac } of [
  { platform: 'macOS', navigatorPlatform: 'MacIntel', isMac: true },
  { platform: 'Windows/Linux', navigatorPlatform: 'Linux x86_64', isMac: false },
] as const) {
  const chord = createColumn(isMac).press;
  const held = chord.split('+');
  // The other platform's Mod, and the chord plus any modifier it does not use.
  const nearMisses = [
    createColumn(!isMac).press,
    ...['Alt', 'Shift', isMac ? 'Control' : 'Meta']
      .filter((name) => !held.includes(name))
      .map((name) => `${name}+${chord}`),
  ];
  for (const targetId of [
    'shortcut-input',
    'shortcut-textarea',
    'shortcut-editor',
    'shortcut-terminal',
  ]) {
    test(`creates one column from ${targetId} on ${platform} without changing the draft`, async ({
      mount,
      page,
    }) => {
      await page.evaluate((value) => {
        Object.defineProperty(window.navigator, 'platform', { configurable: true, value });
      }, navigatorPlatform);
      const component = await mount(PanelModWShortcutHarness, { props: { panelCount: 1, isMac } });
      const state = component.getByTestId('mod-w-state');
      const target = component.getByTestId(targetId);
      await target.fill('Keep this draft');
      await target.focus();
      await page.keyboard.press('End');
      await page.keyboard.press('Backslash');
      const draft = await target.evaluate((element) =>
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value
          : element.textContent,
      );
      expect(draft).toBe('Keep this draft\\');

      for (const nearMiss of nearMisses) {
        await page.keyboard.press(nearMiss);
        await expect(state).toHaveAttribute('data-column-count', '1');
      }

      await page.keyboard.press(chord);
      await expect(state).toHaveAttribute('data-column-count', '2');
      await expect(component.locator('[data-empty-panel-shell]')).toHaveCount(1);
      await expect(component.locator('[data-panel-content-header]')).toHaveCount(1);
      expect(
        await target.evaluate((element) =>
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : element.textContent,
        ),
      ).toBe(draft);
    });
  }
}

test('honors a custom create-column binding while a prompt editor is focused', async ({
  mount,
  page,
}) => {
  const custom = 'mod+shift+g';
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' });
  });
  const component = await mount(PanelModWShortcutHarness, {
    props: { panelCount: 1, isMac: true, createColumnShortcut: custom },
  });
  const state = component.getByTestId('mod-w-state');
  const editor = component.getByTestId('shortcut-editor');
  await editor.fill('Keep this prompt');
  await editor.focus();
  await page.keyboard.press(createColumn(true).press);
  await expect(state).toHaveAttribute('data-column-count', '1');
  await page.keyboard.press(shortcutChord(custom, true).press);
  await expect(state).toHaveAttribute('data-column-count', '2');
  await expect(editor).toHaveText('Keep this prompt');
});

test('keeps the four-column limit while an input is focused', async ({ mount, page }) => {
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
  });
  const component = await mount(PanelModWShortcutHarness, { props: { panelCount: 1 } });
  const state = component.getByTestId('mod-w-state');
  const input = component.getByTestId('shortcut-input');
  await input.fill('Keep this draft');
  for (const count of [2, 3, 4]) {
    await input.focus();
    await page.keyboard.press(createColumn(false).press);
    await expect(state).toHaveAttribute('data-column-count', String(count));
  }
  await input.focus();
  const native = await input.evaluate(
    (element, chord) =>
      element.dispatchEvent(
        new KeyboardEvent('keydown', { ...chord, bubbles: true, cancelable: true }),
      ),
    createColumn(false).event,
  );
  expect(native).toBe(true);
  await expect(state).toHaveAttribute('data-column-count', '4');
  await expect(input).toHaveValue('Keep this draft');
});

test('keeps handled column shortcuts out of real xterm and preserves input at the column limit', async ({
  mount,
  page,
}, testInfo) => {
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
  });
  const component = await mount(PanelModWShortcutHarness, {
    props: { panelCount: 1, includeTerminal: true },
  });
  const state = component.getByTestId('mod-w-state');
  const terminal = component.getByTestId('real-terminal').locator('.xterm-helper-textarea');
  await terminal.focus();
  await page.keyboard.type('safe');
  await page.keyboard.press('Backslash');
  const input = 'safe\\';
  await expect(state).toHaveAttribute('data-terminal-input', JSON.stringify(input));

  const handledInput: string[] = [];
  for (const count of [2, 3, 4]) {
    await terminal.focus();
    await page.keyboard.press(createColumn(false).press);
    await expect(state).toHaveAttribute('data-column-count', String(count));
    await expect(state).toHaveAttribute('data-terminal-input', JSON.stringify(input));
    handledInput.push(JSON.parse((await state.getAttribute('data-terminal-input'))!));
  }

  await terminal.focus();
  await page.keyboard.press(createColumn(false).press);
  await expect(state).toHaveAttribute('data-column-count', '4');
  const inputAtLimit = await terminalInputAfter(state, input);
  await testInfo.attach('real-xterm-column-limit.json', {
    body: JSON.stringify(
      {
        handledInput,
        inputAtLimit,
        columns: await state.getAttribute('data-column-count'),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('keeps a remapped column shortcut out of real xterm', async ({ mount, page }, testInfo) => {
  const custom = 'mod+g';
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
  });
  const component = await mount(PanelModWShortcutHarness, {
    props: { panelCount: 1, includeTerminal: true, createColumnShortcut: custom },
  });
  const state = component.getByTestId('mod-w-state');
  const terminal = component.getByTestId('real-terminal').locator('.xterm-helper-textarea');
  await terminal.focus();
  await page.keyboard.type('safe');
  await page.keyboard.press(createColumn(false).press);
  await expect(state).toHaveAttribute('data-column-count', '1');
  const passedThrough = await terminalInputAfter(state, 'safe');

  await page.keyboard.press(shortcutChord(custom, false).press);
  await expect(state).toHaveAttribute('data-column-count', '2');
  await expect(state).toHaveAttribute('data-terminal-input', JSON.stringify(passedThrough));
  await testInfo.attach('real-xterm-remapped-shortcut.json', {
    body: JSON.stringify(
      {
        input: JSON.parse((await state.getAttribute('data-terminal-input'))!),
        columns: await state.getAttribute('data-column-count'),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
