import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('real workspace replaces its content loading status with daemon data and survives returning', async ({
  page,
}, info) => {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
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
  await page.addInitScript(() => {
    window.observedContentLoading = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const selector = '[data-testid="workspace-content-loading"]';
          const states = node.matches(selector) ? [node] : node.querySelectorAll(selector);
          for (const state of states)
            window.observedContentLoading.push({
              role: state.getAttribute('role'),
              label: state.getAttribute('aria-label'),
              hasSkeleton: Boolean(state.querySelector('[data-workspace-content-skeleton]')),
            });
        }
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}`;
  await page.goto(url);
  const overview = page.getByTestId('workspace-overview');
  await expect(overview.getByTestId('workspace-repository')).toBeVisible({ timeout: 60_000 });
  const listReply = replies.findLast(
    ({ request, response }) => request.method === 'workspace.list' && response.result,
  );
  expect(listReply).toBeDefined();
  const workspace = listReply.response.result.workspaces.find((row) => row.id === workspaceId);
  expect(workspace).toBeDefined();
  await expect(overview.getByRole('heading', { level: 1 })).toHaveText(workspace.title);
  await expect(overview.getByTestId('workspace-repository')).toHaveText(workspace.repositoryName);
  const observed = await page.evaluate(() => window.observedContentLoading);
  expect(observed.length).toBeGreaterThan(0);
  expect(
    observed.every((state) => state.role === 'status' && state.label && state.hasSkeleton),
  ).toBe(true);
  await expect(overview.getByTestId('workspace-content-loading')).toHaveCount(0);
  await overview.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page
    .getByTestId('workspace-list')
    .locator(`[data-list-workspace="${workspaceId}"]`)
    .click();
  await expect(page).toHaveURL(url);
  await expect(overview.getByRole('heading', { level: 1 })).toHaveText(workspace.title);
  await expect(overview.getByTestId('workspace-content-loading')).toHaveCount(0);
  expect(
    requests.filter(({ method }) =>
      /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
        method ?? '',
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('workspace-loading-real-wire', {
    body: JSON.stringify({ observed, requests, replies, errors }),
    contentType: 'application/json',
  });
  await page.evaluate(() => document.fonts.ready);
  const screenshot = info.outputPath('workspace-loaded.png');
  await page.screenshot({ path: screenshot });
  await info.attach('workspace-loaded', { path: screenshot, contentType: 'image/png' });
});
