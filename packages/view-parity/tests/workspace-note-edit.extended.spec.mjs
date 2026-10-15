import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  test(`owned existing Markdown note at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL;
    const fixturesPath = process.env.ISOLATED_NOTE_EDIT_FIXTURES;
    if (!base || !fixturesPath || process.env.ISOLATED_NOTE_WRITES !== 'owned-test-daemon')
      throw new Error('Owned ordinary-note fixtures are required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
    const fixture = fixtures.find((entry) => entry.width === width);
    const other = fixtures.find((entry) => entry.width !== width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const ids = { workspaceId: fixture.workspaceId, noteId: fixture.noteId };
    const initial = (await ownedRpc('note.get', ids)).note;
    const neighborIds = { workspaceId: fixture.workspaceId, noteId: fixture.unrelatedNote.id };
    const neighbor = (await ownedRpc('note.get', neighborIds)).note;
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
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const request = JSON.parse(String(payload));
        requests.push(request);
        pending.set(request.id, request);
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
    await page.exposeFunction('recordNoteInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      const Native = window.WebSocket;
      window.__noteOwnedSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__noteOwnedSockets.push(this);
        }
      };
      for (const type of ['keydown', 'input', 'beforeinput'])
        window.addEventListener(
          type,
          (event) => {
            if (
              event.target instanceof window.HTMLElement &&
              event.target.closest('[data-testid=workspace-note-editor]')
            )
              window.recordNoteInput({
                trusted: event.isTrusted,
                type: event.type,
                key: event.key,
              });
          },
          true,
        );
    });
    const note = page.getByTestId('workspace-note');
    const editor = page.getByRole('textbox', { name: 'Note Markdown editor' });
    const save = page.getByTestId('workspace-note-save');
    const writes = () => requests.filter((request) => request.method === 'note.setContent');
    const capture = async (name) => {
      await note.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        name,
        note: await note.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      });
      const attempts = [];
      await writeFile(
        info.outputPath(name + '.png'),
        await stableLocatorScreenshot(page, note, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(info.outputPath(name + '-stability.json'), JSON.stringify(attempts, null, 2));
    };
    const retiredModels = async () => {
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
      return models;
    };
    const typeContent = async (content) => {
      await page.getByTestId('workspace-text-editor').click({ position: { x: 120, y: 35 } });
      await expect(editor).toBeFocused();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(content);
    };
    let concurrent, accepted;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${fixture.workspaceId}`);
      await page.getByRole('link', { name: initial.title, exact: true }).click();
      await expect(note).toBeVisible();
      await capture('before');
      await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(save).toBeDisabled();
      const draft = initial.content + '\nUnsaved café 日本語\n';
      await typeContent(draft);
      await expect(save).toBeEnabled();
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(editor).toBeFocused();
      expect(writes()).toHaveLength(0);
      await expect(page.getByTestId('workspace-note-editor')).toHaveAttribute(
        'data-note-dirty',
        'true',
      );
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await page.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click();
      await expect(note).toHaveCount(0);
      await retiredModels();
      expect((await ownedRpc('note.get', ids)).note.content).toBe(initial.content);
      await page.getByRole('link', { name: initial.title, exact: true }).click();
      await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
      await expect(editor).toBeVisible();
      const suffix = createHash('sha256').update(info.outputDir).digest('hex').slice(0, 7);
      const local = initial.content.replace(
        'First paragraph stays here.',
        `First paragraph stays here. Café 日本語 ${suffix}`,
      );
      await typeContent(local);
      await expect(save).toBeEnabled();
      await capture('dirty');
      // Genuine concurrent daemon writer uses a disjoint paragraph and the same saved base.
      concurrent = await ownedRpc('note.setContent', {
        ...ids,
        content: initial.content.replace(
          'Last paragraph stays here.',
          `Last paragraph stays here. Remote ${suffix}`,
        ),
        expectedVersion: initial.rev,
      });
      expect(concurrent.ok).toBe(true);
      if (width === 1280) {
        await editor.focus();
        await page.keyboard.press('Control+s');
      } else await save.click();
      await expect(page.getByTestId('workspace-note-editor')).toHaveAttribute(
        'data-note-dirty',
        'false',
      );
      expect(writes()).toHaveLength(1);
      expect(writes()[0].params).toEqual({ ...ids, content: local, expectedVersion: initial.rev });
      accepted = (await ownedRpc('note.get', ids)).note;
      expect(accepted.content).toContain(`Café 日本語 ${suffix}`);
      expect(accepted.content).toContain(`Remote ${suffix}`);
      expect(accepted.rev).toBeGreaterThan(concurrent.rev);
      expect(accepted.title).toBe(initial.title);
      expect(accepted.metadata).toEqual(initial.metadata);
      expect(accepted.tags).toEqual(initial.tags);
      await page.getByRole('button', { name: 'View saved note', exact: true }).click();
      await expect(page.getByTestId('note-rendered-content')).toContainText(
        `Café 日本語 ${suffix}`,
      );
      await expect(page.getByTestId('note-rendered-content')).toContainText(`Remote ${suffix}`);
      await capture('saved');
      await retiredModels();
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await expect(page.getByRole('link', { name: initial.title, exact: true })).toBeFocused();
      await page.getByRole('link', { name: initial.title, exact: true }).click();
      await page.reload();
      await expect(page.getByTestId('note-rendered-content')).toContainText(
        `Café 日本語 ${suffix}`,
      );
      await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
      await expect(editor).toBeVisible();
      const reconnectDraft = accepted.content + '\nRetained after reconnect\n';
      await typeContent(reconnectDraft);
      const oldSockets = await page.evaluate(() => {
        const count = window.__noteOwnedSockets.length;
        for (const socket of window.__noteOwnedSockets) socket.close();
        return count;
      });
      await page.waitForFunction(
        (count) =>
          window.__noteOwnedSockets.length > count &&
          window.__noteOwnedSockets.at(-1).readyState === WebSocket.OPEN,
        oldSockets,
      );
      await expect(save).toBeEnabled({ timeout: 30000 });
      await expect(page.getByTestId('workspace-note-editor')).toHaveAttribute(
        'data-note-dirty',
        'true',
      );
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await page.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click();
      await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
      await page.locator(`[data-list-workspace="${other.workspaceId}"]`).click();
      await expect(page.getByTestId('workspace-notes')).toBeVisible();
      await page.goBack();
      expect(writes()).toHaveLength(1);
      expect((await ownedRpc('note.get', neighborIds)).note).toEqual(neighbor);
      expect((await ownedRpc('note.get', ids)).note.content).toBe(accepted.content);
      expect(repository()).toEqual(before);
      for (const [path, hash] of Object.entries(fixture.files))
        expect(
          createHash('sha256')
            .update(await readFile(`${fixture.repositoryPath}/${path}`))
            .digest('hex'),
        ).toBe(hash);
      expect(
        requests.filter((request) =>
          /^(file\.(write|delete|rename)|git\.(stage|unstage|agentCommit)|note\.(create|delete|updateMetadata)|workspace\.(create|update|delete))$/.test(
            request.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.filter((event) => event.type === 'keydown').length).toBeGreaterThan(2);
      expect(inputs.every((event) => event.trusted)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('note-evidence.json'),
        JSON.stringify(
          {
            width,
            ids,
            requests,
            replies,
            inputs,
            geometry,
            errors,
            initial,
            concurrent,
            accepted,
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
