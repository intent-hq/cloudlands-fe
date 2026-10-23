import { expect, test } from '../../../test/ct-test';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

test('expanded keyboard focus opens default content and each activation runs once', async ({
  mount,
  page,
}) => {
  const component = await mount(SidebarTabsPreview, { props: { navigationEnabled: true } });
  const scene = page.locator('[data-sidebar-tabs-preview]');
  const tabs = component.locator('[data-sidebar-section-tabs="horizontal"]');
  const agents = tabs.getByRole('tab', { name: 'Agents', exact: true });
  const context = tabs.getByRole('tab', { name: 'Context', exact: true });
  await agents.focus();
  await expect(scene).toHaveAttribute('data-sidebar-destination-type', 'agent');
  await expect(scene).toHaveAttribute('data-sidebar-destination-id', 'sidebar-preview-agent-0');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '1');
  await agents.press('ArrowRight');
  await expect(context).toBeFocused();
  await expect(scene).toHaveAttribute('data-sidebar-destination-type', 'note');
  await expect(scene).toHaveAttribute('data-sidebar-destination-id', 'spec');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '2');
  await context.press('Enter');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '3');
  await context.press('Space');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '4');
  await component.getByRole('textbox', { name: 'Workspace draft' }).click();
  const changes = tabs.getByRole('tab', { name: 'Changes', exact: true });
  await changes.click();
  await expect(scene).toHaveAttribute('data-sidebar-destination-type', 'local-changes');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '5');
  await changes.click();
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '6');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('collapsed hover and arrow focus preview, while click, Enter and Space open defaults once', async ({
  mount,
  page,
}) => {
  const component = await mount(SidebarTabsPreview, {
    props: { collapsed: true, navigationEnabled: true },
  });
  const scene = page.locator('[data-sidebar-tabs-preview]');
  const tabs = component.locator('[data-sidebar-section-tabs="vertical"]');
  const context = tabs.getByRole('tab', { name: 'Context', exact: true });
  await context.hover();
  await expect(component.locator('[data-workspace-sidebar-flyout]')).toBeVisible();
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '0');
  await context.click();
  await expect(scene).toHaveAttribute('data-sidebar-destination-type', 'note');
  await expect(scene).toHaveAttribute('data-sidebar-destination-id', 'spec');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '1');
  await context.press('ArrowDown');
  const changes = tabs.getByRole('tab', { name: 'Changes', exact: true });
  await expect(changes).toBeFocused();
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '1');
  await changes.press('Enter');
  await expect(scene).toHaveAttribute('data-sidebar-destination-type', 'local-changes');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '2');
  await changes.press('Space');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '3');
});

test('the Browsers tab focuses the first browser from the existing list', async ({
  mount,
  page,
}) => {
  const component = await mount(SidebarTabsPreview, { props: { navigationEnabled: true } });
  await component.getByRole('textbox', { name: 'Workspace draft' }).click();
  await component
    .locator('[data-sidebar-section-tabs="horizontal"]')
    .getByRole('tab', { name: 'Browsers', exact: true })
    .click();
  const scene = page.locator('[data-sidebar-tabs-preview]');
  await expect(scene).toHaveAttribute('data-sidebar-destination-type', 'browser');
  await expect(scene).toHaveAttribute('data-sidebar-destination-id', 'sidebar-preview-browser');
  await expect(scene).toHaveAttribute('data-sidebar-activation-count', '1');
});
