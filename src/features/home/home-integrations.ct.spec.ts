import { createMockWorkspace } from '../../test/factories/workspace.factory';
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
  await expect(component.getByText('fix/reconnect → main').last()).toBeVisible();
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

for (const representation of ['raw', 'ipc'] as const) {
  test(`Linear missing credentials show Connect for ${representation} daemon errors`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Harness, { props: { kind: 'linear' } });
    await expect(component.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await page.evaluate((shape) => {
      const original = window.electronAPI.invoke.bind(window.electronAPI);
      window.electronAPI.invoke = (async (channel: string, payload: unknown) => {
        if (
          channel === 'backend:request' &&
          (payload as { method?: string })?.method === 'linear.authStatus'
        ) {
          const detail =
            'linear not configured: linear: no API key found (set linear.token or LINEAR_API_KEY)';
          return {
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              rpcCode: -32603,
              message: 'Internal error',
              data: shape === 'raw' ? detail : { code: 'INTERNAL_ERROR', detail },
            },
          };
        }
        return original(channel, payload);
      }) as typeof window.electronAPI.invoke;
    }, representation);
    await component.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      component.getByRole('heading', { name: 'Connect Linear', exact: true }),
    ).toBeVisible();
    await expect(component.getByRole('alert')).toHaveCount(0);
    await expect(component.getByRole('listbox')).toHaveCount(0);
    await testInfo.attach(`linear-not-configured-${representation}`, {
      body: await page.screenshot({
        path: testInfo.outputPath(`linear-not-configured-${representation}.png`),
      }),
      contentType: 'image/png',
    });
  });
}

test('Linear service errors retain their daemon detail and remain retryable', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { kind: 'linear' } });
  await expect(component.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await page.evaluate(() => {
    const original = window.electronAPI.invoke.bind(window.electronAPI);
    window.electronAPI.invoke = (async (channel: string, payload: unknown) => {
      if (
        channel === 'backend:request' &&
        (payload as { method?: string })?.method === 'linear.authStatus'
      ) {
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            rpcCode: -32603,
            message: 'Internal error',
            data: 'linear API error: service temporarily unavailable',
          },
        };
      }
      return original(channel, payload);
    }) as typeof window.electronAPI.invoke;
  });
  await component.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(component.getByRole('alert')).toContainText(
    'linear API error: service temporarily unavailable',
  );
  await expect(component.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Connect Linear', exact: true })).toHaveCount(
    0,
  );
});

test('Start workspace carries the PR head through the browser initializer prefill', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness);
  await component.getByRole('listbox', { name: 'Pull requests' }).getByRole('option').click();
  await expect(component.getByText('fix/reconnect → main').last()).toBeVisible();
  await component.getByRole('button', { name: 'Start workspace', exact: true }).click();
  const prefill = await page.evaluate(() => window.__homeIntegrationBrowser!.readPrefill());
  expect(prefill).toMatchObject({
    owner: 'acme',
    repo: 'studio',
    number: 142,
    kind: 'pr',
    sourceBranch: 'fix/reconnect',
    targetBranch: 'main',
  });
  const selection = await page.evaluate(() => window.__homeIntegrationBrowser!.resolvePrefill());
  expect(selection.metadata).toMatchObject({
    sourceBranch: 'fix/reconnect',
    targetBranch: 'main',
    project: 'acme/studio',
  });
  expect(selection.metadata?.sourceBranch).not.toBe(selection.metadata?.targetBranch);
  const calls = await page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  expect(calls.some((call) => call.method === 'workspace.create')).toBe(false);
  await testInfo.attach('home-pr-workspace-prefill', {
    body: JSON.stringify({ prefill, selection, calls }, null, 2),
    contentType: 'application/json',
  });
});

