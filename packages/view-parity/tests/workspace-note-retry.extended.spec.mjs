import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

for (const method of ['note.get', 'note.list']) {
  test(`${method} failure retries in place and recovers real content`, async ({ page }, info) => {
    const {
      REACT_BASE_URL: base,
      REACT_WORKSPACE_ID: workspaceId,
      REACT_NOTE_ID: noteId,
    } = process.env;
    if (!base || !workspaceId || !noteId) throw new Error('Set the real note journey environment');
    const errors = await observeErrors(page);
    const requests = [];
    const replies = [];
    let failReads = true;
    const failure = `Temporary ${method} failure for retry coverage`;
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
          request?.method === method &&
          request.params.workspaceId === workspaceId &&
          (method === 'note.list' || request.params.noteId === noteId)
        ) {
          const delivered = failReads
            ? { jsonrpc: '2.0', id: response.id, error: { code: -32603, message: failure } }
            : response;
          replies.push({ request, response: delivered });
          socket.send(JSON.stringify(delivered));
        } else socket.send(message);
      });
    });
    const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?note=${encodeURIComponent(noteId)}&q=${encodeURIComponent(noteId)}`;
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    try {
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.goto(url);
      await expect(retry).toBeVisible({ timeout: 60_000 });
      const initialReads = replies.length;
      expect(initialReads).toBeGreaterThan(0);
      await expect(page.getByTestId('workspace-note')).toHaveCount(0);
      await expect(retry).toBeFocused();
      await retry.click();
      await expect.poll(() => replies.length).toBe(initialReads + 1);
      await expect(retry).toBeVisible();
      await expect(retry).toBeFocused();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page).toHaveURL(url);
      await page.evaluate(() => document.fonts.ready);
      const failedScreenshot = info.outputPath('note-retry-error.png');
      await page.screenshot({ path: failedScreenshot });
      await info.attach('note-retry-error', { path: failedScreenshot, contentType: 'image/png' });
      expect(replies.at(-1).response.error.message).toBe(failure);
      failReads = false;
      await page.keyboard.press('Enter');
      const note = page.getByTestId('workspace-note');
      await expect(note).toHaveAttribute('data-note-id', noteId);
      expect(replies).toHaveLength(initialReads + 2);
      for (const { request } of replies) {
        expect(request.method).toBe(method);
        expect(request.params).toEqual(
          method === 'note.get' ? { workspaceId, noteId } : { workspaceId, projection: 'slim' },
        );
      }
      expect(replies.at(-1).response.error).toBeUndefined();
      const result = replies.at(-1).response.result;
      const title =
        method === 'note.get'
          ? result.note.title
          : result.notes.find((row) => row.id === noteId).title;
      await expect(
        note.getByRole('heading', { level: 2, name: title, exact: true }).first(),
      ).toBeFocused();
      await expect(page).toHaveURL(url);
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      if (method === 'note.get') {
        await note.getByRole('button', { name: 'Source', exact: true }).click();
        await expect(page.getByTestId('note-content')).toHaveText(
          replies.at(-1).response.result.note.content,
        );
      } else await expect(page.getByTestId('note-rendered-content')).toBeVisible();
      const recoveredScreenshot = info.outputPath('note-retry-recovered.png');
      await page.screenshot({ path: recoveredScreenshot });
      await info.attach('note-retry-recovered', {
        path: recoveredScreenshot,
        contentType: 'image/png',
      });
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await expect(page.getByRole('searchbox')).toHaveValue(noteId);
      await expect(page.locator(`a[data-note-id="${noteId}"]`)).toBeFocused();
      expect(
        requests.filter(({ method: name }) =>
          /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
            name ?? '',
          ),
        ),
      ).toEqual([]);
      expect(errors.filter((error) => !error.includes(failure))).toEqual([]);
    } finally {
      await info.attach('note-retry-wire', {
        body: JSON.stringify({ requests, replies, errors }, null, 2),
        contentType: 'application/json',
      });
    }
  });
}
