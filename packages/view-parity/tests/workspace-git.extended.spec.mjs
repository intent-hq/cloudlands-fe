import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('real Git status refreshes and releases workspace state', async ({ page }, info) => {
  const baseUrl = process.env.REACT_BASE_URL;
  const workspaceId = process.env.REACT_WORKSPACE_ID;
  if (!baseUrl || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const errors = await observeErrors(page);
  const requests = [];
  const pending = new Map();
  const statuses = [];
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
      if (request?.method === 'git.status' && request.params.workspaceId === workspaceId)
        statuses.push({ request, response });
    });
  });
  const readState = () =>
    page.evaluate(async (id) => {
      const module = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname.endsWith('/src/store/index.ts'));
      if (!module) throw new Error('The running Store was not observed');
      const { store } = await import(module.name);
      return store.state.git.byWorkspaceId[id] ?? null;
    }, workspaceId);
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(2000));
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}`);
    const view = page.getByTestId('workspace-git-status');
    await expect.poll(() => statuses.length, { timeout: 60_000 }).toBeGreaterThan(0);
    expect(statuses[0].request.params).toEqual({ workspaceId });
    expect(statuses[0].response.error).toBeUndefined();
    const assertFiles = async (status) => {
      await expect
        .poll(() =>
          view.locator('[data-git-staged]').evaluateAll((rows) =>
            rows.map((row) => ({
              path: row.getAttribute('data-git-path'),
              status: row.querySelector('[data-git-status]').textContent,
              staged: row.getAttribute('data-git-staged') === 'true',
            })),
          ),
        )
        .toEqual(status.files.map(({ path, status, staged }) => ({ path, status, staged })));
    };
    await assertFiles(statuses[0].response.result);
    const beforeRefresh = statuses.length;
    await view.locator('[data-changes-refresh]').click();
    await expect.poll(() => statuses.length).toBeGreaterThan(beforeRefresh);
    expect(statuses.at(-1).request.params).toEqual({ workspaceId, forceRefresh: true });
    await assertFiles(statuses.at(-1).response.result);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath('real-git-status.png') });
    await info.attach('real-git-status', {
      path: info.outputPath('real-git-status.png'),
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 420, height: 900 });
    await expect
      .poll(() => view.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    await expect(view.locator('[data-changes-refresh]')).toBeVisible();
    await page.screenshot({ path: info.outputPath('real-git-status-narrow.png') });
    await info.attach('real-git-status-narrow', {
      path: info.outputPath('real-git-status-narrow.png'),
      contentType: 'image/png',
    });
    await expect.poll(async () => (await readState())?.status).toBeTruthy();
    await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await expect(view).toHaveCount(0);
    await expect.poll(readState).toBeNull();
    const beforeReturn = statuses.length;
    await page.locator(`a[href="/workspaces/${encodeURIComponent(workspaceId)}"]`).click();
    await expect.poll(() => statuses.length).toBeGreaterThan(beforeReturn);
    await assertFiles(statuses.at(-1).response.result);
    await page.evaluate(async () => {
      const module = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname.endsWith('/backend-transport-factory.ts'));
      if (!module) throw new Error('The real backend transport was not observed');
      const { resolveBackendTransport } = await import(module.name);
      const socket = resolveBackendTransport().socket;
      if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
        throw new Error('Expected the actual open daemon socket');
      await new Promise((resolve) => {
        socket.addEventListener('close', resolve, { once: true });
        socket.close();
      });
    });
    await page.context().setOffline(true);
    await expect.poll(readState).toBeNull();
    await expect(view).toHaveCount(0);
    const beforeReconnect = statuses.length;
    await page.context().setOffline(false);
    await expect.poll(() => statuses.length, { timeout: 30_000 }).toBeGreaterThan(beforeReconnect);
    await assertFiles(statuses.at(-1).response.result);
    expect(
      requests.filter((request) =>
        /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
          request.method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('git-status-wire', {
      body: JSON.stringify({ requests, statuses, errors, state: await readState() }, null, 2),
      contentType: 'application/json',
    });
  }
});
