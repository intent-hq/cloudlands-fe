import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real changed-file search survives refresh, file return and reload without extra reads', async ({
  page,
}, info) => {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real workspace environment');
  const errors = await observeErrors(page);
  const reads = [];
  const methods = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    const pending = new Map();
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      methods.push(request.method);
      pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (
        request?.method === 'git.status' &&
        request.params.workspaceId === workspaceId &&
        response.result
      )
        reads.push({ request, status: response.result });
    });
  });
  await page.setViewportSize({ width: 420, height: 1000 });
  await page.goto(`${base}/workspaces/${encodeURIComponent(workspaceId)}`);
  const view = page.getByTestId('workspace-git-status');
  const search = view.locator('[data-sidebar-search="files"]');
  const input = search.getByRole('searchbox');
  await expect.poll(() => reads.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const target = reads.at(-1).status.files.find((file) => file.path === 'package.json');
  expect(
    target,
    'The real checkout must have the preserved package.json work in progress',
  ).toBeTruthy();
  const expected = reads
    .at(-1)
    .status.files.filter((file) => file.path.toLowerCase().includes('package.json'))
    .map((file) => file.path);
  const rows = () =>
    view
      .locator('a[data-file-path]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-file-path')));
  await view.scrollIntoViewIfNeeded();
  const before = await view.locator('header').boundingBox();
  await search.getByRole('button').click();
  await expect(input).toBeFocused();
  const initialReads = reads.length;
  const query = '  PACKAGE.JSON  ';
  await input.fill(query);
  await expect.poll(rows).toEqual(expected);
  await expect(page).toHaveURL((url) => url.searchParams.get('fileQuery') === query);
  await input.fill('no-existing-file-' + randomUUID());
  await expect.poll(rows).toEqual([]);
  await expect(view).toContainText('No results found');
  await input.fill(query);
  await expect.poll(rows).toEqual(expected);
  expect(reads.length).toBe(initialReads);
  await view.locator('a[data-file-path="package.json"]').first().click();
  const file = page.getByTestId('workspace-file');
  await expect(page.getByTestId('workspace-file-content')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('file') === target.path && url.searchParams.get('fileQuery') === query,
  );
  await file.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(input).toHaveValue(query);
  await expect.poll(rows).toEqual(expected);
  await expect(view.locator('a[data-file-path="package.json"]').first()).toBeFocused();
  expect(reads.length).toBe(initialReads);
  await view.locator('[data-changes-refresh]').click();
  await expect.poll(() => reads.length).toBeGreaterThan(initialReads);
  await expect(input).toHaveValue(query);
  await expect.poll(rows).toEqual(expected);
  await page.reload();
  await expect(input).toHaveValue(query, { timeout: 30_000 });
  await expect.poll(rows).toEqual(expected);
  await view.locator('header').scrollIntoViewIfNeeded();
  const after = await view.locator('header').boundingBox();
  expect(await view.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await stableLocatorScreenshot(page, view, async ({ png, attempt }) => {
    if (png) await info.attach(`git-search-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await input.focus();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(search.getByRole('button')).toBeFocused();
  await expect(page).toHaveURL((url) => !url.searchParams.has('fileQuery'));
  await expect.poll(rows).toEqual(reads.at(-1).status.files.map((file) => file.path));
  expect(
    methods.filter((method) =>
      /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
        method ?? '',
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('git-search-evidence.json', {
    body: JSON.stringify({
      before,
      after,
      reads: reads.map(({ request }) => request.params),
      methods,
      expected,
      errors,
    }),
    contentType: 'application/json',
  });
});

test('independent workspace filters survive real note and linked-note navigation', async ({
  page,
}, info) => {
  const {
    REACT_BASE_URL: base,
    REACT_WORKSPACE_ID: workspaceId,
    REACT_LINK_NOTE_ID: noteId,
  } = process.env;
  if (!base || !workspaceId || !noteId)
    throw new Error('Set the real workspace and linked-note environment');
  const errors = await observeErrors(page);
  const methods = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    socket.on('framesent', ({ payload }) => methods.push(JSON.parse(String(payload)).method));
  });
  await page.setViewportSize({ width: 420, height: 1000 });
  await page.goto(`${base}/workspaces/${encodeURIComponent(workspaceId)}?fileQuery=package.json`);
  const git = page.getByTestId('workspace-git-status');
  const notes = page.getByTestId('workspace-notes');
  const fileInput = git.getByRole('searchbox');
  const noteInput = notes.getByRole('searchbox');
  await expect(fileInput).toHaveValue('package.json', { timeout: 30_000 });
  await notes.locator('[data-sidebar-search="context"]').getByRole('button').click();
  await noteInput.fill(noteId);
  const targetNote = notes.locator(`a[data-note-id="${noteId}"]`);
  await expect(targetNote).toHaveCount(1);
  await expect(notes.locator('a[data-note-id="spec"]')).toHaveCount(1);
  await expect(fileInput).toHaveValue('package.json');
  const before = await notes.locator('header').boundingBox();
  await targetNote.click();
  const article = page.getByTestId('workspace-note');
  await expect(article).toHaveAttribute('data-note-id', noteId, { timeout: 30_000 });
  await expect(article.getByRole('heading').first()).toBeFocused();
  expect(new URL(page.url()).searchParams.get('fileQuery')).toBe('package.json');
  await article.getByRole('link', { name: 'Recovery', exact: true }).click();
  await expect(article).not.toHaveAttribute('data-note-id', noteId);
  await expect(article.getByRole('heading').first()).toBeFocused();
  expect(new URL(page.url()).searchParams.get('q')).toBe(noteId);
  expect(new URL(page.url()).searchParams.get('fileQuery')).toBe('package.json');
  await notes.getByRole('link', { name: 'All notes', exact: true }).click();
  await expect(noteInput).toBeFocused();
  await expect(noteInput).toHaveValue(noteId);
  await expect(fileInput).toHaveValue('package.json');
  await expect(git.locator('a[data-file-path]')).toHaveCount(1);
  await expect(git.locator('a[data-file-path]')).toHaveAttribute('data-file-path', 'package.json');
  const after = await notes.locator('header').boundingBox();
  expect(await notes.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
    1,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await stableLocatorScreenshot(page, notes, async ({ png, attempt }) => {
    if (png) await info.attach(`note-filters-${attempt}`, { body: png, contentType: 'image/png' });
  });
  await noteInput.fill('');
  await expect.poll(() => notes.locator('a[data-note-id]').count()).toBeGreaterThan(1);
  await expect(fileInput).toHaveValue('package.json');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  expect(new URL(page.url()).searchParams.get('fileQuery')).toBe('package.json');
  expect(
    methods.filter((method) =>
      /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
        method ?? '',
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('note-filter-geometry', {
    body: JSON.stringify({ before, after, methods, errors }),
    contentType: 'application/json',
  });
});