test('PR summary reads real checks and reviews; Code browses patches and retries pages', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const component = await mount(Harness);
  const calls = () => page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  await expect(component.getByRole('listbox').getByRole('option')).toHaveCount(1);
  expect(
    (await calls()).some((call) =>
      ['github.pulls.checks', 'github.pulls.reviews', 'github.pulls.files'].includes(call.method),
    ),
  ).toBe(false);
  await component.getByRole('listbox').getByRole('option').click();
  await expect(component.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(component.getByText('Typecheck', { exact: true })).toBeVisible();
  await expect(component.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(component.getByText('Looks good after the', { exact: false })).toBeVisible();
  for (const method of ['github.pulls.checks', 'github.pulls.reviews']) {
    expect(await calls()).toContainEqual({
      method,
      params: {
        owner: 'acme',
        repo: 'studio',
        number: 142,
        workspaceId: 'home-route',
        ...(method === 'github.pulls.checks' ? {} : { limit: 50 }),
      },
    });
  }
  const headerBounds = await component.locator('[data-home-pr-header]').boundingBox();
  expect(headerBounds?.height).toBeLessThanOrEqual(240);
  const rowBounds = await component.getByRole('listbox').getByRole('option').first().boundingBox();
  expect(rowBounds?.height).toBeLessThanOrEqual(76);
  await testInfo.attach('PR summary', {
    body: await page.screenshot({ path: testInfo.outputPath('pr-summary.png') }),
    contentType: 'image/png',
  });
  await component.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(
    component.getByRole('button', { name: 'src/reconnect.ts', exact: false }),
  ).toBeVisible();
  await expect(component.locator('[data-home-pr-code]')).toContainText('src/reconnect.ts');
  // Scope pagination to the preview: the PR list has independent pagination.
  await component
    .locator('section[aria-label]')
    .getByRole('button', { name: 'Load more', exact: true })
    .click();
  await expect(component.getByRole('alert')).toContainText('Fixture file page unavailable');
  await expect(
    component.getByRole('button', { name: 'src/reconnect.ts', exact: false }),
  ).toBeVisible();
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await component.getByRole('button', { name: 'assets/preview.png', exact: false }).click();
  await expect(
    component.getByText('Preview unavailable for this file', { exact: true }),
  ).toBeVisible();
  expect(await calls()).toContainEqual({
    method: 'github.pulls.files',
    params: {
      owner: 'acme',
      repo: 'studio',
      number: 142,
      workspaceId: 'home-route',
      limit: 50,
      nextToken: 'files-two',
      expectedHeadSha: 'abc123',
    },
  });
  await testInfo.attach('PR code', {
    body: await page.screenshot({ path: testInfo.outputPath('pr-code.png') }),
    contentType: 'image/png',
  });
  await testInfo.attach('PR read requests', {
    body: JSON.stringify(await calls(), null, 2),
    contentType: 'application/json',
  });
  expect(
    (await calls()).some((call) =>
      /merge|createReview|reply|postComment|workspace.create/.test(call.method),
    ),
  ).toBe(false);
});

test('PR file pagination discards a changed head and restarts without the old cursor', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness);
  await component.getByRole('listbox').getByRole('option').click();
  await component.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(
    component.getByRole('button', { name: 'src/reconnect.ts', exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = window.electronAPI!.invoke;
    window.electronAPI!.invoke = (async (channel: string, payload?: unknown) => {
      const call = payload as { method?: string; params?: { nextToken?: string } };
      if (
        channel === 'backend:request' &&
        call?.method === 'github.pulls.files' &&
        call.params?.nextToken
      )
        return {
          ok: false,
          error: { code: -32009, message: 'Conflict', data: { headSha: 'new-head' } },
        };
      return original(channel, payload);
    }) as typeof window.electronAPI.invoke;
  });
  await component
    .getByRole('tabpanel', { name: 'Code', exact: true })
    .getByRole('button', { name: 'Load more', exact: true })
    .click();
  await expect(component.getByRole('alert')).toContainText('This pull request changed.');
  await expect(
    component.getByRole('button', { name: 'src/reconnect.ts', exact: false }),
  ).toHaveCount(0);
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    component.getByRole('button', { name: 'src/reconnect.ts', exact: false }),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    window.__homeIntegrationBrowser!.calls.filter((call) => call.method === 'github.pulls.files'),
  );
  expect(calls.at(-1)?.params).not.toHaveProperty('nextToken');
  expect(calls.at(-1)?.params).not.toHaveProperty('expectedHeadSha');
  await testInfo.attach('head-change-recovery', {
    body: JSON.stringify(calls, null, 2),
    contentType: 'application/json',
  });
});

