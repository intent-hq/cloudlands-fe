import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Dashboard preserves keyboard focus through live updates and returns focus from preview', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview);
  await component.getByRole('button', { name: 'Dashboard view', exact: true }).click();
  const dashboard = component.locator('[data-home-dashboard]');
  const card = dashboard.locator('[data-home-workspace="home-running"]');
  await card.focus();
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

test('Narrow dashboard keeps long cards inside its scroller and preview controls reachable', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview, { props: { scenario: 'dashboard' } });
  const dashboard = component.locator('[data-home-dashboard]');
  await expect(dashboard).toBeVisible();
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
  const card = dashboard.locator('[data-home-workspace="home-ready"]');
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  await page.keyboard.press('Enter');
  const close = component.getByRole('button', { name: 'Back to list', exact: true });
  await expect(close).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport();
});
