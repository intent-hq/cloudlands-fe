import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('real workspace-list search survives Back and keeps note filtering separate', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
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
  try {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`${base}/workspaces/`);
    const list = page.getByTestId('workspace-list');
    const input = list.getByRole('searchbox');
    const rows = list.locator('[data-list-workspace]');
    const current = list.locator(`[data-list-workspace="${workspaceId}"]`);
    await expect
      .poll(() => workspaces.some((row) => row.id === workspaceId), { timeout: 60_000 })
      .toBe(true);
    const activeCount = workspaces.filter(
      (row) => !['Archived', 'Deleted'].includes(row.status) && !row.pendingDeleteAt,
    ).length;
    await expect(rows).toHaveCount(activeCount);
    const workspace = workspaces.find((row) => row.id === workspaceId);
    await input.pressSequentially(workspaceId.toUpperCase());
    await expect(input).toHaveValue(workspaceId.toUpperCase());
    await expect(current).toBeVisible();
    await expect.poll(() => rows.count()).toBeLessThan(activeCount);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe(workspaceId.toUpperCase());
    await current.focus();
    await page.keyboard.press('Enter');
    const overview = page.getByTestId('workspace-overview');
    await expect(overview).toHaveAttribute('data-workspace-id', workspaceId);
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText(workspace.title);
    expect(new URL(page.url()).search).toBe('');
    await expect(
      page.getByTestId('workspace-notes').locator('[data-note-id]').first(),
    ).toBeVisible();
    await page.goBack();
    await expect(input).toHaveValue(workspaceId.toUpperCase());
    await expect(current).toBeVisible();
    await input.focus();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(rows).toHaveCount(activeCount);
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
    await input.fill('no-workspace-matches-35c7d04c');
    await expect(rows).toHaveCount(0);
    await expect(list.locator('output')).toBeVisible();
    await list.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(rows).toHaveCount(activeCount);
    await input.fill(workspace.title.toUpperCase());
    await expect(current).toBeVisible();
    await page.reload();
    await expect(input).toHaveValue(workspace.title.toUpperCase());
    await expect(current).toBeVisible();
    await page.setViewportSize({ width: 420, height: 800 });
    const clear = list.getByRole('button', { name: 'Clear search', exact: true });
    await expect(input).toBeInViewport();
    await expect(clear).toBeInViewport();
    await input.focus();
    await page.keyboard.press('Tab');
    await expect(clear).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await input.fill(workspaceId);
    await expect(current).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
    await page.evaluate(() => document.fonts.ready);
    const screenshot = info.outputPath('workspace-list-search.png');
    await page.screenshot({ path: screenshot });
    await info.attach('workspace-list-search', { path: screenshot, contentType: 'image/png' });
    expect(
      requests.filter(({ method }) =>
        /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('workspace-list-search-wire', {
      body: JSON.stringify({ requests, workspaces, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
