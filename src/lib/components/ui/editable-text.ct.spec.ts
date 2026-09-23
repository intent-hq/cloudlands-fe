import { test, expect } from '../../../test/ct-test';
import { expectUnpaintedEditControl } from '../../../../playwright/inline-edit-assertions';
import Preview from './editable-text.preview.svelte';

test.use({ viewport: { width: 560, height: 800 }, deviceScaleFactor: 2 });

for (const theme of ['light', 'dark'] as const) {
  for (const editor of ['EditableName', 'ContentHeader']) {
    test(`${editor} has a single editing surface in ${theme}`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      await mount(Preview, { props: { layout: 'normal', mode: 'display' } });
      const section = page.locator('section').filter({
        has: page.getByRole('heading', { name: editor, exact: true }),
      });
      const trigger = section.getByRole('button', {
        name: 'Preview implementation plan',
        exact: true,
      });
      await trigger.focus();
      await trigger.press('Enter');
      const input = section.getByRole('textbox');
      await expectUnpaintedEditControl(input);

      const boundary = input.locator('..').locator(':scope > span[aria-hidden="true"]');
      await expect(boundary).toHaveCSS('border-top-width', '1px');
      await expect(boundary).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      await expect(boundary).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

      await input.press('ArrowRight');
      await testInfo.attach('editing-surface', {
        body: await section.screenshot(),
        contentType: 'image/png',
      });

      await input.fill('An unsaved title');
      await input.press('Escape');
      await expect(input).toHaveCount(0);
      await expect(trigger).toBeVisible();
    });
  }
}
