import { expect, test } from '../../../test/ct-test';
import Preview from './workspace-tabs-micro.preview.svelte';

for (const scenario of ['list', 'board'] as const) {
  test(`tab assignment synchronizes with Home ${scenario} including unnumbered tabs`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { scenario } });
    const pinned = component.locator('[data-workspace-tab="home-review"]');
    const regular = component.locator('[data-workspace-tab="home-running"]');
    const unnumbered = component.locator('[data-workspace-tab="home-unread"]');
    const row = component.locator('[data-home-workspace="home-unread"]');
    await expect(pinned.getByTitle('Micro key 1', { exact: true })).toHaveText('1');
    await expect(regular.getByTitle('Micro key 2', { exact: true })).toHaveText('2');
    await expect(unnumbered.locator('[title^="Micro key"]')).toHaveCount(0);
    await unnumbered.getByRole('tab').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Unassign', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }).hover();
    await expect(page.getByRole('menuitemradio')).toHaveCount(6);
    await page.getByRole('menuitemradio').nth(1).click();
    await expect(unnumbered.getByTitle('Micro key 2', { exact: true })).toHaveText('2');
    await expect(row.getByTitle('Micro key 2', { exact: true })).toHaveText('2');
    await expect(regular.locator('[title^="Micro key"]')).toHaveCount(0);
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }).hover();
    await expect(page.getByRole('menuitemradio').nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio').nth(5).click();
    await expect(unnumbered.getByTitle('Micro key 6', { exact: true })).toHaveText('6');
    await component
      .getByRole('button', { name: scenario === 'list' ? 'Board view' : 'List view', exact: true })
      .click();
    await expect(row.getByTitle('Micro key 6', { exact: true })).toHaveText('6');
    // Context menu bubbles from the compact square itself, not just the title.
    await unnumbered.getByTitle('Micro key 6', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unassign', exact: true }).click();
    await expect(unnumbered.locator('[title^="Micro key"]')).toHaveCount(0);
    await expect(row.locator('[title^="Micro key"]')).toHaveCount(0);
    await expect(
      component.locator('[data-micro-tab-strip]').getByRole('tab', { selected: true }),
    ).toHaveAttribute('id', 'workspace-tab-home-review');
  });
}

test('disconnect removes hardware commands from an open submenu and reconnect restores numbers', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const pinned = component.locator('[data-workspace-tab="home-review"]');
  // The separate close control is also within the tab context target.
  await pinned.locator('[data-workspace-tab-close]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }).hover();
  await expect(page.getByRole('menuitemradio')).toHaveCount(6);
  await page.evaluate(() => window.__homeMicroPreview!.setConnected(false));
  await expect(component.locator('[data-micro-tab-strip] [title^="Micro key"]')).toHaveCount(0);
  await expect(page.getByRole('menuitemradio')).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Close', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__homeMicroPreview!.setConnected(true));
  await expect(pinned.getByTitle('Micro key 1', { exact: true })).toHaveText('1');
  await expect(
    component
      .locator('[data-workspace-tab="home-running"]')
      .getByTitle('Micro key 2', { exact: true }),
  ).toHaveText('2');
});

test('numbered tabs preserve focus, selection, dragging and close actions', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 900 });
  const component = await mount(Preview);
  const tab = (id: string) => component.locator(`[data-workspace-tab="${id}"]`);
  const pinned = tab('home-review');
  const regular = tab('home-running');
  await regular.getByTitle('Micro key 2', { exact: true }).click();
  await expect(regular.getByRole('tab')).toHaveAttribute('aria-selected', 'true');
  await regular.getByRole('tab').focus();
  await page.keyboard.press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Assign to Micro Key', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(regular.getByRole('tab')).toBeFocused();
  const origin = await pinned.getByTitle('Micro key 1', { exact: true }).boundingBox();
  const target = await tab('home-unread').boundingBox();
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width - 5, target!.y + target!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview!.navigation().tabOrder))
    .toEqual(['home-running', 'home-unread', 'home-review']);
  await pinned.locator('[data-workspace-tab-close]').click();
  await expect(pinned).toHaveCount(0);
  await regular.getByRole('tab').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close tabs to the right', exact: true }).click();
  await expect(tab('home-unread')).toHaveCount(0);
  await expect(regular.getByRole('tab')).toBeVisible();
});
