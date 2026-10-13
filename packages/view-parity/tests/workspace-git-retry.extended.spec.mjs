import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('Git refresh recovers real rows without losing or stealing keyboard focus', async ({
  page,
}, info) => {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real workspace environment');
  const requests = [];
  const replies = [];
  const errors = await observeErrors(page);
  let failReads = true;
  let holdNext = false;
  let release;
  const failure = 'Temporary Git status failure for retry coverage';
  await page.routeWebSocket('**/intentd/ws', (socket) => {
    const server = socket.connectToServer();
    const pending = new Map();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      requests.push(request);
      pending.set(request.id, request);
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (request?.method === 'git.status' && request.params.workspaceId === workspaceId) {
        const delivered = failReads
          ? { jsonrpc: '2.0', id: response.id, error: { code: -32603, message: failure } }
          : response;
        replies.push({ request, response: delivered });
        if (holdNext) {
          holdNext = false;
          release = () => socket.send(JSON.stringify(delivered));
        } else socket.send(JSON.stringify(delivered));
      } else socket.send(message);
    });
  });
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?q=${workspaceId}`;
  const view = page.getByTestId('workspace-git-status');
  const refresh = view.getByRole('button');
  try {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(url);
    await expect(view.getByRole('alert')).toBeVisible({ timeout: 60_000 });
    await expect(refresh).toBeEnabled();
    const initialReads = replies.length;
    expect(initialReads).toBeGreaterThan(0);
    expect(replies.at(-1).response.error.message).toBe(failure);
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => replies.length).toBe(initialReads + 1);
    await expect(refresh).toBeEnabled();
    await expect(refresh).toBeFocused();
    await expect(view.getByRole('alert')).toBeVisible();
    expect(replies.at(-1).response.error.message).toBe(failure);
    failReads = false;
    await page.keyboard.press('Enter');
    await expect.poll(() => replies.length).toBe(initialReads + 2);
    await expect(refresh).toBeEnabled();
    await expect(refresh).toBeFocused();
    await expect(view.getByRole('alert')).toHaveCount(0);
    const recovered = replies.at(-1).response;
    expect(recovered.error).toBeUndefined();
    expect(recovered.result.files.length).toBeGreaterThan(0);
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
      .toEqual(
        recovered.result.files.map(({ path, status, staged }) => ({ path, status, staged })),
      );
    await page.evaluate(() => document.fonts.ready);
    const screenshot = info.outputPath('git-retry-recovered.png');
    await page.screenshot({ path: screenshot });
    await info.attach('git-retry-recovered', { path: screenshot, contentType: 'image/png' });
    holdNext = true;
    await page.keyboard.press('Enter');
    await expect.poll(() => !!release).toBe(true);
    await expect(refresh).toBeDisabled();
    const search = page.getByTestId('workspace-notes').getByRole('searchbox');
    await search.click();
    release();
    release = undefined;
    await expect(refresh).toBeEnabled();
    await expect(search).toBeFocused();
    await expect(page).toHaveURL(url);
    expect(replies).toHaveLength(initialReads + 3);
    for (const { request } of replies.slice(initialReads))
      expect(request.params).toEqual({ workspaceId, forceRefresh: true });
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors.filter((error) => !error.includes(failure))).toEqual([]);
  } finally {
    release?.();
    await info.attach('git-retry-wire', {
      body: JSON.stringify({ requests, replies, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
