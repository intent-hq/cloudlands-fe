import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';
import IntegrationPreview from './home-integrations.preview.svelte';

test('Home loading stays calm with reduced motion', async ({ mount, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(IntegrationPreview, { props: { scenario: 'loading' } });
  const loading = component.locator('[data-home-loading]');
  await expect(loading).toBeVisible();
  expect(
    await loading
      .locator('[data-slot="skeleton"]')
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).animationName === 'none'),
      ),
  ).toBe(true);
  await testInfo.attach('home-loading-reduced-motion', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home handles rapid tab and filter changes with motion enabled', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(Preview);
  for (const name of ['Pull requests', 'Linear issues', 'Workspaces']) {
    await component.getByRole('tab', { name, exact: true }).click();
  }
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: /^Needs you/ }).click();
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: /^All workspaces/ }).click();
  const rows = component.getByRole('listbox', { name: 'Workspaces' }).getByRole('option');
  await expect(rows).toHaveCount(6);
  await rows.first().focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rows.first()).toBeFocused();
  await testInfo.attach('home-motion-settled', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home filters and previews workspaces without entering them', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const list = component.getByRole('listbox', { name: 'Workspaces' });
  await expect(list.getByRole('option')).toHaveCount(6);
  await list.getByRole('option').first().click();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await list.getByRole('option').first().click();
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.getByRole('tab', { name: 'Pull requests', exact: true }).click();
  await expect(component.getByRole('tab', { name: 'Pull requests', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(component.getByRole('tab', { name: 'Pull requests', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(component.getByRole('tab', { name: 'Workspaces', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(list.getByRole('option')).toHaveCount(6);
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: /^Needs you/ }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  await list.getByRole('option').first().focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await expect(component.getByRole('button', { name: 'Open workspace' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await expect(list.getByRole('option').first()).toBeFocused();
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: /^Unread/ }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list).toContainText('Document the release process');
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: /^Archived/ }).click();
  await expect(list).toContainText('Explore alternative layouts');
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: /^All workspaces/ }).click();
  await component.getByRole('button', { name: 'acme/platform', exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  await component.getByRole('searchbox').fill('no matching work');
  await expect(component.getByRole('heading', { name: 'No matching workspaces' })).toBeVisible();
  await component.getByRole('button', { name: 'Clear filters' }).click();
  await expect(list.getByRole('option')).toHaveCount(6);
  await testInfo.attach('home-list', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Home board uses the same scope and restores keyboard focus after narrow preview', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  await expect(component.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const board = component.locator('[data-home-board]');
  await expect(board.getByRole('button')).toHaveCount(6);
  const card = board.getByRole('button', { name: 'Review the new onboarding flow', exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await component.getByRole('button', { name: 'Back to list' }).click();
  await expect(card).toBeFocused();
  expect(
    await component
      .locator('[data-home-page]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(component.getByRole('listbox').getByRole('option')).toHaveCount(6);
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: /^Running/ }).click();
  await expect(board.getByRole('button')).toHaveCount(1);
  await testInfo.attach('home-board', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Home keeps Assistant and owner creation hidden for collaborators', async ({ mount }) => {
  const component = await mount(Preview, { props: { scenario: 'collaborator' } });
  await expect(component.getByRole('button', { name: 'Assistant', exact: true })).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'New workspace', exact: true })).toHaveCount(
    0,
  );
  await expect(component.getByRole('listbox').getByRole('option')).toHaveCount(6);
});

test('Home shows connection errors with a retry action', async ({ mount }) => {
  const component = await mount(Preview, { props: { scenario: 'error' } });
  await expect(component.getByRole('alert')).toContainText(
    'The daemon connection was interrupted.',
  );
  await expect(component.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('Home preview resizes and board headers stay visible while scrolling', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  await page.locator('[data-home-preview]').evaluate((element) => {
    element.style.height = '360px';
  });
  const board = component.locator('[data-home-board]');
  const header = board.getByRole('heading').first();
  const before = await header.boundingBox();
  await board.evaluate((element) => {
    element.scrollTop = 100;
  });
  expect(await board.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(async () => Math.abs((await header.boundingBox())!.y - before!.y))
    .toBeLessThan(2);
  await page.locator('[data-home-preview]').evaluate((element) => {
    element.style.height = '720px';
  });
  await board.getByRole('button', { name: 'Review the new onboarding flow', exact: true }).click();
  const detail = component.locator('[data-home-detail]');
  const handle = component.locator('.resizable-panel-handle');
  await expect(handle).toBeVisible();
  const width = (await detail.boundingBox())!.width;
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await detail.boundingBox())!.width).toBeGreaterThan(width);
  await expect(
    detail.locator('header').getByRole('button', { name: 'Open workspace' }),
  ).toBeVisible();
  await testInfo.attach('home-resizable-preview', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
