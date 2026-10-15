import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Fixture setup/concurrent writer only. The tested edit and save use real product controls.
function ownedRpc(method, params) {
  return new Promise((resolve, reject) => {
    const socket = connect('/owned/data/intentd.sock');
    let buffer = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('Owned daemon timeout')));
    socket.on('error', reject);
    socket.on('connect', () =>
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n'),
    );
    socket.on('data', (bytes) => {
      buffer += bytes.toString();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.id !== 1) continue;
        socket.end();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  });
}

for (const width of [1280, 420]) {
  test(`owned New note through explicit Save at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL;
    const fixturesPath = process.env.ISOLATED_NOTE_CREATE_FIXTURES;
    if (!base || !fixturesPath || process.env.ISOLATED_NOTE_WRITES !== 'owned-test-daemon')
      throw new Error('Owned ordinary-note creation fixtures are required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
    const fixture = fixtures.find((entry) => entry.width === width);
    const other = fixtures.find((entry) => entry.width !== width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const workspaceId = fixture.workspaceId;
    const original = await ownedRpc('note.list', { workspaceId });
    const git = (...args) =>
      execFileSync('git', ['-C', fixture.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const repository = () => ({
      head: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain=v1'),
    });
    const before = repository();
    expect(git('remote')).toBe('');
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      inputs = [],
      geometry = [];
    let siblingPromise, created, accepted;
    const title = `Plan café 日本語 ${width} ${Date.now()}`;
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const request = JSON.parse(String(payload));
        requests.push(request);
        pending.set(request.id, request);
        if (request.method === 'note.create' && !siblingPromise)
          siblingPromise = ownedRpc('note.create', {
            workspaceId,
            title: 'Concurrent sibling',
            content: 'Sibling content remains unchanged.',
            idempotencyKey: randomUUID(),
          });
      });
      socket.on('framereceived', ({ payload }) => {
        const response = JSON.parse(String(payload)),
          request = pending.get(response.id);
        if (request) {
          pending.delete(response.id);
          replies.push({ request, response });
        }
      });
    });
    await page.exposeFunction('recordNoteCreationInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      const Native = window.WebSocket;
      window.__noteCreateSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__noteCreateSockets.push(this);
        }
      };
      window.addEventListener(
        'keydown',
        (event) => window.recordNoteCreationInput({ trusted: event.isTrusted, key: event.key }),
        true,
      );
    });
    const creates = () => requests.filter((r) => r.method === 'note.create');
    const saves = () => requests.filter((r) => r.method === 'note.setContent');
    const capture = async (name, locator) => {
      await locator.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        name,
        box: await locator.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      });
      const attempts = [];
      await writeFile(
        info.outputPath(name + '.png'),
        await stableLocatorScreenshot(page, locator, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(info.outputPath(name + '-stability.json'), JSON.stringify(attempts, null, 2));
    };
    const editor = page.getByRole('textbox', { name: 'Note Markdown editor' });
    const save = page.getByTestId('workspace-note-save');
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}`);
      const newNote = page.getByRole('button', { name: 'New note', exact: true });
      await expect(newNote).toBeEnabled({ timeout: 30000 });
      await capture('before', page.getByTestId('workspace-notes'));
      await newNote.click();
      const dialog = page.getByRole('dialog', { name: 'New note' });
      const titleInput = dialog.getByRole('textbox', { name: 'Note title' });
      await expect(titleInput).toBeFocused();
      await titleInput.pressSequentially('   ');
      await expect(dialog.getByRole('button', { name: 'Create note', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(newNote).toBeFocused();
      expect(creates()).toHaveLength(0);
      await newNote.click();
      await titleInput.pressSequentially(title);
      await capture('form', dialog);
      if (width === 1280) await titleInput.press('Enter');
      else await dialog.getByRole('button', { name: 'Create note', exact: true }).click();
      await expect(editor).toBeVisible({ timeout: 30000 });
      expect(creates()).toHaveLength(1);
      created = replies.find(({ request }) => request.method === 'note.create')?.response.result
        .note;
      expect(created.id).toBeTruthy();
      expect(created.title).toBe(title);
      expect(created.content).toBe('');
      expect(new URL(page.url()).searchParams.get('note')).toBe(created.id);
      const sibling = (await siblingPromise).note;
      expect(sibling.id).not.toBe(created.id);
      expect(creates()[0].params).toEqual({
        workspaceId,
        title,
        content: '',
        tags: [],
        idempotencyKey: expect.any(String),
      });
      await expect(save).toBeDisabled();
      await page.getByTestId('workspace-text-editor').click({ position: { x: 110, y: 35 } });
      await expect(editor).toBeFocused();
      const content = '# A new plan\n\nCafé 日本語, written with the editor.\n';
      await page.keyboard.type(content);
      await expect(save).toBeEnabled();
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await page.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(editor).toBeFocused();
      const count = await page.evaluate(() => {
        const n = window.__noteCreateSockets.length;
        for (const socket of window.__noteCreateSockets) socket.close();
        return n;
      });
      await page.waitForFunction(
        (n) =>
          window.__noteCreateSockets.length > n &&
          window.__noteCreateSockets.at(-1).readyState === WebSocket.OPEN,
        count,
      );
      await expect(save).toBeEnabled({ timeout: 30000 });
      if (width === 1280) {
        await editor.focus();
        await page.keyboard.press('Control+s');
      } else await save.click();
      await expect(page.getByTestId('workspace-note-editor')).toHaveAttribute(
        'data-note-dirty',
        'false',
      );
      expect(saves()).toHaveLength(1);
      expect(saves()[0].params).toEqual({
        workspaceId,
        noteId: created.id,
        content,
        expectedVersion: created.rev,
      });
      accepted = (await ownedRpc('note.get', { workspaceId, noteId: created.id })).note;
      expect(accepted.content).toBe(content);
      expect(accepted.title).toBe(title);
      expect(accepted.rev).toBeGreaterThan(created.rev);
      await page.getByRole('button', { name: 'View saved note', exact: true }).click();
      await expect(page.getByTestId('note-rendered-content')).toContainText('Café 日本語');
      await capture('saved', page.getByTestId('workspace-note'));
      const models = await page.evaluate(async () => {
        const resource = performance
          .getEntriesByType('resource')
          .find((entry) =>
            new URL(entry.name).pathname.endsWith('/src/lib/utils/monaco-workers.ts'),
          );
        if (!resource) throw new Error('Monaco source provenance missing');
        const engine = await import(resource.name);
        return engine.monaco.editor.getModels().map((model) => model.uri.toString());
      });
      expect(models).toEqual([]);
      expect(geometry.every((entry) => entry.viewport.scrollWidth <= entry.viewport.width)).toBe(
        true,
      );
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      const row = page.getByRole('link', { name: title, exact: true });
      await expect(row).toBeFocused();
      // Public note filter; the title input never doubles as a search cache.
      const notes = page.getByTestId('workspace-notes');
      const searchButton = notes
        .locator('header')
        .getByRole('button')
        .filter({ hasNotText: 'New note' });
      await searchButton.click();
      const query = page.getByPlaceholder('Filter notes');
      await query.fill(title);
      await expect(row).toBeVisible();
      await expect(page.getByRole('link', { name: 'Concurrent sibling', exact: true })).toHaveCount(
        0,
      );
      await row.click();
      await page.reload();
      await expect(page.getByTestId('note-rendered-content')).toContainText('Café 日本語');
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await expect(query).toHaveValue(title);
      await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
      await page.locator(`[data-list-workspace="${other.workspaceId}"]`).click();
      await expect(page.getByTestId('workspace-notes')).toBeVisible();
      expect(creates()).toHaveLength(1);
      expect(saves()).toHaveLength(1);
      expect((await ownedRpc('note.get', { workspaceId, noteId: sibling.id })).note).toEqual(
        sibling,
      );
      const after = await ownedRpc('note.list', { workspaceId });
      const rows = (v) => (Array.isArray(v) ? v : v.notes);
      for (const note of rows(original))
        expect(rows(after).find((n) => n.id === note.id)).toEqual(note);
      expect(repository()).toEqual(before);
      for (const [path, hash] of Object.entries(fixture.files))
        expect(
          createHash('sha256')
            .update(await readFile(`${fixture.repositoryPath}/${path}`))
            .digest('hex'),
        ).toBe(hash);
      expect(
        requests.filter((r) =>
          /^(file\.(write|delete|rename)|git\.(stage|unstage|agentCommit)|note\.(delete|update)|workspace\.(create|update|delete))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.length).toBeGreaterThan(5);
      expect(inputs.every((e) => e.trusted)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('creation-evidence.json'),
        JSON.stringify(
          {
            width,
            workspaceId,
            original,
            created,
            accepted,
            requests,
            replies,
            inputs,
            geometry,
            errors,
            repository: before,
          },
          null,
          2,
        ),
      );
      await page.goto('about:blank');
    }
  });
}
