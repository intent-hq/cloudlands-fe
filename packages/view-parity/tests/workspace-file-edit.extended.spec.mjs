import { test, expect } from '@playwright/test';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';
for (const width of [1280, 420])
  test(`owned explicit text edit and save at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL,
      evidence = process.env.ISOLATED_FILE_EDIT_EVIDENCE;
    if (!base || !evidence || process.env.ISOLATED_FILE_EDIT_WRITES !== 'owned-test-daemon')
      throw new Error('Explicit owned file fixture required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const identity = JSON.parse(await readFile(`${evidence}/runtime/identity.json`, 'utf8'));
    if (Date.parse(identity.expiresAt) - Date.now() < 180000)
      throw new Error('Owned runtime lease insufficient');
    const fixture = JSON.parse(await readFile(`${evidence}/runtime/fixtures.json`, 'utf8')).find(
      (f) => f.width === width,
    );
    const repo = `${evidence}/runtime/repo-${width}`,
      git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    const before = {
      bytes: (await readFile(`${repo}/example.txt`)).toString('base64'),
      index: git('ls-files', '--stage'),
      unrelated: (await readFile(`${repo}/unrelated.txt`)).toString('base64'),
    };
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      events = [],
      geometry = [];
    await page.exposeBinding('__fileEditEvidence', (_s, event) => events.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      for (const type of ['click', 'keydown', 'input'])
        window.addEventListener(
          type,
          (e) => {
            if (e.target instanceof Element && e.target.closest('[data-testid=workspace-file]'))
              window.__fileEditEvidence({ type, key: e.key, trusted: e.isTrusted });
          },
          true,
        );
    });
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
    const file = page.getByTestId('workspace-file'),
      editor = page.getByRole('textbox', { name: 'Workspace text editor' }),
      save = page.getByTestId('workspace-file-save');
    const capture = async (label) => {
      await file.getByRole('heading', { name: 'example.txt', exact: true }).focus();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        box: await file.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
        })),
      });
      await writeFile(info.outputPath(`${label}.png`), await stableLocatorScreenshot(page, file));
    };
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${fixture.workspaceId}?file=example.txt`);
      await expect(editor).toBeVisible({ timeout: 30000 });
      console.log('editor ready', width);
      await expect(save).toBeDisabled();
      await page.getByTestId('workspace-text-editor').click({ position: { x: 120, y: 35 } });
      await expect(editor).toBeFocused();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(`Edited ${width}`);
      await page.keyboard.press('Enter');
      await expect(save).toBeEnabled();
      console.log('save enabled', width);
      await expect(page.getByTestId('workspace-file-content')).toHaveAttribute(
        'data-file-dirty',
        'true',
      );
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(0);
      console.log('typed', width);
      await capture('unsaved');
      console.log('captured', width);
      if (width === 1280) {
        await page.getByTestId('workspace-text-editor').click({ position: { x: 120, y: 35 } });
        await expect(editor).toBeFocused();
        await page.keyboard.press('Control+s');
      } else await save.click();
      await expect(save).toBeDisabled();
      await expect(page.getByTestId('workspace-file-content')).toHaveAttribute(
        'data-file-dirty',
        'false',
        { timeout: 10000 },
      );
      const expected = Buffer.from(
        `${Buffer.from(before.bytes, 'base64').toString('utf8')}Edited ${width}\r\n`,
      );
      expect(await readFile(`${repo}/example.txt`)).toEqual(expected);
      expect(git('ls-files', '--stage')).toBe(before.index);
      expect((await readFile(`${repo}/unrelated.txt`)).toString('base64')).toBe(before.unrelated);
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(1);
      expect(replies.find((r) => r.request.method === 'file.write')?.response.result).toMatchObject(
        { ok: true },
      );
      await capture('saved');
      await page.reload();
      await expect(editor).toBeVisible({ timeout: 30000 });
      console.log('editor ready', width);
      await expect(save).toBeDisabled();
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      const row = page
        .getByTestId('workspace-git-status')
        .locator('a[data-file-path="example.txt"]')
        .first();
      await expect(row).toBeVisible({ timeout: 10000 });
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
      await row.click();
      await expect(page.getByTestId('workspace-diff')).toContainText(`Edited ${width}`);
      await page.goto(`${base}/workspaces/${fixture.workspaceId}?file=preview.txt`);
      await expect(page.getByTestId('workspace-file-content')).toBeVisible({ timeout: 10000 });
      await expect(save).toHaveCount(0);
      await expect(editor).toHaveCount(0);
      await page.goto(`${base}/workspaces/${fixture.workspaceId}?file=binary.bin`);
      await expect(file).toContainText(/binary/i);
      await expect(save).toHaveCount(0);
      expect(git('diff', '--name-only').trim()).toBe('example.txt');
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'input').every((e) => e.trusted)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('file-edit-evidence.json'),
        JSON.stringify({ fixture, before, requests, replies, events, geometry, errors }, null, 2),
      );
    }
  });

test('owned explicit save shows a real disk refusal and permits deliberate retry', async ({
  page,
}, info) => {
  const evidence = process.env.ISOLATED_FILE_EDIT_EVIDENCE,
    base = process.env.REACT_BASE_URL;
  if (!evidence || !base || process.env.ISOLATED_FILE_EDIT_WRITES !== 'owned-test-daemon')
    throw new Error('Owned fixtures required');
  const fixture = JSON.parse(await readFile(`${evidence}/runtime/fixtures.json`, 'utf8')).find(
    (row) => row.width === 1280,
  );
  const path = `${evidence}/runtime/repo-1280/example.txt`,
    before = await readFile(path),
    errors = await observeErrors(page),
    responses = [];
  page.on('websocket', (socket) => {
    const pending = new Map();
    socket.on('framesent', ({ payload }) => {
      const r = JSON.parse(String(payload));
      pending.set(r.id, r);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload)),
        request = pending.get(response.id);
      if (request?.method === 'file.write') responses.push({ request, response });
    });
  });
  try {
    await page.goto(`${base}/workspaces/${fixture.workspaceId}?file=example.txt`);
    const editor = page.getByRole('textbox', { name: 'Workspace text editor' }),
      save = page.getByTestId('workspace-file-save');
    await expect(editor).toBeVisible({ timeout: 30000 });
    await chmod(path, 0o444);
    await page.getByTestId('workspace-text-editor').click({ position: { x: 120, y: 35 } });
    await expect(editor).toBeFocused();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('After disk retry');
    await page.keyboard.press('Enter');
    await save.click();
    await expect.poll(() => responses.length).toBe(1);
    expect(responses[0].response.error).toBeTruthy();
    expect(await readFile(path)).toEqual(before);
    await expect(editor).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(page.getByTestId('workspace-file').getByRole('alert')).toBeVisible();
    await chmod(path, 0o644);
    await save.click();
    await expect.poll(() => responses.length).toBe(2);
    expect(responses[1].response.result).toMatchObject({ ok: true });
    await expect(page.getByTestId('workspace-file-content')).toHaveAttribute(
      'data-file-dirty',
      'false',
    );
    expect(await readFile(path)).toEqual(
      Buffer.from(before.toString('utf8') + 'After disk retry\r\n'),
    );
    expect(errors).toEqual([]);
  } finally {
    await chmod(path, 0o644);
    await writeFile(
      info.outputPath('disk-refusal.json'),
      JSON.stringify({ responses, errors }, null, 2),
    );
  }
});
