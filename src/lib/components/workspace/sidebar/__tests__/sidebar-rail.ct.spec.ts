import { expect, test } from '../../../../../test/ct-test';
import Preview from '../changes-summary.preview.svelte';

test('collapsed rail previews stay interactive and preserve the expanded card', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, { props: { collapsed: true } });

  const rail = page.locator('[data-workspace-sidebar-rail]');
  const changes = rail.locator('[data-sidebar-rail-tab="changes"]');
  const preview = page.locator('[data-sidebar-rail-preview="changes"]');
  await changes.hover();
  await expect(preview.locator('[data-branch-summary]')).toBeVisible();
  const changesHeight = (await preview.boundingBox())!.height;
  await preview.hover();
  await expect(preview).toBeVisible();

  const working = preview.locator('[data-branch-field="working"]');
  await working.getByRole('button').click();
  const input = working.getByRole('textbox');
  await expect(input).toBeFocused();
  await input.fill('feature/cancelled-from-rail');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(working).not.toContainText('cancelled-from-rail');

  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(changes).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(preview).toBeVisible();
  await testInfo.attach('sidebar-rail-interactive-preview', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const previewElement = await preview.elementHandle();
  const context = rail.locator('[data-sidebar-rail-tab="context"]');
  await context.hover();
  await expect(page.locator('[data-sidebar-rail-preview="context"]')).toBeVisible();
  expect(
    await previewElement!.evaluate(
      (node) => node === document.querySelector('[data-sidebar-rail-preview="context"]'),
    ),
  ).toBe(true);
  const contextHeight = (await page.locator('[data-sidebar-rail-preview="context"]').boundingBox())!
    .height;
  expect(contextHeight).toBeLessThan(changesHeight);
  await page.mouse.move(1000, 750);
  await expect(page.locator('[data-sidebar-rail-preview="context"]')).toHaveCount(0);

  await rail.locator('[data-sidebar-rail-expand]').hover();
  await expect(page.locator('[data-sidebar-rail-preview="overview"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await rail.locator('[data-sidebar-rail-expand]').click();
  await expect(rail).toHaveCount(0);
  await expect(page.locator('[data-sidebar-card-tab="changes"]')).toBeVisible();
  await testInfo.attach('sidebar-restored', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
