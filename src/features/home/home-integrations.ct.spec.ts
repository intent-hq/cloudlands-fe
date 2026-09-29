import { expect, test } from '../../test/ct-test';
import Harness from './home-integrations-harness.svelte';

// Failure contracts: wrong request envelope/field casing; lost workspace routing; repo
// truncation; stale search overwriting current results; failed pagination deleting rows;
// detail/comments using the wrong PR; Linear list envelope mistaken for a bare issue.
test('PR wire requests populate details and preserve rows after pagination fails', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const component = await mount(Harness);
  const list = component.getByRole('listbox', { name: 'Pull requests' });
  await expect(list.getByRole('option')).toHaveCount(1);
  const calls = () => page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  expect(await calls()).toContainEqual({
    method: 'github.pulls.search',
    params: {
      workspaceId: 'home-route',
      limit: 30,
      owner: 'acme',
      repo: 'studio',
      repos: [{ owner: 'acme', repo: 'platform' }],
      filter: 'all',
      state: 'open',
    },
  });
  await list.getByRole('option').click();
  await expect(component.getByRole('heading', { name: 'Reconnect recovery' })).toBeVisible();
  await expect(component.getByText('Please preserve', { exact: false })).toBeVisible();
  expect(await calls()).toContainEqual({
    method: 'github.pulls.get',
    params: { owner: 'acme', repo: 'studio', number: 142, workspaceId: 'home-route' },
  });
  expect(await calls()).toContainEqual({
    method: 'github.listReviewComments',
    params: { owner: 'acme', repo: 'studio', number: 142, workspaceId: 'home-route', limit: 30 },
  });
  await expect(component.getByText('fix/reconnect → main')).toBeVisible();
  await testInfo.attach('home-pr-wire-detail', {
    body: await page.screenshot({ path: testInfo.outputPath('home-pr-detail.png') }),
    contentType: 'image/png',
  });
  await component.getByRole('button', { name: 'Close preview' }).focus();
  await page.keyboard.press('Escape');
  await expect(list.getByRole('option')).toBeFocused();
  await component.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(component.getByRole('alert')).toContainText('Fixture page unavailable');
  await expect(list.getByRole('option')).toHaveCount(1);
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  await expect(component.getByText('2 loaded', { exact: true })).toBeVisible();
  await testInfo.attach('home-pr-wire-calls', {
    body: JSON.stringify(await calls(), null, 2),
    contentType: 'application/json',
  });
});

test('Linear uses list envelopes and bare details with honest search scope', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 850 });
  const component = await mount(Harness, { props: { kind: 'linear' } });
  const list = component.getByRole('listbox', { name: 'Linear issues' });
  await expect(list.getByRole('option')).toHaveCount(1);
  const calls = () => page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  expect(await calls()).toContainEqual({
    method: 'linear.listIssues',
    params: { workspaceId: 'home-route', limit: 30, filter: 'assigned' },
  });
  await list.getByRole('option').click();
  await expect(component.getByRole('heading', { name: 'Acceptance criteria' })).toBeVisible();
  await expect(component.getByText('High', { exact: true })).toBeVisible();
  await expect(list).toBeHidden();
  expect(await calls()).toContainEqual({
    method: 'linear.getIssue',
    params: { id: 'linear-318', workspaceId: 'home-route' },
  });
  await testInfo.attach('home-linear-wire-detail', {
    body: await page.screenshot({ path: testInfo.outputPath('home-linear-detail.png') }),
    contentType: 'image/png',
  });
  await component.getByRole('button', { name: 'Close preview' }).click();
  await component.getByRole('button', { name: 'Created by me', exact: true }).click();
  await expect.poll(calls).toContainEqual({
    method: 'linear.listIssues',
    params: { workspaceId: 'home-route', limit: 30, filter: 'created' },
  });
  await component.getByRole('searchbox').fill('attention');
  await expect.poll(calls).toContainEqual({
    method: 'linear.searchIssues',
    params: { workspaceId: 'home-route', limit: 30, query: 'attention' },
  });
  await expect(
    component.getByRole('button', { name: 'Created by me', exact: true }),
  ).toBeDisabled();
  await expect(
    component.getByText('Search across all Linear teams and people.', { exact: false }),
  ).toBeVisible();
  await testInfo.attach('home-linear-wire-calls', {
    body: JSON.stringify(await calls(), null, 2),
    contentType: 'application/json',
  });
});

test('All repositories are batched and stale search responses cannot replace newer results', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness, { props: { repoCount: 7 } });
  const list = component.getByRole('listbox', { name: 'Pull requests' });
  await expect(list.getByRole('option')).toHaveCount(2);
  const calls = () => page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  const searches = (await calls()).filter((call) => call.method === 'github.pulls.search');
  expect(searches).toHaveLength(2);
  expect(searches[0].params.repos).toHaveLength(5);
  expect(searches[1].params).toMatchObject({ owner: 'acme', repo: 'repo7', repos: [] });
  await component.getByRole('searchbox').fill('stale');
  await expect
    .poll(async () => (await calls()).some((call) => call.params.query === 'stale'))
    .toBe(true);
  await component.getByRole('searchbox').fill('latest');
  await expect(list.getByRole('option')).toHaveCount(2);
  await expect(list).toContainText('Latest query result');
  await page.evaluate(async () => {
    window.__homeIntegrationBrowser!.releaseSearch();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await expect(list).not.toContainText('Stale search response');
  await testInfo.attach('home-integration-search-calls', {
    body: JSON.stringify(await calls(), null, 2),
    contentType: 'application/json',
  });
});
