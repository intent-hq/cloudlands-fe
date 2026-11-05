import { expect, test } from '../../../../test/ct-test';
import Picker from './setup-script-recency.test-harness.svelte';

for (const width of [1100, 390]) {
  test(`recent scripts keep their own names and selection at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await mount(Picker);
    const trigger = page.getByRole('button', { name: 'Setup script', exact: true });
    await expect(trigger).toContainText('Copy config files only');
    await trigger.click();
    const popup = page.getByRole('dialog', { name: 'Setup script', exact: true });
    const search = popup.getByRole('combobox', { name: 'Setup script', exact: true });
    await expect(search).toBeFocused();
    const options = popup.getByRole('option');
    await expect
      .poll(async () => (await options.allTextContents()).slice(0, 3).map((text) => text.trim()))
      .toEqual(['Copy config files only', 'Node.js (pnpm)', 'Rust (cargo)']);
    const lastUsed = popup.getByRole('option', { name: 'Copy config files only', exact: true });
    await expect(lastUsed).toHaveCount(1);
    await expect(lastUsed).toHaveAttribute('aria-selected', 'true');
    await expect(popup.getByRole('option', { name: /^Last used/ })).toHaveCount(0);
    await expect(popup).toBeInViewport({ ratio: 1 });
    await testInfo.attach('recent-scripts', {
      body: await page.screenshot({ path: testInfo.outputPath('recent-scripts.png') }),
      contentType: 'image/png',
    });
    await search.fill('Rust');
    await expect(options).toHaveCount(1);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('Rust (cargo)');
    await trigger.click();
    await expect(search).toHaveValue('');
    await expect(popup.getByRole('option', { name: 'Rust (cargo)', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(lastUsed).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
