import { expect, test } from '../../../test/ct-test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

test('collapsed previews retain draft, search, and cached content state', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SidebarTabsPreview, {
    props: { collapsed: true, items: 200, extraFiles: 200, navigationEnabled: true },
  });
  const rail = component.locator('[data-workspace-sidebar-rail]');
  const flyout = component.locator('[data-workspace-sidebar-flyout]');
  const draft = component.getByRole('textbox', { name: 'Workspace draft' });
  await draft.fill('Keep this draft through switching previews.');
  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await flyout.locator('[data-sidebar-search="context"] button').click();
  const search = flyout.locator('[data-sidebar-search-input="context"]');
  await search.fill('Interaction');
  const sectionNode = await flyout.locator('[data-sidebar-section="context"]').elementHandle();

  await rail.getByRole('tab', { name: 'Files', exact: true }).hover();
  await expect(flyout.locator('[data-sidebar-section="files"]')).toBeVisible();

  await rail.getByRole('tab', { name: 'Context', exact: true }).hover();
  await expect(search).toHaveValue('Interaction');
  expect(await sectionNode!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this draft through switching previews.');
  await expect(component).toHaveAttribute('data-sidebar-activation-count', '0');
  await testInfo.attach('sidebar-preview-state', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