test('PR bot comments sanitize HTML, preserve literal code, and expand compact cards', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const component = await mount(Harness);
  await component.getByRole('listbox').getByRole('option').click();
  const card = component.locator('[data-home-pr-comment]').filter({ hasText: 'Bot findings' });
  await expect(card.getByRole('heading', { name: 'Bot findings' })).toBeVisible();
  await expect(card.locator('h2')).toHaveCount(1);
  await expect(card.locator('h2')).toBeHidden();
  await expect(card.locator('code').filter({ hasText: '<h2></h2>' })).toHaveText('<h2></h2>');
  await expect(card.locator('pre')).toContainText('<h2>literal heading</h2>');
  expect(await card.locator('[onerror],script').count()).toBe(0);
  await card.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(
    card.getByText('Finding 24: preserve reviewer context.', { exact: true }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await testInfo.attach('expanded-github-comment', {
    body: await page.screenshot({ path: testInfo.outputPath('github-comment.png') }),
    contentType: 'image/png',
  });
  await card.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Show more', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('PR linked filter uses loaded workspace links without extra reads', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, {
    props: {
      workspaces: [
        createMockWorkspace({
          repositoryOwner: 'acme',
          repositoryName: 'studio',
          pullRequests: [
            {
              id: '142',
              number: 142,
              title: 'Reconnect recovery',
              status: 'open',
              url: 'https://github.com/acme/studio/pull/142/',
              createdAt: '2026-09-28T00:00:00Z',
              updatedAt: '2026-09-28T00:00:00Z',
            },
          ],
        }),
      ],
    },
  });
  const list = component.getByRole('listbox', { name: 'Pull requests' });
  await expect(list.getByRole('option')).toHaveCount(1);
  await component.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(component.getByRole('alert')).toContainText('Fixture page unavailable');
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  const before = await page.evaluate(() => window.__homeIntegrationBrowser!.calls.length);
  const filter = component.getByRole('button', { name: 'Linked to workspace', exact: true });
  await filter.click();
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('#142');
  expect(await page.evaluate(() => window.__homeIntegrationBrowser!.calls.length)).toBe(before);
  const bounds = await list.getByRole('option').boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(50);
  await filter.click();
  await expect(list.getByRole('option')).toHaveCount(2);
});

test('organization PR scope includes repositories outside Home and invalidates stale scope responses', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness, { props: { organization: 'acme', repoCount: 0 } });
  const list = component.getByRole('listbox', { name: 'Pull requests' });
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list).toContainText('outside-sidebar');
  const calls = () => page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  const searches = () =>
    calls().then((items) => items.filter((call) => call.method === 'github.pulls.search'));
  expect((await searches())[0].params).toMatchObject({
    org: 'acme',
    filter: 'all',
    state: 'open',
    limit: 30,
    workspaceId: 'home-route',
  });
  expect((await searches())[0].params).not.toHaveProperty('repo');
  await component.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  expect((await searches())[1].params).toMatchObject({ org: 'acme', nextToken: 'org-page-two' });
  await component.getByRole('searchbox').fill('stale');
  await expect
    .poll(async () => (await searches()).some((call) => call.params.query === 'stale'))
    .toBe(true);
  await component.update({ organization: 'other-org', repoCount: 0 });
  await expect(list).toContainText('other-org');
  await page.evaluate(() => window.__homeIntegrationBrowser!.releaseSearch());
  await expect(list).not.toContainText('Stale search response');
  await list.getByRole('option').click();
  await expect
    .poll(async () =>
      (await calls()).some(
        (call) =>
          call.method === 'github.pulls.get' &&
          call.params.owner === 'other-org' &&
          call.params.repo === 'outside-sidebar',
      ),
    )
    .toBe(true);
  await testInfo.attach('organization-pr-wire-calls', {
    body: JSON.stringify(await calls(), null, 2),
    contentType: 'application/json',
  });
});

test('older daemons enumerate the full organization before bounded PR batches', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness, { props: { organization: 'legacy-acme', repoCount: 0 } });
  const list = component.getByRole('listbox', { name: 'Pull requests' });
  await expect(list.getByRole('option')).toHaveCount(2);
  const calls = await page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  expect(
    calls.filter((call) => call.method === 'github.repos.search').map((call) => call.params),
  ).toEqual([
    { query: 'user:legacy-acme fork:true', limit: 100, workspaceId: 'home-route' },
    {
      query: 'user:legacy-acme fork:true',
      limit: 100,
      workspaceId: 'home-route',
      nextToken: 'repos-two',
    },
  ]);
  const batches = calls.filter((call) => call.method === 'github.pulls.search' && call.params.repo);
  expect(batches).toHaveLength(2);
  expect(batches[0].params).toMatchObject({ owner: 'legacy-acme', repo: 'outside-sidebar' });
  expect(batches[0].params.repos).toHaveLength(5);
  expect(batches[1].params).toMatchObject({ owner: 'legacy-acme', repo: 'repo7' });
  await testInfo.attach('legacy-organization-wire-calls', {
    body: JSON.stringify(calls, null, 2),
    contentType: 'application/json',
  });
});

test('organization enumeration refuses incomplete scope instead of sidebar fallback', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { organization: 'legacy-loop' } });
  await expect(component.getByRole('alert')).toContainText('complete repository list');
  const calls = await page.evaluate(() => window.__homeIntegrationBrowser!.calls);
  expect(calls.filter((call) => call.method === 'github.pulls.search')).toHaveLength(1);
  expect(calls.filter((call) => call.method === 'github.repos.search')).toHaveLength(2);
});
