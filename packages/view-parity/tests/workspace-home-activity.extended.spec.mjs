import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test.use({ timezoneId: 'UTC', locale: 'en-US' });

test('real workspace activity matches daemon timestamps and survives filtering and route return', async ({
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
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto(`${base}/workspaces`);
    const list = page.getByTestId('workspace-list');
    const search = list.getByRole('searchbox');
    await expect
      .poll(() => workspaces.some((row) => row.id === workspaceId), { timeout: 60_000 })
      .toBe(true);
    await search.fill(workspaceId);
    const workspace = workspaces.find((row) => row.id === workspaceId);
    const contentDate = Date.parse(workspace.lastContentActivity ?? '');
    const expectedDate =
      Number.isFinite(contentDate) && contentDate > 0
        ? contentDate
        : Date.parse(workspace.createdAt);
    expect(Number.isFinite(expectedDate) && expectedDate > 0).toBe(true);
    const reason =
      expectedDate === contentDate ? 'Conversation or note activity' : 'Workspace created';
    const activity = list.locator(`[data-workspace-activity="${workspaceId}"]`);
    const row = list.locator(`[data-list-workspace="${workspaceId}"]`);
    await expect(activity.getByLabel(reason, { exact: true })).toBeVisible();
    expect(await activity.evaluate((node) => Boolean(node.closest('a')))).toBe(false);
    await activity.scrollIntoViewIfNeeded();
    await stableLocatorScreenshot(page, list, async ({ png, attempt }) => {
      if (png)
        await info.attach(`real-home-activity-${attempt}`, { body: png, contentType: 'image/png' });
    });
    const oldActivity = await activity.elementHandle();
    await row.focus();
    await page.keyboard.press('Tab');
    await expect(row.getByRole('img')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(activity.getByLabel(reason, { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const dateTrigger = activity.locator('[data-slot="tooltip-trigger"]').nth(1);
    await expect(dateTrigger).toBeFocused();
    const dateTooltip = page
      .getByRole('tooltip')
      .filter({ hasText: new Date(expectedDate).getUTCFullYear().toString() });
    await expect(dateTooltip).toBeVisible();
    const displayedDate = await dateTooltip.innerText();
    expect(Date.parse(`${displayedDate} UTC`)).toBe(Math.floor(expectedDate / 1000) * 1000);
    await search.fill('no-workspace-for-activity-retirement-6125');
    await expect(activity).toHaveCount(0);
    expect(await oldActivity.evaluate((node) => node.isConnected)).toBe(false);
    await expect(dateTooltip).toHaveCount(0);
    await search.fill(workspaceId);
    await expect(activity).toBeVisible();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('workspace-overview')).toHaveAttribute(
      'data-workspace-id',
      workspaceId,
    );
    await expect(activity).toHaveCount(0);
    await page.goBack();
    await expect(search).toHaveValue(workspaceId);
    await expect(activity.getByLabel(reason, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      requests.filter(({ method }) =>
        /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('workspace-home-activity-wire.json', {
      body: JSON.stringify({ requests, workspaces, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
