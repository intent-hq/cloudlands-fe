import { test, expect } from '@playwright/test';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420]) {
  test(`owned lazy file browser at ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const base = process.env.REACT_BASE_URL;
    const evidence = process.env.ISOLATED_FILE_BROWSER_EVIDENCE;
    const runtime = process.env.ISOLATED_FILE_EDIT_EVIDENCE;
    if (
      !base ||
      !evidence ||
      !runtime ||
      process.env.ISOLATED_FILE_EDIT_WRITES !== 'owned-test-daemon'
    )
      throw new Error('Owned browser fixture required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const identity = JSON.parse(await readFile(`${runtime}/runtime/identity.json`, 'utf8'));
    expect(Date.parse(identity.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const fixtures = JSON.parse(await readFile(`${evidence}/fixtures.json`, 'utf8'));
    const fixture = fixtures.find((f) => f.width === width);
    const other = fixtures.find((f) => f.width !== width);
    const repo = `${runtime}/runtime/repo-${width}`;
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    const index = git('ls-files', '--stage');
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
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
    await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
    const browser = page.getByTestId('workspace-file-browser');
    const file = page.getByTestId('workspace-file');
    const row = (relative) =>
      browser.locator(`[data-explorer-path=${JSON.stringify(`${fixture.root}/${relative}`)}]`);
    const openDir = async (relative) => {
      await row(relative).click();
      await expect(row(relative)).toHaveAttribute('aria-expanded', 'true');
    };
    const returnToTree = async () => {
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(browser).toBeVisible();
    };
    const capture = async (label, target) => {
      await page.evaluate(() => document.fonts.ready);
      await target.scrollIntoViewIfNeeded();
      geometry.push({
        label,
        width,
        box: await target.boundingBox(),
        scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
      });
      const attempts = [];
      const tall = (await target.boundingBox()).height > 900;
      // Match the existing overflow-menu capture: viewport bytes, unchanged full context checks.
      const captureTarget = tall
        ? {
            evaluate: (...args) => target.evaluate(...args),
            screenshot: (options) => page.screenshot(options),
          }
        : target;
      await writeFile(
        info.outputPath(`${label}.png`),
        await stableLocatorScreenshot(page, captureTarget, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(
        info.outputPath(`${label}-stability.json`),
        JSON.stringify({ mode: tall ? 'viewport' : 'element', attempts }, null, 2),
      );
    };
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${fixture.workspaceId}`);
      await expect(row('browser-fixture')).toBeVisible({ timeout: 30000 });
      expect(
        requests.filter((r) => r.method === 'file.list').every((r) => r.params.path === ''),
      ).toBe(true);
      await openDir('browser-fixture');
      await openDir('browser-fixture/nested');
      await row('browser-fixture/nested/deeper').focus();
      await page.keyboard.press('ArrowRight');
      const unusual = 'browser-fixture/nested/deeper/résumé #1 [draft].txt';
      await expect(row(unusual)).toBeVisible();
      expect(
        requests.some((r) => r.method === 'file.list' && r.params.path.includes('unopened')),
      ).toBe(false);
      await row(unusual).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('file')).toBe(unusual);
      await file.getByRole('heading', { name: unusual, exact: true }).focus();
      await capture('opened', file);
      await returnToTree();
      await expect(row(unusual)).toBeFocused();
      await expect(row('browser-fixture/nested')).toHaveAttribute('aria-expanded', 'true');
      await row('browser-fixture/file-20.txt').scrollIntoViewIfNeeded();
      await row('browser-fixture/file-20.txt').focus();
      const anchor = await row('browser-fixture/file-20.txt').boundingBox();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeVisible();
      await page.goBack();
      await expect(row('browser-fixture/file-20.txt')).toBeFocused();
      expect(
        Math.abs((await row('browser-fixture/file-20.txt').boundingBox()).y - anchor.y),
      ).toBeLessThanOrEqual(1);
      await openDir('browser-fixture/left');
      await openDir('browser-fixture/right');
      await row('browser-fixture/left/same.txt').click();
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('file')).toBe('browser-fixture/left/same.txt');
      await page.getByTestId('workspace-text-editor').click({ position: { x: 100, y: 35 } });
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' unsaved browser draft');
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeFocused();
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await dialog.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click();
      await expect(row('browser-fixture/left/same.txt')).toBeFocused();
      await openDir('browser-fixture/empty');
      await expect(browser.getByText('Empty directory', { exact: true })).toBeVisible();
      await chmod(`${repo}/browser-fixture/locked`, 0o000);
      await openDir('browser-fixture/locked');
      await expect(browser.getByRole('alert')).toBeVisible();
      expect(
        replies.some(
          (r) =>
            r.request.method === 'file.list' &&
            r.request.params.path.endsWith('/locked') &&
            r.response.error,
        ),
      ).toBe(true);
      await capture('read-error', browser);
      await chmod(`${repo}/browser-fixture/locked`, 0o755);
      await browser.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(row('browser-fixture/locked/inside.txt')).toBeVisible();
      await expect(browser.getByRole('alert')).toHaveCount(0);
      const fresh = `refresh-${test.info().testId.replace(/\W/g, '').slice(-12)}.txt`;
      await writeFile(`${repo}/browser-fixture/${fresh}`, 'Owned refresh fixture\n');
      await browser.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(row(`browser-fixture/${fresh}`)).toBeVisible();
      await row('browser-fixture').click();
      await expect(row(unusual)).toHaveCount(0);
      const beforeReopen = requests.filter((r) => r.method === 'file.list').length;
      await openDir('browser-fixture');
      await expect(row(unusual)).toBeVisible();
      expect(requests.filter((r) => r.method === 'file.list').length).toBeGreaterThan(beforeReopen);
      expect(
        requests.some((r) => r.method === 'file.list' && r.params.path.includes('unopened')),
      ).toBe(false);
      await capture('expanded', browser);
      await row('browser-fixture/outside-link.txt').click();
      await expect(file.getByRole('alert')).toBeVisible();
      await expect(page.getByTestId('workspace-file-save')).toHaveCount(0);
      expect(await file.textContent()).not.toContain('NEVER EXPOSE');
      await returnToTree();
      await row('binary.bin').click();
      await expect(
        file.getByText('Binary file - cannot be displayed', { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId('workspace-file-save')).toHaveCount(0);
      await returnToTree();
      await page.reload();
      await expect(row('browser-fixture')).toBeVisible({ timeout: 30000 });
      await expect(row('browser-fixture')).toHaveAttribute('aria-expanded', 'false');
      if (width === 420) await page.locator('[data-sidebar="trigger"]').click();
      await page.locator(`[data-navigation-workspace="${other.workspaceId}"]`).click();
      await expect(
        browser.locator(`[data-explorer-path=${JSON.stringify(`${other.root}/browser-fixture`)}]`),
      ).toBeVisible();
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(0);
      expect(git('ls-files', '--stage')).toBe(index);
      for (const [name, hash] of Object.entries(fixture.files))
        expect(
          createHash('sha256')
            .update(await readFile(`${repo}/browser-fixture/${name}`))
            .digest('hex'),
        ).toBe(hash);
      expect(geometry.every((g) => g.scrollWidth <= width)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await chmod(`${repo}/browser-fixture/locked`, 0o755);
      await writeFile(
        info.outputPath('browser-evidence.json'),
        JSON.stringify(
          {
            width,
            requests,
            replies,
            geometry,
            errors,
            indexBefore: index,
            indexAfter: git('ls-files', '--stage'),
          },
          null,
          2,
        ),
      );
    }
  });
}
