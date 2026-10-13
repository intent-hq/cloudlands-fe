import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('real workspace status tooltip keeps keyboard navigation and retires on filtering and route exit', async ({
  page,
}, info) => {
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
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto(`${base}/workspaces`);
    const list = page.getByTestId('workspace-list');
    const input = list.getByRole('searchbox');
    const row = list.locator(`[data-list-workspace="${workspaceId}"]`);
    const status = row.getByRole('img');
    const tooltip = page.getByRole('tooltip');
    await expect
      .poll(() => workspaces.some((workspace) => workspace.id === workspaceId), {
        timeout: 60_000,
      })
      .toBe(true);
    await input.fill(workspaceId);
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Tab');
    await expect(status).toBeFocused();
    await expect(tooltip).toBeVisible();
    const explanation = (await tooltip.innerText()).trim();
    expect(explanation.length).toBeGreaterThan(0);
    expect(await status.getAttribute('aria-label')).toContain(explanation);
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(status).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(row).toBeFocused();
    await page.keyboard.press('Enter');
    const overview = page.getByTestId('workspace-overview');
    await expect(overview).toHaveAttribute('data-workspace-id', workspaceId);
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText(
      workspaces.find((workspace) => workspace.id === workspaceId).title,
    );
    await expect(tooltip).toHaveCount(0);
    await page.goBack();
    await expect(input).toHaveValue(workspaceId);
    await row.focus();
    await page.keyboard.press('Tab');
    await expect(status).toBeFocused();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
    await page.evaluate(() => document.fonts.ready);
    const screenshot = info.outputPath('workspace-home-status.png');
    await page.screenshot({ path: screenshot });
    await info.attach('workspace-home-status', { path: screenshot, contentType: 'image/png' });
    await input.fill('no-workspace-for-status-retirement-23f21');
    await expect(row).toHaveCount(0);
    await expect(tooltip).toHaveCount(0);
    expect(
      requests.filter(({ method }) =>
        /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('workspace-home-status-wire', {
      body: JSON.stringify({ requests, workspaces, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
