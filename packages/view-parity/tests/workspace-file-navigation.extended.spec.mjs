import { test, expect } from '@playwright/test';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420])
  test(`owned unsaved navigation at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL,
      evidence = process.env.ISOLATED_FILE_NAVIGATION_EVIDENCE,
      runtime = process.env.ISOLATED_FILE_EDIT_EVIDENCE;
    if (
      !base ||
      !evidence ||
      !runtime ||
      process.env.ISOLATED_FILE_EDIT_WRITES !== 'owned-test-daemon'
    )
      throw new Error('Owned navigation fixture required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const identity = JSON.parse(await readFile(`${runtime}/runtime/identity.json`, 'utf8'));
    expect(Date.parse(identity.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const fixtures = JSON.parse(await readFile(`${evidence}/fixtures.json`, 'utf8')),
      fixture = fixtures.find((f) => f.width === width),
      other = fixtures.find((f) => f.width !== width);
    const repo = `${runtime}/runtime/repo-${width}`,
      disk = `${repo}/example.txt`,
      git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    const before = {
      bytes: (await readFile(disk)).toString('base64'),
      index: git('ls-files', '--stage'),
      unrelated: (await readFile(`${repo}/unrelated.txt`)).toString('base64'),
    };
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      geometry = [],
      events = [];
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const r = JSON.parse(String(payload));
        requests.push(r);
        pending.set(r.id, r);
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
    await page.exposeBinding('__navigationEvidence', (_s, e) => events.push(e));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      for (const type of ['input', 'click', 'keydown'])
        window.addEventListener(
          type,
          (e) => {
            if (e.target instanceof Element)
              window.__navigationEvidence({ type, key: e.key, trusted: e.isTrusted });
          },
          true,
        );
    });
    const editor = page.getByRole('textbox', { name: 'Workspace text editor' }),
      file = page.getByTestId('workspace-file'),
      dialog = page.getByRole('dialog'),
      save = page.getByTestId('workspace-file-save');
    const engineState = () =>
      page.evaluate(async () => {
        const resource = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/src/lib/utils/monaco-workers.ts'));
        if (!resource) throw new Error('Monaco resource missing');
        const { monaco } = await import(resource.name);
        return {
          models: monaco.editor
            .getModels()
            .map((m) => ({ uri: m.uri.toString(), value: m.getValue(undefined, true) })),
          editors: monaco.editor
            .getEditors()
            .map((e) => ({ selection: e.getSelection(), position: e.getPosition() })),
        };
      });
    const type = async (text) => {
      await page.getByTestId('workspace-text-editor').click({ position: { x: 120, y: 35 } });
      await expect(editor).toBeFocused();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(text);
    };
    const capture = async (label, target) => {
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        box: await target.boundingBox(),
        width,
        scroll: await page.evaluate(() => document.documentElement.scrollWidth),
      });
      await writeFile(info.outputPath(`${label}.png`), await stableLocatorScreenshot(page, target));
    };
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${fixture.workspaceId}?note=${fixture.note.note.id}`);
      await page.getByRole('link', { name: 'Edit example', exact: true }).click();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await file.getByRole('heading', { name: 'example.txt', exact: true }).focus();
      await capture('clean', file);
      await type('Navigation draft');
      const draft = await engineState();
      const originalUrl = page.url();
      await page.goBack();
      await expect(dialog).toBeVisible();
      await capture('blocked', dialog);
      await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(editor).toBeFocused();
      await expect(page).toHaveURL(originalUrl);
      expect(await engineState()).toEqual(draft);
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(0);
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(editor).toBeFocused();
      expect(await engineState()).toEqual(draft);
      const unload = page.waitForEvent('dialog');
      const reload = page.reload({ timeout: 1500 }).catch((e) => String(e));
      const native = await unload;
      expect(native.type()).toBe('beforeunload');
      await native.dismiss();
      await reload;
      await expect(editor).toBeFocused();
      expect(await engineState()).toEqual(draft);
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await dialog.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Edit example', exact: true })).toBeVisible();
      expect((await engineState()).models).toEqual([]);
      expect((await readFile(disk)).toString('base64')).toBe(before.bytes);
      expect(git('ls-files', '--stage')).toBe(before.index);
      await page.getByRole('link', { name: 'Inspect unrelated', exact: true }).click();
      await expect(editor).toBeVisible();
      await type('Do not save');
      await page.goBack();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Edit example', exact: true })).toBeVisible();
      expect((await readFile(`${repo}/unrelated.txt`)).toString('base64')).toBe(before.unrelated);
      await page.goBack();
      await expect(editor).toBeVisible();
      await type('Forward draft');
      const forwardDraft = await engineState();
      await page.goForward();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(editor).toBeFocused();
      expect(await engineState()).toEqual(forwardDraft);
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await dialog.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click();
      await page.getByRole('link', { name: 'Edit example', exact: true }).click();
      await expect(editor).toBeVisible();
      await type(`Navigation saved ${width}`);
      await page.keyboard.press('Enter');
      if (width === 1280) {
        await chmod(disk, 0o444);
        await save.click();
        await expect
          .poll(() => replies.filter((r) => r.request.method === 'file.write').length)
          .toBe(1);
        expect(replies.find((r) => r.request.method === 'file.write').response.error).toBeTruthy();
        await file.getByRole('link', { name: 'Back', exact: true }).click();
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
        await expect(editor).toBeFocused();
        await chmod(disk, 0o644);
      }
      await save.click();
      await expect(page.getByTestId('workspace-file-content')).toHaveAttribute(
        'data-file-dirty',
        'false',
      );
      const saved = Buffer.from(
        Buffer.from(before.bytes, 'base64').toString('utf8') + `Navigation saved ${width}\r\n`,
      );
      expect(await readFile(disk)).toEqual(saved);
      await page.reload({ timeout: 15000 });
      await expect(editor).toBeVisible({ timeout: 15000 });
      await expect(save).toBeDisabled();
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Edit example', exact: true })).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await page.getByRole('link', { name: 'Edit example', exact: true }).click();
      await expect(editor).toBeVisible();
      await type('Workspace draft');
      if (width === 420) await page.locator('[data-sidebar="trigger"]').click();
      await page.locator(`[data-navigation-workspace="${other.workspaceId}"]`).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(editor).toBeFocused();
      expect(new URL(page.url()).pathname).toBe(`/workspaces/${fixture.workspaceId}`);
      if (width === 420) await page.locator('[data-sidebar="trigger"]').click();
      await page.locator(`[data-navigation-workspace="${other.workspaceId}"]`).click();
      await dialog.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/workspaces/${other.workspaceId}`));
      expect((await engineState()).models).toEqual([]);
      expect(await readFile(disk)).toEqual(saved);
      expect(git('ls-files', '--stage')).toBe(before.index);
      expect((await readFile(`${repo}/unrelated.txt`)).toString('base64')).toBe(before.unrelated);
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(
        width === 1280 ? 2 : 1,
      );
      expect(events.every((e) => e.trusted)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await chmod(disk, 0o644);
      await writeFile(
        info.outputPath('navigation-evidence.json'),
        JSON.stringify({ fixture, before, requests, replies, events, geometry, errors }, null, 2),
      );
    }
  });
