import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockCaptureCaptionHarness.svelte';

for (const scale of [1, 2]) {
  test.describe(`caption comparison at ${scale}x`, () => {
    test.use({ deviceScaleFactor: scale, viewport: { width: 800, height: 560 } });
    test('pointer and keyboard keep mode selection and draft intact', async ({
      mount,
      page,
    }, info) => {
      const harness = await mount(Harness);
      const draft = page.getByRole('textbox', { name: 'Synthetic draft' });
      const trigger = page.getByRole('button', { name: 'Open screenshot options' });
      const reference = page.getByTestId('reference-tooltip');
      await draft.fill('Keep this selected draft');
      await draft.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(2, 10));
      await trigger.hover();
      const menu = page.getByRole('menu', { name: 'Screenshot options' });
      await expect(menu).toBeVisible();
      await expect(draft).toBeFocused();
      await reference.hover();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      await expect(harness).toHaveAttribute('data-selections', '[]');
      expect(
        await draft.evaluate((field: HTMLTextAreaElement) => [
          field.selectionStart,
          field.selectionEnd,
        ]),
      ).toEqual([2, 10]);
      await page.screenshot({ path: info.outputPath(`pointer-${scale}x.png`) });
      await trigger.focus();
      await trigger.press('ArrowUp');
      await expect(
        menu.getByRole('menuitemradio', { name: 'Full screen', exact: true }),
      ).toBeFocused();
      await reference.hover();
      await expect(tooltip).toBeVisible();
      await page.screenshot({ path: info.outputPath(`keyboard-${scale}x.png`) });
      const receipt = await page.evaluate(() => {
        const heading = document.querySelector('[data-slot="menu-label"]')!;
        const tip = document.querySelector('[role="tooltip"]')!;
        const caption = tip.querySelector('.type-caption') ?? tip;
        const read = (element: Element) => {
          const style = getComputedStyle(element);
          return Object.fromEntries(
            [
              'fontSize',
              'fontWeight',
              'lineHeight',
              'letterSpacing',
              'textAlign',
              'paddingLeft',
              'paddingRight',
              'paddingTop',
              'paddingBottom',
              'backgroundColor',
              'color',
            ].map((key) => [key, style[key as keyof CSSStyleDeclaration]]),
          );
        };
        return {
          devicePixelRatio,
          menuCaption: read(heading),
          tooltipCaption: read(caption),
          menuSurface: read(heading.closest('[role="menu"]')!),
          tooltipSurface: read(tip),
        };
      });
      expect(receipt.devicePixelRatio).toBe(scale);
      await writeFile(info.outputPath('receipt.json'), JSON.stringify(receipt, null, 2));
      await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitemradio', { name: 'Window', exact: true })).toBeFocused();
      await expect(
        menu.getByRole('menuitemradio', { name: 'Full screen', exact: true }),
      ).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(draft).toHaveValue('Keep this selected draft');
      await expect(harness).toHaveAttribute('data-selections', '[]');
    });
  });
}
