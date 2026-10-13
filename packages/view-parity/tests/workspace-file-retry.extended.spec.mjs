import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('file read retries restore keyboard focus and preserve the note return route', async ({
  page,
}, info) => {
  const {
    REACT_BASE_URL: base,
    REACT_WORKSPACE_ID: workspaceId,
    REACT_NOTE_ID: noteId,
  } = process.env;
  if (!base || !workspaceId || !noteId) throw new Error('Set the real workspace environment');
  const path = 'apps/react/src/features/workspace/workspace-git-status.tsx';
  const requests = [];
  const replies = [];
  const errors = await observeErrors(page);
  let failReads = true;
  const failure = 'Temporary file read failure for retry coverage';
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
      if (
        request?.method === 'file.read' &&
        request.params.workspaceId === workspaceId &&
        request.params.path === path
      ) {
        const delivered = failReads
          ? { jsonrpc: '2.0', id: response.id, error: { code: -32603, message: failure } }
          : response;
        replies.push({ request, response: delivered });
        socket.send(JSON.stringify(delivered));
      } else socket.send(message);
    });
  });
  const search = new URLSearchParams({ file: path, note: noteId, q: noteId, line: '1' });
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?${search}`;
  const view = page.getByTestId('workspace-file');
  const retry = view.getByRole('button', { name: 'Retry', exact: true });
  const content = page.getByTestId('workspace-file-content');
  const assertRoute = () => {
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(
      Object.fromEntries(search),
    );
  };
  try {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(url);
    await expect(retry).toBeFocused({ timeout: 60_000 });
    const initialReads = replies.length;
    expect(initialReads).toBe(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => replies.length).toBe(initialReads + 1);
    await expect(retry).toBeFocused();
    await expect(view.getByRole('alert')).toContainText(failure);
    await expect(content).toHaveCount(0);
    assertRoute();
    await page.evaluate(() => document.fonts.ready);
    const errorShot = info.outputPath('file-retry-error.png');
    await page.screenshot({ path: errorShot });
    await info.attach('file-retry-error', { path: errorShot, contentType: 'image/png' });
    failReads = false;
    await page.keyboard.press('Enter');
    await expect(view.getByRole('heading', { name: path, exact: true })).toBeFocused();
    expect(replies).toHaveLength(initialReads + 2);
    for (const { request } of replies) expect(request.params).toEqual({ workspaceId, path });
    const read = replies.at(-1).response;
    expect(read.error).toBeUndefined();
    expect(typeof read.result).toBe('string');
    await expect
      .poll(() => content.locator('.code-line').allTextContents())
      .toEqual(read.result.split('\n').map((line) => line || ' '));
    await expect(retry).toHaveCount(0);
    await expect(view.getByRole('alert')).toHaveCount(0);
    assertRoute();
    const recoveredShot = info.outputPath('file-retry-recovered.png');
    await page.screenshot({ path: recoveredShot });
    await info.attach('file-retry-recovered', {
      path: recoveredShot,
      contentType: 'image/png',
    });
    await view.getByRole('link', { name: 'Back', exact: true }).click();
    const note = page.getByTestId('workspace-note');
    await expect(note).toHaveAttribute('data-note-id', noteId);
    await expect(note.locator('header').getByRole('heading')).toBeFocused();
    expect(new URL(page.url()).searchParams.get('q')).toBe(noteId);
    expect(
      requests.filter(({ method }) =>
        /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors.filter((error) => !error.includes(failure))).toEqual([]);
  } finally {
    await info.attach('file-retry-wire', {
      body: JSON.stringify({ requests, replies, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
