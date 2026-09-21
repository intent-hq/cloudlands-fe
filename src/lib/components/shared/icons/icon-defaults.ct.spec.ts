import { expect, test } from '../../../../test/ct-test';
import Preview from './icon-defaults.preview.svelte';

test('workspace actions use unscaled regular glyphs and preserve menu targets', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        versions: { electron: 'icon-preview-only' },
        invoke: async () => {
          throw new Error('Native actions are disabled in icon preview');
        },
      },
    });
  });
  await mount(Preview);
  const trigger = page.getByRole('button', { name: 'Workspace actions', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('[data-slot="menu-content"]');
  await expect(menu.getByRole('button', { name: 'Open in Finder' })).toBeVisible();
  const glyphs = await menu.locator('svg[data-icon]').evaluateAll((icons) =>
    icons.map((svg) => {
      const rect = svg.getBoundingClientRect();
      const target = svg.closest('button')!.getBoundingClientRect();
      return {
        weight: svg.getAttribute('data-weight'),
        width: rect.width,
        height: rect.height,
        transform: getComputedStyle(svg).transform,
        targetHeight: target.height,
      };
    }),
  );
  expect(glyphs).toHaveLength(5);
  for (const glyph of glyphs) {
    expect(glyph).toEqual({
      weight: 'regular',
      width: 16,
      height: 16,
      transform: 'none',
      targetHeight: 28,
    });
  }
  const markerWeights = await menu
    .locator('span.font-mono')
    .evaluateAll((markers) => markers.map((marker) => getComputedStyle(marker).fontWeight));
  expect(markerWeights).toEqual(['400', '400']);
  await menu.getByRole('button', { name: 'Transfer to host' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('icon-defaults-preview')).toHaveAttribute(
    'data-last-action',
    'transfer',
  );
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
