import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

for (const [id, condition] of [
  ['home-running', 'empty'],
  ['home-review', 'whitespace-only'],
] as const) {
  test(`Dashboard keeps ${condition} titles accessible through a live rename`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview, { props: { scenario: 'untitled' } });
    await component.getByRole('button', { name: 'Dashboard view', exact: true }).click();
    const card = component.locator(`[data-home-dashboard] [data-home-workspace="${id}"]`);
    await expect(card).toHaveAccessibleName('Untitled');
    await card.focus();
    await page.keyboard.press('Enter');
    const detail = component.locator('[data-home-detail]');
    await expect(detail.getByRole('heading', { level: 2 })).toContainText('Untitled');
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();

    await page.evaluate((workspaceId) => {
      window.__homeWorkspacePreview!.setTitle(workspaceId, 'Plan the next release');
    }, id);
    await expect(card).toHaveAccessibleName('Plan the next release');
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(detail.getByRole('heading', { level: 2 })).toContainText('Plan the next release');
  });
}

test('Dashboard preserves keyboard focus through live updates and returns focus from preview', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview, { props: { scenario: 'dashboard' } });
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await component.getByRole('button', { name: 'Dashboard view', exact: true }).click();
  const dashboard = component.locator('[data-home-dashboard]');
  const card = dashboard.locator('[data-home-workspace="home-running"]');
  await card.focus();
  await page.evaluate(() => {
    window.__homeWorkspacePreview?.updateAgent('dashboard-search', {
      lastAgentResponse: 'Checking repository ranking with the new weights.',
    });
    window.__homeWorkspacePreview?.updateTokens('home-running', 18_000);
  });
  await expect(card.locator('[data-home-card-agent="dashboard-search"]')).toContainText(
    'Checking repository ranking',
  );
  await expect(card.locator('[data-home-card-tokens]')).toContainText('19.4K');
  await expect(card).toBeFocused();
  await page.evaluate(() =>
    window.__homeWorkspacePreview?.updateWorkspace('home-running', {
      statusMessage: 'Search ranking is implemented; checking repository filters.',
      taskStats: { total: 4, completed: 3, inProgress: 1 },
      activity: undefined,
      displayStatus: 'pr_ready',
    }),
  );
  await expect(card).toContainText('Search ranking is implemented');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  await expect(card).toBeFocused();
  await expect(dashboard.locator('[data-home-group="running"]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await expect(card).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control',
  );
  await page.keyboard.press(`${modifier}+Enter`);
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-running');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
});

test('Dashboard groups collapse with keyboard and keep filtering when switching views', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'dashboard-repository' } });
  const dashboard = component.locator('[data-home-dashboard]');
  const toggle = dashboard.getByRole('button', { name: 'acme/studio', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(dashboard.locator('[data-home-workspace="home-review"]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await component.getByRole('searchbox').fill('ranked search');
  await expect(dashboard.locator('[data-home-workspace]')).toHaveCount(1);
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(component.getByRole('option')).toHaveCount(1);
  await component.getByRole('button', { name: 'Dashboard view', exact: true }).click();
  await expect(dashboard.locator('[data-home-workspace="home-running"]')).toBeVisible();
});

test('Dashboard uses activity groups and retains the saved List status grouping', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'status-grouping' } });
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  const grouping = page.getByRole('combobox', { name: 'Group by', exact: true });
  await grouping.click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-group]')).toHaveCount(8);

  await component.getByRole('button', { name: 'Dashboard view', exact: true }).click();
  const dashboard = component.locator('[data-home-dashboard]');
  await expect(dashboard.locator('[data-home-workspace]')).toHaveCount(13);
  await expect(dashboard.locator('[data-home-group]')).toHaveCount(3);
  await expect(dashboard.locator('[data-home-group="running"]')).toBeVisible();
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  await expect(grouping).toContainText('Activity');
  await grouping.click();
  await expect(page.getByRole('option', { name: 'Status', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__homeWorkspacePreview!.roundTripSettings());
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^Needs you/ })
    .click();
  await expect(dashboard.locator('[data-home-group]')).toHaveCount(0);
  await expect(dashboard.locator('[data-home-workspace="home-status-failed"]')).toBeVisible();
  await expect(dashboard.locator('[data-home-workspace="home-status-pr_open"]')).toHaveCount(0);
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^All \d/ })
    .click();
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(component.locator('[data-home-group]')).toHaveCount(8);
  await expect(
    component
      .getByRole('listbox', { name: /^PR mergeable$/i })
      .locator('[data-home-workspace="home-status-pr_ready"]'),
  ).toBeVisible();
});

