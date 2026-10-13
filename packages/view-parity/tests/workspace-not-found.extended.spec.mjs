import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

for (const width of [1000, 390]) {
  test(`missing workspace recovers by keyboard with ${width === 390 ? 'collapsed' : 'visible'} sidebar`, async ({
    page,
  }, info) => {
    const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
    if (!base || !workspaceId) throw new Error('Set the real workspace environment');
    const missingId = `missing-workspace-${randomUUID()}`;
    const errors = await observeErrors(page);
    const requests = [];
    const replies = [];
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const request = JSON.parse(String(payload));
        requests.push(request);
        pending.set(request.id, request);
      });
      socket.on('framereceived', ({ payload }) => {
        const response = JSON.parse(String(payload));
        const request = pending.get(response.id);
        pending.delete(response.id);
        if (request) replies.push({ request, response });
      });
    });
    try {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`${base}/workspaces/${missingId}?q=retained-query`);
      const overview = page.getByTestId('workspace-overview');
      const missing = overview.locator('[data-resource-not-found="not_found"]');
      await expect(missing).toBeVisible({ timeout: 60_000 });
      const list = replies.findLast(({ request }) => request.method === 'workspace.list');
      expect(list.response.error).toBeUndefined();
      expect(list.response.result.workspaces.some((row) => row.id === missingId)).toBe(false);
      const existing = list.response.result.workspaces.find((row) => row.id === workspaceId);
      expect(existing).toBeDefined();
      await expect(missing.getByRole('status')).toBeVisible();
      await expect(page.getByTestId('workspace-note')).toHaveCount(0);
      await expect(page).toHaveURL(`${base}/workspaces/${missingId}?q=retained-query`);
      await overview.getByRole('link', { name: 'Workspaces', exact: true }).focus();
      await page.keyboard.press('Tab');
      const back = missing.getByRole('button', { name: 'All workspaces', exact: true });
      await expect(back).toBeFocused();
      expect(
        await back.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return (
            box.x >= 0 &&
            box.right <= window.innerWidth &&
            box.y >= 0 &&
            box.bottom <= window.innerHeight &&
            element.contains(hit)
          );
        }),
      ).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      const screenshot = info.outputPath(`missing-workspace-${width}.png`);
      await page.screenshot({ path: screenshot });
      await info.attach('missing-workspace', { path: screenshot, contentType: 'image/png' });
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${base}/workspaces`);
      const link = page
        .getByTestId('workspace-list')
        .locator(`a[href="/workspaces/${encodeURIComponent(workspaceId)}"]`);
      await expect(link).toContainText(existing.title);
      await link.click();
      await expect(overview).toHaveAttribute('data-workspace-id', workspaceId);
      await expect(overview.getByRole('heading', { level: 1 })).toHaveText(existing.title);
      await expect(missing).toHaveCount(0);
      expect(
        requests.filter(({ method }) =>
          /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await info.attach('missing-workspace-wire', {
        body: JSON.stringify({ requests, replies, errors }, null, 2),
        contentType: 'application/json',
      });
    }
  });
}
