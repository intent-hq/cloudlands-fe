import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Home list shows Pinned, then each custom label as its own collapsible group', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  const component = await mount(Preview, { props: { scenario: 'labels', height: 980 } });
  const groupIds = () =>
    component
      .locator('[data-home-group]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-home-group')));
  const group = (name: string) => component.getByRole('listbox', { name, exact: true });
  const row = (id: string) => `[data-home-workspace="${id}"]`;

  await expect
    .poll(groupIds)
    .toEqual(['pinned', 'label:For Later', 'needs-you', 'running', 'waiting']);
  const later = group('For Later');
  await expect(later.locator('[data-home-workspace]')).toHaveCount(2);
  await expect(later.locator(row('home-unread'))).toHaveCount(1);
  await expect(later.locator(row('home-ready'))).toHaveCount(1);
  await expect(group('Needs you').locator(row('home-ready'))).toHaveCount(0);
  await expect(component.locator(row('home-ready'))).toHaveCount(1);
  await expect(group('Pinned').getByLabel('Pinned', { exact: true })).toHaveCount(1);
  await expect(later.getByLabel('Pinned', { exact: true })).toHaveCount(0);
  await page.mouse.move(0, 0);
  await testInfo.attach('home-label-groups', {
    body: await page.screenshot({ path: testInfo.outputPath('home-label-groups.png') }),
    contentType: 'image/png',
  });

  const header = component.getByRole('button', { name: 'For Later', exact: true });
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(later).toHaveCount(0);
  await expect(component.locator(row('home-ready'))).toHaveCount(0);
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(later.locator('[data-home-workspace]')).toHaveCount(2);

  await component.locator(row('home-review')).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Label', exact: true }).hover();
  await expect(page.getByRole('menuitemradio', { name: 'For Later', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: /^New label/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => window.__homeWorkspacePreview!.setLabel('home-unread', null));
  await expect(later.locator('[data-home-workspace]')).toHaveCount(1);
  await page.evaluate(() => window.__homeWorkspacePreview!.setLabel('home-ready', 'pinned'));
  await expect(later).toHaveCount(0);
  await expect.poll(groupIds).toEqual(['pinned', 'needs-you', 'running', 'waiting', 'inactive']);
  await expect(group('Pinned').locator('[data-home-workspace]')).toHaveCount(2);
  await expect(group('Pinned').getByLabel('Pinned', { exact: true })).toHaveCount(2);
  await expect(group('Done & idle').locator(row('home-unread'))).toHaveCount(1);
});

test('Group by None keeps the flat list with pin icons only for Pinned', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const component = await mount(Preview, { props: { scenario: 'labels', height: 980 } });
  await expect(component.locator('[data-home-group]')).not.toHaveCount(0);
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Group by', exact: true }).click();
  await page.getByRole('option', { name: 'None', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-group]')).toHaveCount(0);
  await expect(component.locator('[data-home-workspace]')).toHaveCount(6);
  await expect(component.getByLabel('Pinned', { exact: true })).toHaveCount(1);
  await expect(component.locator('[data-home-workspace]').first()).toHaveAttribute(
    'data-home-workspace',
    'home-complete',
  );
});
