import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../test/ct-test';
import CatalogDiffThemeHost from '../../test/fixtures/CatalogDiffThemeHost.svelte';

async function textContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const layers: string[] = [];
    for (let node: Element | null = element; node;) {
      layers.unshift(getComputedStyle(node).backgroundColor);
      const root = node.getRootNode();
      node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    const paint = (colors: string[]) => {
      context.clearRect(0, 0, 1, 1);
      for (const color of colors) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgba: number[]) => {
      const linear = rgba.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const background = paint(layers);
    if (background[3] !== 255) throw new Error('Text has no opaque background');
    const foreground = paint([...layers, getComputedStyle(element).color]);
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  });
}

test('catalog light and dark round trips keep Pierre headings and code readable', async ({
  mount,
  page,
}, testInfo) => {
  await page.evaluate(() => window.history.replaceState(null, '', '?theme=light'));
  const component = await mount(CatalogDiffThemeHost);
  const diff = component.getByTestId('catalog-diff');
  const line = diff.locator('[data-line]').filter({ hasText: 'last line' }).first();
  const heading = diff.locator('[data-content] [data-separator-content]').first();
  await expect(line).toBeVisible();
  await expect(heading).toBeVisible();
  await component.getByRole('button', { name: 'Customize preview' }).click();

  for (const [index, theme] of ['light', 'dark', 'light'].entries()) {
    if (index > 0) {
      await component.getByRole('radio', { name: theme, exact: false }).click();
    }
    await expect(line).toBeVisible();
    await testInfo.attach(`${index}-${theme}`, {
      body: await diff.screenshot(),
      contentType: 'image/png',
    });
    // Pierre uses its own color-scheme inside a shadow root; the surrounding page's
    // class alone cannot establish that production consumers received the theme.
    await expect
      .poll(() => line.evaluate((element) => getComputedStyle(element).colorScheme))
      .toBe(theme);
    await expect.poll(() => textContrast(heading)).toBeGreaterThanOrEqual(4.5);
    await expect.poll(() => textContrast(line)).toBeGreaterThanOrEqual(4.5);
  }
});
