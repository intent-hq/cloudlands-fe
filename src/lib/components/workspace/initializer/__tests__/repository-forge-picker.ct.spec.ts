import { expect, test } from '../../../../../test/ct-test';
import Preview from '../repository-forge-picker.preview.svelte';

for (const width of [390, 720]) {
  test(`inline forge menu preserves picker focus and row order at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    await mount(Preview, { props: { scenario: 'both' } });
    await page.getByRole('button', { name: 'Choose fixture repository' }).click();
    await expect(page.getByRole('tab', { name: 'Pick a repo', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'GitLab', exact: true })).toHaveCount(0);
    const prefix = page.getByRole('button', { name: 'github.com/', exact: true });
    await page.mouse.move(width - 1, 750);
    await expect(prefix.locator('svg')).toHaveCSS('opacity', '0');
    await prefix.focus();
    await expect(prefix.locator('svg')).toHaveCSS('opacity', '1');
    await prefix.press('Enter');
    await expect(page.getByRole('menuitemradio')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(prefix).toBeFocused();
    await prefix.press('Enter');
    await page.getByRole('menuitemradio', { name: 'gitlab.com/', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search GitLab projects' })).toBeVisible();
    const row = page
      .getByTestId('recent-repositories')
      .locator('[data-slot=menu-action-row]')
      .first();
    await expect(row.getByRole('img', { name: 'GitLab', exact: true })).toBeVisible();
    const [avatar, title, forge] = await Promise.all([
      row.locator('[data-slot=action-row-leading]').boundingBox(),
      row.locator('[data-recent-repo-label]').boundingBox(),
      row.getByRole('img', { name: 'GitLab', exact: true }).boundingBox(),
    ]);
    expect(avatar!.x).toBeLessThan(title!.x);
    expect(title!.x).toBeLessThan(forge!.x);
    expect(forge!.x - (title!.x + title!.width)).toBeLessThanOrEqual(9);
    await row.click();
    await expect(page.getByTestId('repo-selection')).toHaveText('"team/subgroup/app"');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
