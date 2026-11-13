import { expect, test, installPausedClock } from '../../../test/ct-test';
import { SHORTCUT_DEFAULTS } from '$lib/utils/shortcut-bindings';
import { shortcutChord } from '../../../test/shortcut-chords';
import WorkspaceNumberShortcutHarness from './WorkspaceNumberShortcutHarness.svelte';

for (const isMac of [true, false]) {
  const platform = isMac ? 'macOS' : 'Windows/Linux';
  test.describe(platform, () => {
    test.beforeEach(async ({ page }) => {
      await page.evaluate((mac) => {
        Object.defineProperty(navigator, 'platform', {
          configurable: true,
          value: mac ? 'MacIntel' : 'Linux x86_64',
        });
      }, isMac);
    });

    test(`routes device and workspace numbers from editable content on ${platform}`, async ({
      mount,
      page,
    }, testInfo) => {
      const component = await mount(WorkspaceNumberShortcutHarness, { props: { isMac } });
      const result = component.getByTestId('result');
      const deviceChord = (digit: number) =>
        shortcutChord(
          SHORTCUT_DEFAULTS['navigation.go-to-device'].replace('1-9', String(digit)),
          isMac,
        );
      const tabChord = (digit: number) =>
        shortcutChord(
          SHORTCUT_DEFAULTS['navigation.go-to-tab'].replace('1-9', String(digit)),
          isMac,
        );
      const draft = component.getByRole('textbox', { name: 'Draft' });
      await draft.press(deviceChord(2).press);
      await expect(result).toHaveAttribute('data-requests', '["build"]');
      await expect(result).toHaveAttribute('data-path', '/workspace/beta');
      await expect(draft).toHaveValue('Keep this draft');

      await draft.press(tabChord(2).press);
      await expect(result).toHaveAttribute('data-path', '/workspace/alpha');
      await draft.press(tabChord(1).press);
      await expect(result).toHaveAttribute('data-path', '/');
      await draft.press(tabChord(9).press);
      await expect(result).toHaveAttribute('data-path', '/workspace/gamma');

      await component.getByRole('textbox', { name: 'Editor' }).press(deviceChord(9).press);
      await expect(result).toHaveAttribute('data-requests', '["build","guest"]');
      await draft.press(deviceChord(8).press);
      await expect(result).toHaveAttribute('data-requests', '["build","guest"]');
      await expect(result).toHaveAttribute('data-path', '/workspace/gamma');

      await component.getByRole('button', { name: 'Reorder devices' }).click();
      await draft.press(deviceChord(2).press);
      await expect(result).toHaveAttribute('data-requests', '["build","guest","second"]');

      const terminal = component.getByTestId('terminal').locator('textarea');
      await terminal.press(tabChord(3).press);
      await expect(result).toHaveAttribute('data-path', '/workspace/beta');
      await terminal.press(deviceChord(1).press);
      await expect(result).toHaveAttribute('data-requests', '["build","guest","second","local"]');
      await expect(result).toHaveAttribute('data-terminal-input', '""');

      await component.getByRole('button', { name: 'Toggle rail' }).click();
      await draft.press(deviceChord(2).press);
      await expect(result).toHaveAttribute('data-path', '/workspace/alpha');
      await expect(result).toHaveAttribute('data-requests', '["build","guest","second","local"]');
      await draft.press(tabChord(9).press);
      await expect(result).toHaveAttribute('data-path', '/workspace/gamma');
      await component.getByRole('button', { name: 'Toggle rail' }).click();
      await draft.press(deviceChord(2).press);
      await expect(result).toHaveAttribute(
        'data-requests',
        '["build","guest","second","local","second"]',
      );
      await component.getByRole('button', { name: 'Clear devices' }).click();
      await expect(component.getByTestId('machine-rail-item')).toHaveCount(0);
      await draft.press(deviceChord(1).press);
      await expect(result).toHaveAttribute(
        'data-requests',
        '["build","guest","second","local","second"]',
      );
      await expect(result).toHaveAttribute('data-path', '/workspace/gamma');
      await testInfo.attach('shortcut-result', {
        body: JSON.stringify(
          await result.evaluate((el) => ({ ...(el as HTMLElement).dataset })),
          null,
          2,
        ),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath('shortcuts.png') });
    });

    test(`honors saved workspace and other action bindings on ${platform}`, async ({ mount }) => {
      const component = await mount(WorkspaceNumberShortcutHarness, {
        props: { isMac, tabBinding: 'mod+1-9', settingsBinding: 'mod+alt+4' },
      });
      const result = component.getByTestId('result');
      const draft = component.getByRole('textbox', { name: 'Draft' });
      await draft.press(shortcutChord('mod+2', isMac).press);
      await expect(result).toHaveAttribute('data-path', '/workspace/alpha');
      await expect(result).toHaveAttribute('data-requests', '[]');
      await draft.press(shortcutChord('mod+alt+4', isMac).press);
      await expect(result).toHaveAttribute('data-settings', '1');
      await expect(result).toHaveAttribute('data-path', '/workspace/alpha');
    });
    test(`follows an unconfirmed rail reorder on ${platform}`, async ({ mount, page }) => {
      const component = await installPausedClock(page, () =>
        mount(WorkspaceNumberShortcutHarness, { props: { isMac } }),
      );
      await component.getByRole('button', { name: 'Reorder devices' }).click();
      await page.clock.runFor(32);
      await expect(component.getByTestId('machine-rail-item')).toHaveCount(4);
      await component
        .locator('[data-testid="machine-rail-item"][data-machine-id="second"]')
        .press('Alt+ArrowDown');
      await component
        .getByRole('textbox', { name: 'Draft' })
        .press(
          shortcutChord(SHORTCUT_DEFAULTS['navigation.go-to-device'].replace('1-9', '2'), isMac)
            .press,
        );
      await expect(component.getByTestId('result')).toHaveAttribute('data-requests', '["build"]');
    });
    if (!isMac)
      test('keeps unbound terminal control numbers with the rail hidden', async ({ mount }) => {
        const component = await mount(WorkspaceNumberShortcutHarness, {
          props: { isMac, tabBinding: 'alt+1-9' },
        });
        await component.getByRole('button', { name: 'Toggle rail' }).click();
        await component
          .getByTestId('terminal')
          .locator('textarea')
          .press(shortcutChord('mod+3', false).press);
        await expect(component.getByTestId('result')).toHaveAttribute(
          'data-terminal-input',
          JSON.stringify('\u001b'),
        );
        await expect(component.getByTestId('result')).toHaveAttribute(
          'data-path',
          '/workspace/beta',
        );
      });
    test(`yields default numbers to a customized action on ${platform}`, async ({ mount }) => {
      const component = await mount(WorkspaceNumberShortcutHarness, {
        props: { isMac, settingsBinding: 'mod+2' },
      });
      const result = component.getByTestId('result');
      const draft = component.getByRole('textbox', { name: 'Draft' });
      await draft.press(shortcutChord('mod+2', isMac).press);
      await expect(result).toHaveAttribute('data-settings', '1');
      await expect(result).toHaveAttribute('data-requests', '[]');
      await component.getByRole('button', { name: 'Toggle rail' }).click();
      await draft.press(shortcutChord('mod+2', isMac).press);
      await expect(result).toHaveAttribute('data-settings', '2');
      await expect(result).toHaveAttribute('data-path', '/workspace/beta');
    });
  });
}
