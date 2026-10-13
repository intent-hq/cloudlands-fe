import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('home loading keeps keyboard access and follows native motion changes across remount', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(`${base}/sandbox/home-loading?example=interactive`);
  const demo = page.getByTestId('home-loading-demo');
  const status = demo.getByRole('status');
  const detail = demo.getByRole('button', { name: 'Detail layout', exact: true });
  const show = demo.getByRole('button', { name: 'Show loading', exact: true });
  await expect(status).toBeVisible();
  await expect(status).toHaveAccessibleName(/\S/);
  await detail.focus();
  await page.keyboard.press('Tab');
  await expect(show).toBeFocused();
  const original = await status.elementHandle();
  await detail.click();
  await expect(detail).toHaveAttribute('aria-pressed', 'true');
  expect(await status.evaluate((node, first) => node === first, original)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const running = () =>
    status.evaluate(
      (node) =>
        node
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
    );
  await expect.poll(running).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(running).toBe(0);
  await show.click();
  await expect(status).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await show.click();
  await expect(status).toBeVisible();
  await expect.poll(running).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(running).toBe(0);
  await detail.click();
  await expect(detail).toHaveAttribute('aria-pressed', 'false');
  await detail.focus();
  await page.keyboard.press('Tab');
  await expect(show).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await stableLocatorScreenshot(page, demo, async ({ png, attempt }) => {
    if (png) await info.attach(`home-loading-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await original.dispose();
  expect(errors).toEqual([]);
});

test('real workspace list replaces its loading status with daemon rows', async ({ page }, info) => {
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
  await page.addInitScript(() => {
    window.observedHomeLoading = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const states = node.matches('[data-home-loading]')
            ? [node]
            : node.querySelectorAll('[data-home-loading]');
          for (const state of states)
            window.observedHomeLoading.push({
              role: state.getAttribute('role'),
              label: state.getAttribute('aria-label'),
            });
        }
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  });
  await page.goto(`${base}/workspaces`);
  const list = page.getByTestId('workspace-list');
  await expect(list.locator(`[data-list-workspace="${workspaceId}"]`)).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(() => workspaces.some((row) => row.id === workspaceId)).toBe(true);
  await expect(list.locator('[data-list-workspace]')).toHaveCount(workspaces.length);
  const observed = await page.evaluate(() => window.observedHomeLoading);
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every(({ role, label }) => role === 'status' && Boolean(label))).toBe(true);
  await expect(list.locator('[data-home-loading]')).toHaveCount(0);
  await expect(list.locator(`[data-list-workspace="${workspaceId}"]`)).toContainText(
    workspaces.find((row) => row.id === workspaceId).title,
  );
  expect(
    requests.filter(({ method }) =>
      /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
        method ?? '',
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('home-loading-real-wire', {
    body: JSON.stringify({ requests, workspaces, observed, errors }, null, 2),
    contentType: 'application/json',
  });
});
