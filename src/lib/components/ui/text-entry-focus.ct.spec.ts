import { expect, test } from '../../../test/ct-test';
import TextEntryFocus from './text-entry-focus.preview.svelte';

for (const theme of ['light', 'dark']) {
  test(`caret-only text entries retain editing and error states in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    await mount(TextEntryFocus);
    const fixture = page.getByTestId('text-entry-focus-fixture');
    const start = fixture.getByRole('button', { name: 'Start keyboard navigation' });
    await start.focus();
    await expect(start).toHaveCSS('outline-style', 'solid');
    for (const name of [
      'Workspace name',
      'Workspace notes',
      'Invalid name',
      'Invalid notes',
      'Read-only notes',
      'Settings notes',
      'Composite field',
    ]) {
      const input = fixture.getByLabel(name);
      const resting = await input.evaluate((e) => ({
        border: getComputedStyle(e).borderColor,
        background: getComputedStyle(e).backgroundColor,
        shadow: getComputedStyle(e).boxShadow,
      }));
      const bounds = await input.boundingBox();
      await page.keyboard.press('Tab');
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS('outline-style', 'none');
      await expect(input).toHaveCSS('box-shadow', resting.shadow);
      await expect(input).toHaveCSS('border-color', resting.border);
      await expect(input).toHaveCSS('background-color', resting.background);
      const color = await input.evaluate((e) => getComputedStyle(e).color);
      await expect(input).toHaveCSS('caret-color', color);
      expect(await input.boundingBox()).toEqual(bounds);
      if (name.startsWith('Invalid')) await expect(input).toHaveAttribute('aria-invalid', 'true');
      if (name === 'Read-only notes') {
        await input.press('x');
        await expect(input).toHaveValue('Managed notes');
      }
      if (name === 'Workspace name' || name === 'Workspace notes') {
        await input.fill('Edited');
        await expect(page.getByTestId('text-entry-values')).toContainText('Edited');
      }
    }
    await expect(fixture.getByLabel('Disabled name')).toBeDisabled();
    await page.keyboard.press('Tab');
    const file = fixture.getByLabel('Choose file');
    await expect(file).toBeFocused();
    await expect(file).toHaveCSS('outline-style', 'solid');
    await expect(file).toHaveCSS('outline-width', '1px');
  });
}
