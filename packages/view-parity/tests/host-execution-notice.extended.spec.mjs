import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('host notices remain absent for the real owner across prop changes, reconnection and workspace navigation', async ({
  page,
}, info) => {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real workspace environment');
  await page.setViewportSize({ width: 1000, height: 900 });
  const errors = await observeErrors(page);
  const methods = [];
  const principals = [];
  const sockets = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    sockets.push(socket);
    const pending = new Map();
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      methods.push(request.method);
      pending.set(request.id, request.method);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      const method = pending.get(response.id);
      pending.delete(response.id);
      if (method === 'principal.me' && response.result) principals.push(response.result);
    });
  });
  await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
  await page.goto(`${base}/sandbox/model-picker?example=interactive&theme=light&motion=reduced`);
  const demo = page.getByTestId('host-notice-demo');
  const frame = demo.getByTestId('host-notice-frame');
  const state = async () =>
    JSON.parse(await demo.getByRole('status', { name: 'Actual host state' }).textContent());
  try {
    await expect.poll(async () => (await state()).role, { timeout: 30_000 }).toBe('owner');
    await expect.poll(() => principals.length).toBeGreaterThan(0);
    expect(
      principals.at(-1).hostRole === 'owner' || principals.at(-1).isAdministrator === true,
    ).toBe(true);
    const initial = await state();
    await demo.scrollIntoViewIfNeeded();
    const before = await demo.boundingBox();
    for (const kind of ['git-policy', 'repository', 'ai']) {
      await demo.getByRole('button', { name: kind, exact: true }).press('Enter');
      await expect(demo.getByRole('button', { name: kind, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(frame.getByRole('status')).toHaveCount(0);
    }
    await demo.getByRole('button', { name: 'Mount notice', exact: true }).press('Space');
    await demo.getByRole('button', { name: 'Mount notice', exact: true }).press('Space');
    await expect(frame.getByRole('status')).toHaveCount(0);
    await page.evaluate(async () => {
      const module = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname.endsWith('/backend-transport-factory.ts'));
      if (!module) throw new Error('The real backend transport was not observed');
      const { resolveBackendTransport } = await import(module.name);
      const socket = resolveBackendTransport().socket;
      if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
        throw new Error('Expected the real daemon socket');
      await new Promise((resolve) => {
        socket.addEventListener('close', resolve, { once: true });
        socket.close();
      });
    });
    await page.context().setOffline(true);
    await expect.poll(async () => (await state()).role).toBe(null);
    await expect(frame.getByRole('status')).toHaveCount(0);
    const disconnected = await state();
    const socketCount = sockets.length;
    await page.context().setOffline(false);
    await expect.poll(async () => (await state()).role, { timeout: 30_000 }).toBe('owner');
    expect(sockets.length).toBeGreaterThan(socketCount);
    await expect(frame.getByRole('status')).toHaveCount(0);
    await demo.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await info.attach('host-notice-state-and-geometry.json', {
      body: JSON.stringify({
        initial,
        disconnected,
        restored: await state(),
        before,
        after: await demo.boundingBox(),
        unverified: [
          'real member identity and visible notice branches',
          'guest identity',
          'source paired pixels',
        ],
      }),
      contentType: 'application/json',
    });
    await stableLocatorScreenshot(page, demo, async ({ png, attempt }) => {
      if (png) await info.attach(`host-owner-${attempt}`, { body: png, contentType: 'image/png' });
    });
    await demo.getByRole('link', { name: 'Open workspaces', exact: true }).click();
    await page
      .getByTestId('workspace-list')
      .locator(`a[href="/workspaces/${encodeURIComponent(workspaceId)}"]`)
      .click();
    await expect(page.getByTestId('workspace-git-status')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workspace-git-status').locator('p[role="status"]')).toHaveCount(
      0,
    );
    await page.goBack();
    await page.goBack();
    await expect.poll(async () => (await state()).role).toBe('owner');
    await expect(frame.getByRole('status')).toHaveCount(0);
    expect(
      methods.filter((method) =>
        /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.context().setOffline(false);
    await info.attach('host-notice-read-methods.json', {
      body: JSON.stringify({ methods, socketCount: sockets.length, errors }),
      contentType: 'application/json',
    });
  }
});
