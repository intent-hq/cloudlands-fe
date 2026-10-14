import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openList(page, search = '') {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const errors = await observeErrors(page);
  const requests = [];
  const pending = new Map();
  let workspaces = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      requests.push(request);
      pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (request?.method === 'workspace.list' && response.result)
        workspaces = response.result.workspaces;
    });
  });
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(`${base}/workspaces${search}`);
  await expect.poll(() => workspaces.some((row) => row.id === workspaceId)).toBe(true);
  const list = page.getByTestId('workspace-list');
  return {
    list,
    rows: list.locator('[data-list-workspace]'),
    workspaceId,
    filter: list.getByRole('combobox', { name: 'Status', exact: true }),
    input: list.getByRole('searchbox'),
    active: workspaces.filter(
      (row) => !['Archived', 'Deleted'].includes(row.status) && !row.pendingDeleteAt,
    ),
    workspaces,
    evidence: async (info) => {
      await info.attach('workspace-home-filter-wire.json', {
        body: JSON.stringify({ requests, workspaces, errors }),
        contentType: 'application/json',
      });
      expect(
        requests.filter(({ method }) =>
          /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    },
  };
}

test('real Home status filter combines daemon signals with search and survives Back', async ({
  page,
}, info) => {
  const { list, rows, workspaceId, filter, input, active, evidence } = await openList(page);
  try {
    await expect(rows).toHaveCount(active.length);
    await expect(input).not.toBeFocused();
    await filter.click();
    await page.keyboard.press('r');
    await page.keyboard.press('Enter');
    await expect(filter).toHaveText('Running');
    await expect(filter).toBeFocused();
    const running = active.filter(
      (row) =>
        (row.activity === 'agent_running' || row.displayStatus === 'in_progress') &&
        !['blocked', 'failed', 'needs_attention', 'pr_ready'].includes(row.displayStatus) &&
        row.attention !== 'review_required',
    );
    expect(running.some((row) => row.id === workspaceId)).toBe(true);
    await expect
      .poll(() =>
        rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.listWorkspace).sort()),
      )
      .toEqual(running.map((row) => row.id).sort());
    await input.fill(workspaceId);
    const current = list.locator(`[data-list-workspace="${workspaceId}"]`);
    await expect(rows).toHaveCount(1);
    await expect(current).toBeVisible();
    expect(new URL(page.url()).searchParams.get('filter')).toBe('running');
    await current.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('workspace-overview')).toHaveAttribute(
      'data-workspace-id',
      workspaceId,
    );
    await expect(
      page.getByTestId('workspace-overview').getByRole('heading', { level: 1 }),
    ).toBeFocused();
    await page.goBack();
    await expect(filter).toHaveText('Running');
    await expect(input).toHaveValue(workspaceId);
    await expect(current).toBeVisible();
    const before = await list.boundingBox();
    await expect(current).toBeFocused();
    await current.click();
    const git = page.getByTestId('workspace-git-status');
    await expect(git).toBeVisible();
    await expect(
      page.getByTestId('workspace-overview').getByRole('heading', { level: 1 }),
    ).toBeFocused();
    await page.evaluate(() => document.fonts.ready);
    await info.attach('workspace-entry-focus', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await git.locator('[data-sidebar-search="files"]').getByRole('button').click();
    await git.getByRole('searchbox').fill('package.json');
    await expect(git.getByRole('searchbox')).toBeFocused();
    const notes = page.getByTestId('workspace-notes');
    await notes.locator('[data-sidebar-search="context"]').getByRole('button').click();
    await notes.getByRole('searchbox').fill('independent-note-query');
    await expect(notes.getByRole('searchbox')).toBeFocused();
    await git.locator('a[data-file-path="package.json"]').first().click();
    await expect(page.getByTestId('workspace-file-content')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('workspace-file-content')).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get('homeQuery')).toBe(workspaceId);
    expect(new URL(page.url()).searchParams.get('homeFilter')).toBe('running');
    await page
      .getByTestId('workspace-file')
      .getByRole('link', { name: 'Back', exact: true })
      .click();
    await expect(notes.getByRole('searchbox')).toHaveValue('independent-note-query');
    await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await expect(filter).toHaveText('Running');
    await expect(input).toHaveValue(workspaceId);
    await expect(rows).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('q')).toBe(workspaceId);
    await expect(current).toBeFocused();
    expect(new URL(page.url()).searchParams.get('filter')).toBe('running');
    expect(new URL(page.url()).searchParams.has('homeQuery')).toBe(false);
    expect(new URL(page.url()).searchParams.has('fileQuery')).toBe(false);
    const after = await list.boundingBox();
    await info.attach('home-return-geometry', {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    });
    await input.fill('no-workspace-matches-491dcb8d');
    await expect(rows).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(list.locator('output')).toBeVisible();
    await input.press('Escape');
    await expect(input).toHaveValue('');
    await expect(filter).toHaveText('Running');
    await expect(rows).toHaveCount(running.length);
    await input.fill(workspaceId);
    await expect(current).toBeVisible();
    await stableLocatorScreenshot(page, list, async ({ png, attempt }) => {
      if (png)
        await info.attach(`real-home-filter-${attempt}`, { body: png, contentType: 'image/png' });
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
  } finally {
    await evidence(info);
  }
});

