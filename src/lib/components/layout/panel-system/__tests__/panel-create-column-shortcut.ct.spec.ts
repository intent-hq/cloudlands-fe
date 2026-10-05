import { expect, test } from '../../../../../test/ct-test';
import PanelModWShortcutHarness from './mocks/PanelModWShortcutHarness.svelte';

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach('column-shortcut-final-state', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const { platform, navigatorPlatform, isMac, modifier, otherModifier } of [
  {
    platform: 'macOS',
    navigatorPlatform: 'MacIntel',
    isMac: true,
    modifier: 'Meta',
    otherModifier: 'Control',
  },
  {
    platform: 'Windows/Linux',
    navigatorPlatform: 'Linux x86_64',
    isMac: false,
    modifier: 'Control',
    otherModifier: 'Meta',
  },
] as const) {
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

      for (const chord of [
        `${otherModifier}+Backslash`,
        `${modifier}+Alt+Backslash`,
        `${modifier}+Shift+Backslash`,
        'Meta+Control+Backslash',
      ]) {
        await page.keyboard.press(chord);
        await expect(state).toHaveAttribute('data-column-count', '1');
      }

      await page.keyboard.press(`${modifier}+Backslash`);
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
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' });
  });
  const component = await mount(PanelModWShortcutHarness, {
    props: { panelCount: 1, isMac: true, createColumnShortcut: 'mod+shift+g' },
  });
  const state = component.getByTestId('mod-w-state');
  const editor = component.getByTestId('shortcut-editor');
  await editor.fill('Keep this prompt');
  await editor.focus();
  await page.keyboard.press('Meta+Backslash');
  await expect(state).toHaveAttribute('data-column-count', '1');
  await page.keyboard.press('Meta+Shift+g');
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
    await page.keyboard.press('Control+Backslash');
    await expect(state).toHaveAttribute('data-column-count', String(count));
  }
  await input.focus();
  const native = await input.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '\\',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
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
    await page.keyboard.press('Control+Backslash');
    await expect(state).toHaveAttribute('data-column-count', String(count));
    await expect(state).toHaveAttribute('data-terminal-input', JSON.stringify(input));
    handledInput.push(JSON.parse((await state.getAttribute('data-terminal-input'))!));
  }

  await terminal.focus();
  await page.keyboard.press('Control+Backslash');
  await expect(state).toHaveAttribute('data-column-count', '4');
  await expect(state).toHaveAttribute('data-terminal-input', JSON.stringify(`${input}\u001c`));
  await testInfo.attach('real-xterm-column-limit.json', {
    body: JSON.stringify(
      {
        handledInput,
        inputAtLimit: JSON.parse((await state.getAttribute('data-terminal-input'))!),
        columns: await state.getAttribute('data-column-count'),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('keeps a remapped column shortcut out of real xterm', async ({ mount, page }, testInfo) => {
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
  });
  const component = await mount(PanelModWShortcutHarness, {
    props: { panelCount: 1, includeTerminal: true, createColumnShortcut: 'mod+g' },
  });
  const state = component.getByTestId('mod-w-state');
  const terminal = component.getByTestId('real-terminal').locator('.xterm-helper-textarea');
  await terminal.focus();
  await page.keyboard.type('safe');
  await page.keyboard.press('Control+Backslash');
  await expect(state).toHaveAttribute('data-column-count', '1');
  await expect(state).toHaveAttribute('data-terminal-input', JSON.stringify('safe\u001c'));

  await page.keyboard.press('Control+g');
  await expect(state).toHaveAttribute('data-column-count', '2');
  await expect(state).toHaveAttribute('data-terminal-input', JSON.stringify('safe\u001c'));
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
