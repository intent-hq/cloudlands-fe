import { expect, test } from '../../../../test/ct-test';
import Preview from '../file-tree-disclosure.preview.svelte';
import { probeFileTreeGlyph } from './file-tree-glyph-probe';

for (const [width, theme] of [
  [240, 'light'],
  [360, 'dark'],
] as const) {
  test(`file disclosure, search ink and keyboard actions at ${width}px in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const component = await mount(Preview);
    await page.evaluate(() => document.fonts.ready);
    const tree = component.getByRole('tree');
    const src = component.locator('[data-file-path="/project/src"]');
    const srcButton = src.locator('[data-slot="list-item"]');
    const srcGlyph = src.locator('[data-file-tree-disclosure]');
    const nested = component.locator('[data-file-path="/project/src/components"]');
    await expect(srcButton).toHaveAttribute('aria-expanded', 'false');
    await expect(nested).toHaveCount(0);
    const search = component.locator('[data-sidebar-action="search"]');
    const beforeRow = (await src.boundingBox())!;
    const beforeTarget = (await srcButton.boundingBox())!;
    const searchTarget = (await search.boundingBox())!;
    const searchGlyph = await search.locator('svg').evaluate(probeFileTreeGlyph);
    const collapsed = await srcGlyph.evaluate(probeFileTreeGlyph);
    expect(collapsed.right).toBe(true);
    expect(collapsed.left).toBe(false);
    expect(collapsed.inkHeight).toBeGreaterThan(collapsed.inkWidth);
    expect(collapsed.width).toBe(12);
    expect(collapsed.height).toBe(12);
    expect(collapsed.centerX).toBeCloseTo(searchGlyph.centerX, 1);
    expect(collapsed.centerY).toBeCloseTo(beforeRow.y + beforeRow.height / 2, 1);
    expect(searchTarget.width).toBe(28);
    expect(searchTarget.height).toBe(28);
    expect(searchGlyph.searchInk).toBeCloseTo(0.875, 1);
    const adjacentInk = await component
      .getByRole('button', { name: 'New file' })
      .evaluate((el) => getComputedStyle(el).color);
    expect(searchGlyph.color).toBe(adjacentInk);
    expect(collapsed.color).toBe(adjacentInk);

    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(srcButton).toHaveAttribute('aria-expanded', 'true');
    await expect(nested).toBeVisible();
    const expanded = await srcGlyph.evaluate(probeFileTreeGlyph);
    const nestedGlyph = await nested
      .locator('[data-file-tree-disclosure]')
      .evaluate(probeFileTreeGlyph);
    expect(expanded.down).toBe(true);
    expect(expanded.up).toBe(false);
    expect(expanded.inkWidth).toBeGreaterThan(expanded.inkHeight);
    expect(expanded.centerX).toBe(collapsed.centerX);
    expect(expanded.centerY).toBe(collapsed.centerY);
    expect(expanded.width).toBe(collapsed.width);
    expect(expanded.height).toBe(collapsed.height);
    expect(nestedGlyph.centerX - expanded.centerX).toBe(16);
    expect(await srcButton.boundingBox()).toEqual(beforeTarget);
    await page.keyboard.press('ArrowLeft');
    await expect(srcButton).toHaveAttribute('aria-expanded', 'false');
    await expect(nested).toHaveCount(0);
    expect(await srcGlyph.evaluate(probeFileTreeGlyph)).toEqual(collapsed);
    expect(await srcButton.boundingBox()).toEqual(beforeTarget);
    await srcButton.click();
    await expect(srcButton).toHaveAttribute('aria-expanded', 'true');
    await expect(nested).toBeVisible();
    expect(await srcGlyph.evaluate(probeFileTreeGlyph)).toEqual(expanded);
    await nested.locator('[data-slot="list-item"]').click();
    const file = component.locator('[data-file-path="/project/src/components/Button.svelte"]');
    await file.locator('[data-slot="list-item"]').click();
    await expect(component.locator('[data-file-tree-selected]')).toHaveText(
      '/project/src/components/Button.svelte',
    );
    await expect(file.getByText('Button.svelte', { exact: true })).toHaveCSS('font-weight', '400');
    await expect(src.getByText('src', { exact: true })).toHaveCSS('font-weight', '400');
    await tree.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(file).toHaveCount(0);

    await search.click();
    const input = component.getByRole('searchbox');
    await expect(input).toBeFocused();
    const inputGlyph = await component
      .locator('[data-sidebar-search-expanded] > svg')
      .evaluate(probeFileTreeGlyph);
    expect(inputGlyph.centerX).toBeCloseTo(searchGlyph.centerX, 1);
    expect(inputGlyph.color).toBe(searchGlyph.color);
    await input.fill('README');
    await expect(component.locator('[data-file-path]')).toHaveCount(1);
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(component.locator('[data-file-tree-selected]')).toHaveText('/project/README.md');
    await component.locator('[data-sidebar-search-clear="files"]').click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(search).toBeFocused();
    expect(await search.boundingBox()).toEqual(searchTarget);
  });
}
