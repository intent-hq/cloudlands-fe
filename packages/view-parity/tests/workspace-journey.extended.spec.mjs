import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function connections(port) {
  const { stdout } = await exec('ss', ['-Htn', 'state', 'established', `( sport = :${port} )`]);
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).slice(-2).join(' '));
}

test('real workspace notes survive navigation and release view state and browser connections', async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  const baseUrl = process.env.REACT_BASE_URL;
  const workspaceId = process.env.REACT_WORKSPACE_ID;
  const noteId = process.env.REACT_NOTE_ID;
  if (!baseUrl || !workspaceId || !noteId)
    throw new Error(
      'Set REACT_BASE_URL, REACT_WORKSPACE_ID and REACT_NOTE_ID for the real daemon journey',
    );
  const endpoint = new URL(baseUrl);
  if (process.platform !== 'linux' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname))
    throw new Error(
      'Run against an owned loopback Vite server on Linux for socket cleanup evidence',
    );
  const port = endpoint.port || '80';
  const beforeConnections = new Set(await connections(port));
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  const errors = await observeErrors(page);
  const requests = [];
  const pending = new Map();
  const sockets = [];
  let ownedConnections = [];
  let workspace;
  const noteLists = [];
  const noteReads = [];
  const notesById = new Map();
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    sockets.push(socket);
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      requests.push(request);
      pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      if (!pending.has(response.id)) return;
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (request.method === 'workspace.list') {
        workspace = response.result?.workspaces?.find((row) => row.id === workspaceId);
      }
      if (request.method === 'note.list' && request.params.workspaceId === workspaceId)
        noteLists.push({ request, response });
      if (request.method === 'note.get' && request.params.noteId === noteId)
        noteReads.push({ request, response });
      if (
        request.method === 'note.get' &&
        request.params.workspaceId === workspaceId &&
        response.result?.note
      )
        notesById.set(request.params.noteId, response.result.note);
    });
  });
  try {
    await page.goto(`${baseUrl}/workspaces/`);
    await expect
      .poll(() => workspace, {
        timeout: 60_000,
        message: 'The real daemon must return the requested existing workspace',
      })
      .toBeTruthy();
    const list = page.getByTestId('workspace-list');
    const href = `/workspaces/${encodeURIComponent(workspaceId)}`;
    await list.locator(`a[href="${href}"]`).click();
    const overview = page.getByTestId('workspace-overview');
    await expect(overview).toHaveAttribute('data-workspace-id', workspaceId);
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText(workspace.title);
    await expect(overview.getByTestId('workspace-branch')).toHaveText(workspace.branch);
    await expect(overview.getByTestId('workspace-repository')).toHaveText(
      workspace.repositoryName ?? '',
    );
    await expect(overview.getByTestId('workspace-status')).toHaveText(workspace.status);
    if (workspace.statusMessage)
      await expect(overview.getByTestId('workspace-status-message')).toHaveText(
        workspace.statusMessage,
      );
    const notes = page.getByTestId('workspace-notes');
    await expect(notes.locator(`a[data-note-id="${noteId}"]`)).toBeVisible({ timeout: 30_000 });
    expect(noteLists.length).toBeGreaterThan(0);
    expect(noteLists[0].request.params).toEqual({ workspaceId, projection: 'slim' });
    const listedNote = noteLists[0].response.result.notes.find((note) => note.id === noteId);
    expect(listedNote).toBeTruthy();
    await expect(notes.locator(`a[data-note-id="${noteId}"]`)).toHaveText(listedNote.title);
    await notes.locator(`a[data-note-id="${noteId}"]`).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => noteReads.length).toBeGreaterThan(0);
    expect(noteReads[0].request.params).toEqual({ workspaceId, noteId });
    const note = noteReads[0].response.result.note;
    expect(note.id).toBe(noteId);
    const content = page.getByTestId('note-content');
    const rendered = page.getByTestId('note-rendered-content');
    const sourceToggle = page.getByRole('button', { name: 'Source', exact: true });
    const assertSource = async (expected) => {
      await sourceToggle.click();
      await expect.poll(() => content.textContent()).toBe(expected);
      await sourceToggle.click();
      await expect(content).toHaveCount(0);
    };
    await expect(
      page
        .getByTestId('workspace-note')
        .getByRole('heading', { name: note.title, exact: true })
        .first(),
    ).toBeFocused();
    await assertSource(note.content);
    const firstHeading = note.content.match(/^#{1,6} (.+)$/m)?.[1];
    if (!firstHeading)
      throw new Error('Choose a real Markdown note with a heading for this journey');
    await expect(rendered.getByRole('heading', { name: firstHeading, exact: true })).toBeVisible();
    if (note.content.includes('workspace-asset://')) {
      await expect(rendered.getByTestId('media-unavailable').first()).toHaveAttribute(
        'data-reason',
        'unsupported',
      );
      await expect(rendered.locator('[src^="workspace-asset:"]')).toHaveCount(0);
    }
    await expect(page.locator('[contenteditable="true"], textarea')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath('real-note.png') });
    await info.attach('real-note', {
      path: info.outputPath('real-note.png'),
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 420, height: 900 });
    await expect
      .poll(() => rendered.evaluate((element) => element.scrollWidth - element.clientWidth), {
        message: 'Long saved note content must wrap within a narrow viewport',
      })
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('real-note-narrow.png') });
    await info.attach('real-note-narrow', {
      path: info.outputPath('real-note-narrow.png'),
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 1000, height: 700 });
    const readState = () =>
      page.evaluate(async (id) => {
        const module = performance
          .getEntriesByType('resource')
          .find((entry) => new URL(entry.name).pathname.endsWith('/src/store/index.ts'));
        if (!module) throw new Error('The running Store module was not observed');
        const { store } = await import(module.name);
        const state = store.state.workspaceNotes.byWorkspaceId[id];
        return state ? { views: state.contentViews.ids, initialized: state.initialized } : null;
      }, workspaceId);
    await expect.poll(async () => (await readState())?.views.length).toBe(1);
    await page.getByRole('link', { name: 'All notes', exact: true }).click();
    await expect(page.getByTestId('workspace-note')).toHaveCount(0);
    await expect(notes.locator(`a[data-note-id="${noteId}"]`)).toBeFocused();
    await expect.poll(async () => (await readState())?.views).toEqual([]);
    await page.goBack();
    await assertSource(note.content);
    await overview.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await expect(overview).toHaveCount(0);
    await expect.poll(readState).toBeNull();
    await list.locator(`a[href="${href}"]`).click();
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText(workspace.title);
    await expect(notes.locator(`a[data-note-id="${noteId}"]`)).toBeVisible();
    await notes.locator(`a[data-note-id="${noteId}"]`).click();
    await expect.poll(() => noteReads.length).toBeGreaterThan(1);
    await assertSource(noteReads.at(-1).response.result.note.content);
    await page.getByRole('link', { name: 'All notes', exact: true }).click();
    await notes.locator('a[data-note-id="spec"]').click();
    const noteLink = rendered.locator('a[href^="intent://local/note/"]').first();
    await expect(noteLink).toBeVisible();
    const targetNoteId = new URL(await noteLink.getAttribute('href')).pathname.split('/').at(-1);
    expect(noteLists[0].response.result.notes.some((row) => row.id === targetNoteId)).toBe(true);
    await noteLink.click();
    await expect.poll(() => notesById.get(targetNoteId)).toBeTruthy();
    await expect(page.getByTestId('workspace-note')).toHaveAttribute('data-note-id', targetNoteId);
    await assertSource(notesById.get(targetNoteId).content);
    await expect.poll(async () => (await readState())?.views.length).toBe(1);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath('real-workspace.png') });
    await info.attach('real-workspace', {
      path: info.outputPath('real-workspace.png'),
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
    expect(requests.some((request) => request.method === 'workspace.list')).toBe(true);
    expect(
      requests
        .filter((request) => request.method === 'workspace.list')
        .every(
          (request) => JSON.stringify(request.params) === JSON.stringify({ includeArchived: true }),
        ),
    ).toBe(true);
    expect(
      requests.filter((request) =>
        /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow)$/.test(
          request.method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(sockets.length).toBeGreaterThan(0);
    ownedConnections = (await connections(port)).filter((row) => !beforeConnections.has(row));
    expect(ownedConnections.length).toBeGreaterThan(0);
    await context.close();
    await expect
      .poll(async () => (await connections(port)).filter((row) => ownedConnections.includes(row)))
      .toEqual([]);
  } finally {
    await context.close();
    await info.attach('workspace-journey-wire', {
      body: JSON.stringify(
        {
          requests,
          workspace,
          noteLists,
          noteReads,
          ownedConnections,
          remainingConnections: await connections(port),
          daemonSockets: sockets.length,
          errors,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});

test('direct note links reload and recover from a missing note', async ({ page }, info) => {
  const baseUrl = process.env.REACT_BASE_URL;
  const workspaceId = process.env.REACT_WORKSPACE_ID;
  const noteId = process.env.REACT_NOTE_ID;
  if (!baseUrl || !workspaceId || !noteId)
    throw new Error('Set the real daemon workspace journey environment');
  const errors = await observeErrors(page);
  const pending = new Map();
  const reads = [];
  const lists = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      if (request.method === 'note.get' || request.method === 'note.list')
        pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      (request.method === 'note.list' ? lists : reads).push({ request, response });
    });
  });
  const directUrl = `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}?note=${encodeURIComponent(noteId)}`;
  await page.goto(directUrl);
  const note = page.getByTestId('workspace-note');
  await expect(note).toHaveAttribute('data-note-id', noteId, { timeout: 60_000 });
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  const first = reads.find((read) => read.request.params.noteId === noteId);
  expect(first.request.params).toEqual({ workspaceId, noteId });
  await expect(
    note.getByRole('heading', { name: first.response.result.note.title, exact: true }).first(),
  ).toBeFocused();
  await page.reload();
  await expect(note).toHaveAttribute('data-note-id', noteId, { timeout: 60_000 });
  await expect
    .poll(() => reads.filter((read) => read.request.params.noteId === noteId).length)
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect
    .poll(() => page.getByTestId('note-content').textContent())
    .toBe(
      reads.filter((read) => read.request.params.noteId === noteId).at(-1).response.result.note
        .content,
    );
  const missingId = `missing-note-${crypto.randomUUID()}`;
  const listCount = lists.length;
  await page.goto(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}?note=${missingId}`);
  await expect.poll(() => lists.length).toBeGreaterThan(listCount);
  expect(lists.at(-1).request.params).toEqual({ workspaceId, projection: 'slim' });
  expect(lists.at(-1).response.result.notes.some((row) => row.id === missingId)).toBe(false);
  await expect(page.getByTestId('workspace-notes').getByRole('alert')).toBeVisible();
  await expect(note).toHaveCount(0);
  await page.getByRole('link', { name: 'All notes', exact: true }).click();
  await page.locator(`a[data-note-id="${noteId}"]`).click();
  await expect(note).toHaveAttribute('data-note-id', noteId);
  await expect(page.getByTestId('note-rendered-content')).toBeVisible();
  expect(errors).toEqual([]);
  await info.attach('direct-note-wire', {
    body: JSON.stringify({ reads, lists, errors }, null, 2),
    contentType: 'application/json',
  });
});