test('Home return focuses search when the workspace is excluded by the retained query', async ({
  page,
}, info) => {
  const { workspaceId, input, list, rows, evidence } = await openList(page);
  try {
    const base = process.env.REACT_BASE_URL;
    const query = 'no-workspace-matches-return-focus';
    await page.goto(`${base}/workspaces/${encodeURIComponent(workspaceId)}?homeQuery=${query}`);
    await expect(page.getByTestId('workspace-overview')).toHaveAttribute(
      'data-workspace-id',
      workspaceId,
    );
    await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await expect(input).toHaveValue(query);
    await expect(rows).toHaveCount(0);
    await expect(input).toBeFocused();
    await input.press('Escape');
    await expect(input).toHaveValue('');
    await expect(rows).not.toHaveCount(0);
    await expect(input).toBeFocused();
    await page.evaluate(() => document.fonts.ready);
    await stableLocatorScreenshot(page, list, async ({ png, attempt }) => {
      if (png)
        await info.attach(`home-return-focus-${attempt}`, { body: png, contentType: 'image/png' });
    });
  } finally {
    await evidence(info);
  }
});

test('a direct workspace URL returns to the unfiltered Home list', async ({ page }, info) => {
  const { rows, filter, input, active, workspaceId, evidence } = await openList(page);
  try {
    await page.goto(`${process.env.REACT_BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}`);
    await expect(page.getByTestId('workspace-overview')).toBeVisible();
    await expect(
      page.getByTestId('workspace-overview').getByRole('heading', { level: 1 }),
    ).toBeFocused();
    await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await expect(filter).toHaveText('All workspaces');
    await expect(input).toHaveValue('');
    await expect(rows).toHaveCount(active.length);
    expect(new URL(page.url()).search).toBe('');
  } finally {
    await evidence(info);
  }
});

test('invalid Home filters fall back safely and Archived uses real lifecycle records', async ({
  page,
}, info) => {
  const { rows, filter, input, active, workspaces, evidence } = await openList(
    page,
    '?filter=not-a-status',
  );
  try {
    await expect(filter).toHaveText('All workspaces');
    await expect(rows).toHaveCount(active.length);
    const archived = workspaces.filter((row) => row.status === 'Archived' && !row.pendingDeleteAt);
    expect(archived.length).toBeGreaterThan(0);
    await filter.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(filter).toHaveText('Archived');
    await expect
      .poll(() =>
        rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.listWorkspace).sort()),
      )
      .toEqual(archived.map((row) => row.id).sort());
    await input.fill(archived[0].id);
    await expect(rows).toHaveCount(1);
    await page.reload();
    await expect(filter).toHaveText('Archived');
    await expect(input).toHaveValue(archived[0].id);
    await expect(rows).toHaveCount(1);
    await input.press('Escape');
    await filter.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(filter).toHaveText('All workspaces');
    await expect(rows).toHaveCount(active.length);
    expect(new URL(page.url()).search).toBe('');
  } finally {
    await evidence(info);
  }
});
