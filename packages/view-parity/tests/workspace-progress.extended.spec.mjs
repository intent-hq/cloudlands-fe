import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('daemon task progress opens real task and spec notes without changing the filter', async ({
  page,
}, info) => {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real workspace environment');
  const errors = await observeErrors(page);
  const requests = [];
  const replies = [];
  const notes = [];
  let workspace;
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
      if (!request) return;
      pending.delete(response.id);
      replies.push({ request, response });
      if (request.method === 'workspace.list')
        workspace = response.result?.workspaces?.find((row) => row.id === workspaceId);
      if (request.method === 'note.list' && request.params.workspaceId === workspaceId)
        notes.splice(0, notes.length, ...response.result.notes);
    });
  });
  const query = 'retained-progress-filter';
  const fileQuery = 'package.json';
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?q=${query}&fileQuery=${fileQuery}`;
  const host = page.getByTestId('workspace-task-progress');
  const bar = host.getByRole('progressbar');
  const popup = page.locator('[data-tooltip-content]').filter({ visible: true });
  try {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(url);
    await expect(bar).toBeVisible({ timeout: 60_000 });
    expect(workspace.taskStats.total).toBeGreaterThan(0);
    await expect(bar).toHaveAttribute(
      'aria-valuenow',
      String(Math.round((workspace.taskStats.completed / workspace.taskStats.total) * 100)),
    );
    await expect(page.getByTestId('workspace-notes').locator('a[data-note-id]')).toHaveCount(0);
    await bar.hover();
    await expect(popup).toBeVisible();
    const firstTask = popup.getByRole('button').nth(1);
    const label = await firstTask.getAttribute('aria-label');
    const task = notes.find((note) => label.startsWith(`Open ${note.title}, `));
    expect(task?.id).toBeTruthy();
    await firstTask.click();
    const content = page.getByTestId('workspace-note');
    await expect(content).toHaveAttribute('data-note-id', task.id);
    expect(new URL(page.url()).searchParams.get('q')).toBe(query);
    expect(new URL(page.url()).searchParams.get('fileQuery')).toBe(fileQuery);
    await expect
      .poll(() =>
        replies.some(
          ({ request }) => request.method === 'note.get' && request.params.noteId === task.id,
        ),
      )
      .toBe(true);
    const read = replies.find(
      ({ request }) => request.method === 'note.get' && request.params.noteId === task.id,
    );
    expect(read.request.params).toEqual({ workspaceId, noteId: task.id });
    await content.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.getByTestId('note-content')).toHaveText(read.response.result.note.content);
    await page.getByRole('link', { name: 'All notes', exact: true }).click();
    const noteSearch = page.getByTestId('workspace-notes').getByRole('searchbox');
    await expect(noteSearch).toHaveValue(query);
    await expect(noteSearch).toBeFocused();
    await expect(page.getByTestId('workspace-git-status').getByRole('searchbox')).toHaveValue(
      fileQuery,
    );
    const trigger = host.getByRole('button');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(content).toHaveAttribute('data-note-id', 'spec');
    expect(new URL(page.url()).searchParams.get('q')).toBe(query);
    expect(new URL(page.url()).searchParams.get('fileQuery')).toBe(fileQuery);
    await page.goBack();
    await expect(bar).toBeVisible();
    await page.setViewportSize({ width: 420, height: 900 });
    await expect(bar).toBeInViewport();
    await bar.hover();
    await expect(popup).toBeVisible();
    const bounds = await popup.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(420);
    await page.evaluate(() => document.fonts.ready);
    const screenshot = info.outputPath('workspace-task-progress.png');
    await page.screenshot({ path: screenshot });
    await info.attach('workspace-task-progress', { path: screenshot, contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(noteSearch).toHaveValue(query);
    await expect(page.getByTestId('workspace-git-status').getByRole('searchbox')).toHaveValue(
      fileQuery,
    );
    await trigger.focus();
    await page.keyboard.press('Space');
    await expect(content).toHaveAttribute('data-note-id', 'spec');
    expect(requests.filter(({ method }) => method === 'task.list')).toEqual([]);
    expect(
      requests.filter(({ method }) =>
        /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('task-progress-wire', {
      body: JSON.stringify({ workspace, requests, replies, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
