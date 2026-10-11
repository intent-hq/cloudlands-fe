import { expect, test } from '../../test/ct-test';
import Preview from './home-micro.preview.svelte';

for (const scenario of ['list', 'board'] as const) {
  test(`Home ${scenario} gates numbers and menus on the live Micro connection`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { scenario } });
    const row = component.locator('[data-home-workspace="home-review"]');
    const badge = row.getByTitle('Micro key 1', { exact: false });
    await expect(badge).toHaveText('1');
    await row.click({ button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.__homeMicroPreview!.setConnected(false));
    await expect(badge).toHaveCount(0);
    await expect(
      page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('menuitem', { name: 'Open workspace', exact: false }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__homeMicroPreview!.setConnected(true));
    await expect(badge).toHaveText('1');
  });

  test(`Home ${scenario} assigns an unnumbered workspace and synchronizes both views`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { scenario } });
    const row = () => component.locator('[data-home-workspace="home-unread"]');
    await expect(row().locator('[title^="Micro key"]')).toHaveCount(0);
    await row().click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Unassign', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }).hover();
    const choices = page.getByRole('menuitemradio');
    await expect(choices).toHaveCount(6);
    await expect(choices.nth(1)).toContainText('Improve search across workspaces');
    await choices.nth(1).click();
    await expect(row().getByTitle('Micro key 2', { exact: false })).toHaveText('2');
    await component
      .getByRole('button', { name: scenario === 'list' ? 'Board view' : 'List view', exact: true })
      .click();
    await expect(row().getByTitle('Micro key 2', { exact: false })).toHaveText('2');
    await row().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }).hover();
    await expect(page.getByRole('menuitemradio').nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio').nth(5).click();
    await expect(row().getByTitle('Micro key 6', { exact: false })).toHaveText('6');
    await row().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unassign', exact: true }).click();
    await expect(row().locator('[title^="Micro key"]')).toHaveCount(0);
    await component
      .getByRole('button', { name: scenario === 'list' ? 'List view' : 'Board view', exact: true })
      .click();
    await expect(row().locator('[title^="Micro key"]')).toHaveCount(0);
    await testInfo.attach(`home-micro-${scenario}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('Home board keyboard menu restores focus and preserves preview and open navigation', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  const row = component.locator('[data-home-workspace="home-review"]');
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  const before = await page.evaluate(() => window.__homeWorkspacePreview!.navigation());
  await row.click();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  expect(await page.evaluate(() => window.__homeWorkspacePreview!.navigation())).toEqual(before);
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control',
  );
  await row.click({ modifiers: [modifier] });
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview!.navigation().currentTabId))
    .toBe('home-review');
});
