import { expect, test } from '../../../../../test/ct-test';
import Preview from '../changes-summary.preview.svelte';

test('collapsed rail opens the previously selected card without hover previews', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, { props: { collapsed: true } });
  const rail = page.locator('[data-workspace-sidebar-rail]');
  await expect(rail.getByRole('button')).toHaveCount(1);
  const expand = rail.locator('[data-sidebar-rail-expand]');
  await expand.hover();
  await expect(page.locator('[data-sidebar-rail-preview]')).toHaveCount(0);
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(rail).toHaveCount(0);
  await expect(page.locator('[data-sidebar-card-tab="changes"]')).toBeVisible();
  await testInfo.attach('sidebar-restored', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
