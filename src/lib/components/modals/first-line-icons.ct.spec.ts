import { expect, test } from '../../../test/ct-test';
import QuitPreview from './quit-confirmation.preview.svelte';

test('quit truncates long workspace names within the dialog', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mount(QuitPreview, { props: { scenario: 'long-names' } });
  const title = page.locator('[data-slot="list-row-title"]').first();
  await expect(title).toBeVisible();
  const geometry = await title.evaluate((element) => {
    const text = element.firstElementChild as HTMLElement;
    const dialog = element.closest('[role="alertdialog"]')!;
    return {
      clipped: text.scrollWidth > text.clientWidth,
      overflow: dialog.scrollWidth - dialog.clientWidth,
      singleLine: text.clientHeight <= parseFloat(getComputedStyle(text).lineHeight) + 1,
    };
  });
  expect(geometry.clipped).toBe(true);
  expect(geometry.singleLine).toBe(true);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
});

test('quit shows five workspaces until the remaining rows are requested', async ({
  mount,
  page,
}) => {
  await mount(QuitPreview, { props: { scenario: 'many-workspaces' } });
  await expect(page.getByRole('listitem')).toHaveCount(5);
  await page.getByRole('button', { name: 'Show 25 more', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'Show 25 more', exact: true })).toHaveCount(0);
});

test('quit does not render an empty confirmation', async ({ mount, page }) => {
  await mount(QuitPreview, { props: { scenario: 'empty' } });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
