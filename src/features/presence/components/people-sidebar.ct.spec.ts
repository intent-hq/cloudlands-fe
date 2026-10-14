import { expect, test } from '../../../test/ct-test';
import PeopleSidebarHost from './__tests__/PeopleSidebarHost.svelte';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('opens People, receives live human activity, and restores focus on close', async ({
  mount,
  page,
}) => {
  const component = await mount(PeopleSidebarHost);
  const launcher = component.getByRole('button', { name: 'People', exact: true });
  await launcher.focus();
  await launcher.press('Enter');
  const panel = component.locator('[data-sidebar-card-tab="people"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Luke');
  await expect(panel).toContainText('Sidebar mockup');
  await component.getByRole('button', { name: 'Add live activity', exact: true }).click();
  await expect(panel).toContainText('Taylor');
  await panel.locator('[data-sidebar-action="plus"]').click();
  await expect(component.locator('[data-share-dialog-open]')).toHaveText('true');
  await panel.locator('[data-sidebar-close]').click();
  await expect(panel).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await launcher.press('Enter');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test('guests can read the feed and lose the panel when multiplayer is disabled', async ({
  mount,
}) => {
  const component = await mount(PeopleSidebarHost, { props: { guest: true } });
  await component.getByRole('button', { name: 'People', exact: true }).click();
  const panel = component.locator('[data-sidebar-card-tab="people"]');
  await expect(panel).toContainText('Luke');
  await expect(panel.locator('[data-sidebar-action="plus"]')).toHaveCount(0);
  await component.getByRole('button', { name: 'Disable multiplayer', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(component.locator('[data-sidebar-people-tile]')).toHaveCount(0);
});

test('older human activity appears with its historical author', async ({ mount }) => {
  const component = await mount(PeopleSidebarHost, { props: { older: true } });
  await component.getByRole('button', { name: 'People', exact: true }).click();
  const panel = component.locator('[data-sidebar-card-tab="people"]');
  await expect(panel.getByRole('button', { name: /load more/i })).toBeVisible();
  await panel.getByRole('button', { name: /load more/i }).click();
  await component.getByRole('button', { name: 'Receive older activity', exact: true }).click();
  await expect(panel).toContainText('Casey');
  await expect(panel).toContainText('Earlier plan');
  await expect(panel.getByRole('button', { name: /load more/i })).toHaveCount(0);
});
