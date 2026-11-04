import { expect, test } from '../../test/ct-test';
import { expectAnimationsToSettle } from '../../test/ct-animations';
import Preview from './home.preview.svelte';

for (const [id, condition] of [
  ['home-running', 'empty'],
  ['home-review', 'whitespace-only'],
] as const) {
  test(`Home keeps ${condition} titles accessible until a real title arrives`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { scenario: 'untitled' } });
    const row = component.locator(`[data-home-workspace="${id}"]`);
    const option = row.locator('..');
    await expect(option).toHaveAccessibleName(/Untitled/);
    await expect(row.locator('.home-row-title')).toHaveText('Untitled');
    await row.locator('.home-row-title').hover();
    await expect(page.getByRole('tooltip')).toHaveText('Untitled');
    if (id === 'home-review') {
      const start = component
        .locator('[data-home-workspace="home-typeahead-review"]')
        .locator('..');
      await expect(start).toBeInViewport();
      await start.focus();
      await expect(start).toBeFocused();
      await page.keyboard.press('u');
      await expect(option).toBeFocused();
    } else {
      await option.focus();
    }
    await page.keyboard.press('Enter');
    const detail = component.locator('[data-home-detail]');
    const open = detail.getByRole('button', { name: 'Open workspace', exact: true });
    await expect(detail.getByRole('heading', { level: 2 })).toContainText('Untitled');
    await open.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Untitled');
    await testInfo.attach(`home-${condition}-before`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await component.getByRole('button', { name: 'Board view', exact: true }).click();
    const card = component.locator(`[data-home-board] [data-home-workspace="${id}"]`);
    await expect(card).toHaveAccessibleName('Untitled');
    await expect(card).toContainText('Untitled');
    // The view switch moves the card; hover only after its own motion finishes.
    await expectAnimationsToSettle(card, { subtree: false });
    await card.getByText('Untitled', { exact: true }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Untitled');

    await page.evaluate((workspaceId) => {
      window.__homeWorkspacePreview!.setTitle(workspaceId, 'Plan the next release');
    }, id);
    await expect(card).toHaveAccessibleName('Plan the next release');
    await expect(card).toContainText('Plan the next release');
    await expect(page.getByRole('tooltip')).toHaveText('Plan the next release');
    await expect(detail.getByRole('heading', { level: 2 })).toContainText('Plan the next release');
    await open.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Plan the next release');

    await component.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(option).toHaveAccessibleName(/Plan the next release/);
    await expect(row.locator('.home-row-title')).toHaveText('Plan the next release');
    await expectAnimationsToSettle(row, { subtree: false });
    await row.locator('.home-row-title').hover();
    await expect(page.getByRole('tooltip')).toHaveText('Plan the next release');
    await open.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => window.__homeWorkspacePreview!.navigation().currentTabId))
      .toBe(id);
    await testInfo.attach(`home-${condition}-after`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach(`home-${condition}-navigation`, {
      body: JSON.stringify(await page.evaluate(() => window.__homeWorkspacePreview!.navigation())),
      contentType: 'application/json',
    });
  });
}
