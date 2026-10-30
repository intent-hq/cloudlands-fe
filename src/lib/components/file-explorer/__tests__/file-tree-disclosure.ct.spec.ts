import { expect, test } from '../../../../test/ct-test';
import Preview from '../file-tree-disclosure.preview.svelte';

test('file expansion and header search remain usable by keyboard in a narrow list', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 240, height: 600 });
  const component = await mount(Preview);
  const tree = component.getByRole('tree');
  const src = component.locator('[data-file-path="/project/src"]');
  const srcButton = src.locator('[data-slot="list-item"]');
  const nested = component.locator('[data-file-path="/project/src/components"]');
  await expect(srcButton).toHaveAttribute('aria-expanded', 'false');
  await expect(nested).toHaveCount(0);

  await tree.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(srcButton).toHaveAttribute('aria-expanded', 'true');
  await expect(nested).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(srcButton).toHaveAttribute('aria-expanded', 'false');
  await expect(nested).toHaveCount(0);
  await srcButton.click();
  await expect(srcButton).toHaveAttribute('aria-expanded', 'true');
  await nested.locator('[data-slot="list-item"]').click();
  const file = component.locator('[data-file-path="/project/src/components/Button.svelte"]');
  await file.locator('[data-slot="list-item"]').click();
  await expect(component.locator('[data-file-tree-selected]')).toHaveText(
    '/project/src/components/Button.svelte',
  );
  await tree.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(file).toHaveCount(0);

  const search = component.locator('[data-sidebar-action="search"]');
  await search.click();
  const input = component.getByRole('searchbox');
  await expect(input).toBeFocused();
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
});
