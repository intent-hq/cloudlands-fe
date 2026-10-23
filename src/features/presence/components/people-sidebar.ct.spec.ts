import { expect, test } from '../../../test/ct-test';
import PeopleSidebarHost from './__tests__/PeopleSidebarHost.svelte';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('activity clicks reuse the current pane and keep the other pane and People panel open', async ({
  mount,
}) => {
  const component = await mount(PeopleSidebarHost);
  const navigation = component.locator('[data-people-navigation]');
  await component.getByRole('button', { name: 'People', exact: true }).click();
  const panel = component.locator('[data-sidebar-card-tab="people"]');
  const note = panel.locator('[data-people-activity-id="people-activity-note"]');
  await note.click();
  await expect
    .poll(async () => JSON.parse((await navigation.textContent()) || '{}'))
    .toMatchObject({
      focusedPanel: 'current',
      panels: {
        current: { tabs: [{ id: 'original', noteId: 'spec' }, { noteId: 'sidebar-mockup' }] },
        neighbor: {
          activeTabId: 'neighbor-note',
          tabs: [{ id: 'neighbor-note', noteId: 'sidebar-mockup' }],
        },
      },
    });
  const afterClick = JSON.parse((await navigation.textContent()) || '{}');
  expect(afterClick.panels.current.activeTabId).toBe(afterClick.panels.current.tabs[1].id);
  await note.click();
  await expect(navigation).toHaveText(JSON.stringify(afterClick));
  await expect(panel).toBeVisible();
});

test('keyboard activation reveals the recorded message in the current pane', async ({ mount }) => {
  const component = await mount(PeopleSidebarHost);
  await component.getByRole('button', { name: 'People', exact: true }).click();
  const panel = component.locator('[data-sidebar-card-tab="people"]');
  const row = panel
    .locator('[data-slot="list-view-item"]')
    .filter({ hasText: 'Sam: Let’s keep the People panel open' });
  await row.focus();
  await row.press('Enter');
  const navigation = component.locator('[data-people-navigation]');
  await expect
    .poll(async () => JSON.parse((await navigation.textContent()) || '{}'))
    .toMatchObject({
      focusedPanel: 'current',
      panels: {
        current: { tabs: [{ id: 'original' }, { type: 'agent', agentId: 'planner' }] },
        neighbor: { activeTabId: 'neighbor-note' },
      },
    });
  const afterClick = JSON.parse((await navigation.textContent()) || '{}');
  await expect(component.locator('[data-people-message-navigation]')).toHaveText(
    JSON.stringify({
      agentId: 'planner',
      messageId: 'message-1',
      targetTabId: afterClick.panels.current.activeTabId,
    }),
  );
  await expect(panel).toBeVisible();
});

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
  await expect(component.locator('[data-share-dialog-open]')).toHaveText('false');
  await expect(component.locator('[data-people-navigation]')).toContainText('New discussion');
  await panel.locator('[data-sidebar-close]').click();
  await expect(panel).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await launcher.press('Enter');
  await expect(panel).toBeVisible();
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
  await expect(panel.locator('[data-sidebar-action="plus"]')).toHaveCount(1);
  await component.getByRole('button', { name: 'Disable multiplayer', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(component.locator('[data-sidebar-people-tile]')).toHaveCount(0);
});

for (const emptyOlder of [false, true]) {
  test(`People pagination finds older activity independently of raw event pagination (${emptyOlder ? 'empty' : 'populated'})`, async ({
    mount,
  }) => {
    const component = await mount(PeopleSidebarHost, { props: { older: true, emptyOlder } });
    await component.getByRole('button', { name: 'People', exact: true }).click();
    const panel = component.locator('[data-sidebar-card-tab="people"]');
    if (emptyOlder)
      await expect(panel).toContainText('No activity from people in these recent events.');
    // The fixture's raw event cursor is exhausted, but People still has older pages.
    await expect(panel.getByRole('button', { name: /load more/i })).toBeVisible();
    await panel.getByRole('button', { name: /load more/i }).click();
    await component.getByRole('button', { name: 'Receive older activity', exact: true }).click();
    await expect(panel).toContainText('Casey');
    await expect(panel).toContainText('Earlier plan');
    // Receiving the People result leaves a raw cursor; it must not keep this button visible.
    await expect(panel.getByRole('button', { name: /load more/i })).toHaveCount(0);
  });
}

test('discussion opens once in the focused pane and leaves People activity available', async ({
  mount,
}) => {
  const component = await mount(PeopleSidebarHost);
  await component.getByRole('button', { name: 'People', exact: true }).click();
  const row = component.locator('[data-workspace-discussion-open]');
  await row.click();
  const navigation = component.locator('[data-people-navigation]');
  await expect
    .poll(async () => JSON.parse((await navigation.textContent()) || '{}'))
    .toMatchObject({
      focusedPanel: 'current',
      panels: {
        current: {
          tabs: [{ id: 'original' }, { type: 'discussion', workspaceId: 'people-tile-preview' }],
        },
        neighbor: { activeTabId: 'neighbor-note' },
      },
    });
  const opened = await navigation.textContent();
  await row.click();
  await expect(navigation).toHaveText(opened!);
  await expect(component.locator('[data-people-activity]')).toBeVisible();
});

for (const guest of [false, true]) {
  test(`grouped activity keeps the named accessible sentence and keyboard navigation for ${guest ? 'guests' : 'owners'}`, async ({
    mount,
  }) => {
    const component = await mount(PeopleSidebarHost, { props: { guest } });
    await component.getByRole('button', { name: 'People', exact: true }).click();
    const panel = component.locator('[data-sidebar-card-tab="people"]');
    const items = panel.locator('[data-people-activity] [data-slot="list-view-item"]');
    const note = panel.locator(
      '[data-slot="list-view-item"]:has([data-people-activity-id="people-activity-note"])',
    );
    // The continuation still identifies its historical author to assistive technology.
    expect(await note.ariaSnapshot()).toMatch(/Luke.*Sidebar mockup/);
    await items.first().focus();
    await items.first().press('ArrowDown');
    await expect(note).toBeFocused();
    await note.press('Space');
    const navigation = component.locator('[data-people-navigation]');
    await expect
      .poll(async () => JSON.parse((await navigation.textContent()) || '{}'))
      .toMatchObject({
        focusedPanel: 'current',
        panels: {
          current: { tabs: [{ id: 'original' }, { type: 'note', noteId: 'sidebar-mockup' }] },
        },
      });
    const opened = await navigation.textContent();
    await note.press('Enter');
    await expect(navigation).toHaveText(opened!);
    await expect(note).toBeFocused();
    await expect(panel).toBeVisible();
  });
}