test('Narrow dashboard keeps long cards inside its scroller and preview controls reachable', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview, { props: { scenario: 'dashboard' } });
  const dashboard = component.locator('[data-home-dashboard]');
  await expect(dashboard).toBeVisible();
  const card = dashboard.locator('[data-home-workspace="home-running"]');
  await page.evaluate(() =>
    window.__homeWorkspacePreview?.updateAgent('dashboard-search', {
      lastAgentResponse:
        'A long activity update that must remain inside the card while the coordinator and other agents continue to work on keyboard navigation and repository search.',
    }),
  );
  await expect(card.locator('[data-home-card-agent="dashboard-search"]')).toContainText(
    'A long activity update',
  );
  expect(
    await dashboard.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        element.scrollWidth <= element.clientWidth + 1 &&
        [...element.querySelectorAll('[data-home-workspace]')].every((card) => {
          const rect = card.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        })
      );
    }),
  ).toBe(true);
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  await page.keyboard.press('Enter');
  const close = component.getByRole('button', { name: 'Back to list', exact: true });
  await expect(close).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport();
});

test('Dashboard attention updates keep the card focused and unknown token totals stay absent', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'dashboard' } });
  const card = component.locator('[data-home-workspace="home-review"]');
  await card.focus();
  await page.evaluate(() =>
    window.__homeWorkspacePreview?.updateAgent('dashboard-review', {
      attentionRequestKind: 'blocker',
      attentionRequestReason: 'The staging environment needs access before review can continue.',
    }),
  );
  await expect(card.locator('[data-home-card-attention]')).toContainText(
    'The staging environment needs access',
  );
  await expect(card).toBeFocused();
  const unread = component.locator('[data-home-workspace="home-unread"]');
  await expect(unread.locator('[data-home-card-tokens]')).toHaveCount(0);
  await page.evaluate(() =>
    window.__homeWorkspacePreview?.updateWorkspace('home-unread', {
      attention: undefined,
      waiting: true,
    }),
  );
  await expect(unread.locator('[data-home-card-unread]')).toHaveCount(0);
  await expect(
    unread.locator('[data-home-status]').getByText('Waiting', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.__homeWorkspacePreview?.updateWorkspace('home-unread', { waiting: false }),
  );
  await expect(
    unread.locator('[data-home-status]').getByText('Idle', { exact: true }),
  ).toBeVisible();
});

test('Dashboard distinguishes live PR states and preserves waiting details and focus', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'dashboard' } });
  const card = component.locator('[data-home-workspace="home-ready"]');
  const status = card.locator('[data-home-status]');
  await card.focus();
  for (const [displayStatus, label] of [
    ['pr_open', 'PR open'],
    ['pr_ready', 'PR mergeable'],
    ['pr_queued', 'PR queued'],
  ] as const) {
    await page.evaluate((state) => {
      window.__homeWorkspacePreview!.updateWorkspace('home-ready', {
        displayStatus: state,
        waiting: true,
      });
    }, displayStatus);
    await expect(status.getByText(new RegExp(`^${label}$`, 'i'))).toBeVisible();
    await expect(card).toBeFocused();
    await status.hover();
    await expect(page.getByRole('tooltip')).toContainText(new RegExp(label, 'i'));
    await expect(page.getByRole('tooltip')).toContainText(/Waiting/i);
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await page.evaluate(() => {
    window.__homeWorkspacePreview!.updateWorkspace('home-ready', { waiting: false });
  });
  await status.hover();
  await expect(page.getByRole('tooltip')).toContainText(/PR queued/i);
  await expect(page.getByRole('tooltip')).not.toContainText(/Waiting/i);
});
