import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

for (const route of ['list', 'note']) {
  test(`${route} route explains real connection loss and resumes without navigation`, async ({
    page,
  }, info) => {
    const {
      REACT_BASE_URL: base,
      REACT_WORKSPACE_ID: workspaceId,
      REACT_NOTE_ID: noteId,
    } = process.env;
    if (!base || !workspaceId || !noteId) throw new Error('Set the real workspace environment');
    const errors = await observeErrors(page);
    const requests = [];
    const replies = [];
    const sockets = [];
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      sockets.push(socket);
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
    const url =
      route === 'list'
        ? `${base}/workspaces`
        : `${base}/workspaces/${encodeURIComponent(workspaceId)}?note=${noteId}&q=${noteId}`;
    const disconnected = page.getByTestId('workspace-connection-lost');
    const note = page.getByTestId('workspace-note');
    const workspaceLink = page
      .getByTestId('workspace-list')
      .locator(`a[href="/workspaces/${encodeURIComponent(workspaceId)}"]`);
    const data = route === 'list' ? workspaceLink : note;
    try {
      await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.goto(url);
      await expect(data).toBeVisible({ timeout: 60_000 });
      await expect(disconnected).toHaveCount(0);
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
      await expect(disconnected).toBeVisible();
      await expect(disconnected).toHaveAttribute('role', 'status');
      await expect(data).toHaveCount(0);
      await expect(page.getByTestId('workspace-navigation').getByRole('link')).toHaveCount(0);
      await expect(page).toHaveURL(url);
      await page.evaluate(() => document.fonts.ready);
      const screenshot = info.outputPath(`workspace-${route}-disconnected.png`);
      await page.screenshot({ path: screenshot });
      await info.attach('workspace-disconnected', { path: screenshot, contentType: 'image/png' });
      const beforeReconnect = requests.length;
      const beforeSockets = sockets.length;
      await page.context().setOffline(false);
      await expect(data).toBeVisible({ timeout: 30_000 });
      await expect(disconnected).toHaveCount(0);
      await expect(page).toHaveURL(url);
      expect(sockets.length).toBeGreaterThan(beforeSockets);
      expect(
        requests.slice(beforeReconnect).some(({ method }) => method === 'workspace.list'),
      ).toBe(true);
      if (route === 'note') {
        const read = replies.findLast(
          ({ request }) => request.method === 'note.get' && request.params.noteId === noteId,
        );
        expect(read.request.params).toEqual({ workspaceId, noteId });
        await note.getByRole('button', { name: 'Source', exact: true }).click();
        await expect(page.getByTestId('note-content')).toHaveText(
          read.response.result.note.content,
        );
      } else {
        const list = replies.findLast(({ request }) => request.method === 'workspace.list');
        const workspace = list.response.result.workspaces.find((row) => row.id === workspaceId);
        await expect(workspaceLink).toContainText(workspace.title);
      }
      expect(
        requests.filter(({ method }) =>
          /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.context().setOffline(false);
      await info.attach('workspace-connection-wire', {
        body: JSON.stringify({ requests, replies, errors }, null, 2),
        contentType: 'application/json',
      });
    }
  });
}
