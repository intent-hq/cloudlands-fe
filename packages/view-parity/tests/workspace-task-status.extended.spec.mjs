import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Read-only corroboration; task status writes use trusted public Select input.
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
  test(`owned existing unassigned task status at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL,
      fixturesPath = process.env.ISOLATED_TASK_STATUS_FIXTURES;
    if (!base || !fixturesPath || process.env.ISOLATED_TASK_WRITES !== 'owned-test-daemon')
      throw new Error('Owned task status fixtures required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixture = JSON.parse(await readFile(fixturesPath, 'utf8')).find((f) => f.width === width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const workspaceId = fixture.workspaceId,
      noteId = fixture.noteId;
    const initial = (await ownedRpc('note.get', { workspaceId, noteId })).note;
    const initialNotes = (await ownedRpc('note.list', { workspaceId })).notes;
    expect(initial.metadata.task.assignedAgentIds ?? []).toEqual([]);
    expect(initial.metadata.task.dependsOn ?? []).toEqual([]);
    const git = (...args) =>
      execFileSync('git', ['-C', fixture.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const repo = async () => ({
      head: git('rev-parse', 'HEAD'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain=v1'),
      files: git('ls-files'),
      sentinel: createHash('sha256')
        .update(await readFile(fixture.repositoryPath + '/untouched.txt'))
        .digest('hex'),
    });
    const before = await repo(),
      errors = await observeErrors(page),
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
          replies.push({ request, response });
          pending.delete(response.id);
        }
      });
    });
    await page.exposeFunction('recordTaskStatusInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      const Native = window.WebSocket;
      window.__taskStatusSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__taskStatusSockets.push(this);
        }
      };
      for (const type of ['keydown', 'pointerdown'])
        window.addEventListener(
          type,
          (event) =>
            window.recordTaskStatusInput({ type, trusted: event.isTrusted, key: event.key }),
          true,
        );
    });
    const writes = () => requests.filter((r) => r.method === 'task.updateNoteStatus');
    const control = page.getByRole('combobox', { name: 'Change task status' });
    const capture = async (name) => {
      const target = page.getByTestId('workspace-note');
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        name,
        box: await target.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      });
      const attempts = [];
      await writeFile(
        info.outputPath(name + '.png'),
        await stableLocatorScreenshot(page, target, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(info.outputPath(name + '-stability.json'), JSON.stringify(attempts, null, 2));
    };
    const readCurrent = async () => (await ownedRpc('note.get', { workspaceId, noteId })).note;
    const choose = async (label, keyboard) => {
      await control.click();
      const option = page.getByRole('option', { name: label, exact: true });
      await expect(option).toBeVisible();
      if (keyboard) {
        await page.keyboard.press('Home');
        await page.keyboard.type(label);
        await expect(option).toBeFocused();
        await page.keyboard.press('Enter');
      } else await option.click();
    };
    let accepted, finalTasks;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?note=${encodeURIComponent(noteId)}`);
      await expect(control).toBeEnabled({ timeout: 30000 });
      await expect(page.getByRole('heading', { name: initial.title, exact: true })).toBeFocused();
      await capture('before');
      await control.click();
      await page.keyboard.press('Escape');
      await expect(control).toBeFocused();
      expect(writes()).toHaveLength(0);
      // Re-select the actual current status: no mutation, independent of an earlier failed run.
      const selected = await control.textContent();
      await choose(selected.trim(), false);
      expect(writes()).toHaveLength(0);
      const firstStatus =
        initial.metadata.task.status === 'in_progress' ? 'waiting' : 'in_progress';
      const firstLabel = firstStatus === 'waiting' ? 'Waiting' : 'In Progress';
      await choose(firstLabel, width === 1280);
      await expect.poll(() => writes().length).toBe(1);
      await expect.poll(async () => (await readCurrent()).metadata.task.status).toBe(firstStatus);
      accepted = await readCurrent();
      await expect(control).toHaveText(firstLabel);
      await expect(control).toBeEnabled();
      expect(writes()[0].params).toEqual({
        workspaceId,
        noteId,
        status: firstStatus,
        expectedVersion: initial.rev,
      });
      const acknowledgement = replies.find((r) => r.request.id === writes()[0].id).response.result;
      expect(acknowledgement).toMatchObject({
        ok: true,
        noteId,
        status: firstStatus,
        note: { id: noteId, workspaceId },
      });
      // Pinned daemon echoes pre-write revision. The next request must use the authoritative read.
      expect(accepted.rev).toBeGreaterThan(initial.rev);
      const secondStatus = firstStatus === 'complete' ? 'waiting' : 'complete';
      await choose('Complete', width === 420);
      await expect.poll(() => writes().length).toBe(2);
      await expect.poll(async () => (await readCurrent()).metadata.task.status).toBe(secondStatus);
      expect(writes()[1].params.expectedVersion).toBe(accepted.rev);
      accepted = await readCurrent();
      await expect(control).toHaveText('Complete');
      await expect(control).toBeEnabled();
      await capture('after');
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await expect(page.getByRole('link', { name: initial.title, exact: true })).toBeVisible();
      const progress = page.getByTestId('workspace-task-progress');
      await expect(progress).toBeVisible();
      await expect(progress.getByRole('progressbar')).toHaveAttribute(
        'aria-valuetext',
        /1 complete/,
      );
      finalTasks = await ownedRpc('task.list', { workspaceId });
      expect(finalTasks.tasks.find((t) => t.id === noteId).status).toBe('complete');
      // The pinned task.list row omits rev; note.get is the authoritative revision evidence.
      expect(accepted.rev).toBeGreaterThan(initial.rev);
      expect(finalTasks.stats.completed).toBe(1);
      await page.getByRole('link', { name: initial.title, exact: true }).click();
      await expect(control).toHaveText('Complete');
      await page.reload();
      await expect(control).toHaveText('Complete', { timeout: 30000 });
      await expect(control).toBeEnabled();
      const sockets = await page.evaluate(() => {
        const count = window.__taskStatusSockets.length;
        for (const s of window.__taskStatusSockets) s.close();
        return count;
      });
      await page.waitForFunction(
        (count) =>
          window.__taskStatusSockets.length > count &&
          window.__taskStatusSockets.at(-1).readyState === WebSocket.OPEN,
        sockets,
      );
      await expect(control).toBeEnabled({ timeout: 30000 });
      await expect(control).toHaveText('Complete');
      await control.click();
      await page.keyboard.press('Escape');
      expect(writes()).toHaveLength(2);
      await page.goto(`${base}/workspaces`);
      await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
      expect(
        requests.filter((r) =>
          ['agent.sendMessage', 'note.setContent', 'note.create', 'task.assignAgent'].includes(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.every((i) => i.trusted)).toBe(true);
      expect(geometry.every((g) => g.viewport.scrollWidth <= g.viewport.width)).toBe(true);
      const afterNotes = (await ownedRpc('note.list', { workspaceId })).notes;
      expect(afterNotes.filter((n) => n.id !== noteId)).toEqual(
        initialNotes.filter((n) => n.id !== noteId),
      );
      const strip = (n) => {
        const copy = globalThis.structuredClone(n);
        delete copy.rev;
        delete copy.updatedAt;
        delete copy.metadata.task.status;
        delete copy.metadata.task.startedAt;
        delete copy.metadata.task.completedAt;
        return copy;
      };
      expect(strip(accepted)).toEqual(strip(initial));
      expect(await repo()).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('task-status-evidence.json'),
        JSON.stringify(
          {
            fixture,
            initial,
            accepted,
            finalTasks,
            requests,
            replies,
            inputs,
            geometry,
            before,
            after: await repo(),
            errors: errors,
          },
          null,
          2,
        ),
      );
    }
  });
}
