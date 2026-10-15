import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420]) {
  test(`owned workspace title at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL;
    const fixturesPath = process.env.ISOLATED_WORKSPACE_TITLE_FIXTURES;
    if (
      !base ||
      !fixturesPath ||
      process.env.ISOLATED_WORKSPACE_TITLE_WRITES !== 'owned-test-daemon'
    )
      throw new Error('Owned workspace title fixture required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
    const fixture = fixtures.find((entry) => entry.width === width);
    const other = fixtures.find((entry) => entry.width !== width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const git = (...args) =>
      execFileSync('git', ['-C', fixture.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const before = {
      head: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain=v1'),
    };
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
    await page.exposeFunction('recordTitleInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      const Native = window.WebSocket;
      window.__titleOwnedSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__titleOwnedSockets.push(this);
        }
      };
      document.addEventListener('input', (event) => {
        if (event.target instanceof window.HTMLInputElement && event.target.closest('h1'))
          window.recordTitleInput({ trusted: event.isTrusted, value: event.target.value });
      });
    });
    const heading = page.getByRole('heading', { level: 1 });
    const editor = heading.locator('input');
    const updates = () => requests.filter((request) => request.method === 'workspace.update');
    const capture = async (label) => {
      const header = page.locator('[data-slot=screen-header]');
      await header.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        width,
        header: await header.boundingBox(),
        heading: await heading.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      });
      const attempts = [];
      await writeFile(
        info.outputPath(label + '.png'),
        await stableLocatorScreenshot(page, header, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(
        info.outputPath(label + '-stability.json'),
        JSON.stringify(attempts, null, 2),
      );
    };
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${fixture.workspaceId}`);
      const rename = heading.getByRole('button');
      await expect(rename).toBeEnabled({ timeout: 30000 });
      const original = await rename.textContent();
      await capture('before');
      await rename.click();
      await editor.fill('Cancelled draft');
      await editor.press('Escape');
      await expect(rename).toHaveText(original);
      await rename.click();
      await editor.fill('   ');
      await editor.press('Enter');
      await rename.click();
      await editor.fill(` ${original} `);
      await editor.press('Enter');
      expect(updates()).toHaveLength(0);
      const suffix = createHash('sha256').update(info.outputDir).digest('hex').slice(0, 5);
      const accepted = `Café 日本語 ${width} ${suffix}`;
      await rename.click();
      await editor.fill(accepted);
      await editor.press('Enter');
      await expect(rename).toHaveText(accepted);
      await expect(rename).toBeEnabled();
      expect(updates()).toHaveLength(1);
      expect(updates()[0].params).toEqual({ workspaceId: fixture.workspaceId, title: accepted });
      await expect
        .poll(
          () =>
            replies.find(({ request }) => request.id === updates()[0].id)?.response.result
              ?.workspace?.title,
        )
        .toBe(accepted);
      if (width === 1280)
        await expect(
          page.locator(`[data-navigation-workspace="${fixture.workspaceId}"]`),
        ).toContainText(accepted);
      await capture('renamed');
      await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
      const home = page.locator(`[data-list-workspace="${fixture.workspaceId}"]`);
      await expect(home).toContainText(accepted);
      const search = page.getByTestId('workspace-list').getByRole('searchbox');
      await search.fill(accepted);
      await expect(home).toBeVisible();
      await expect(page.locator(`[data-list-workspace="${other.workspaceId}"]`)).toHaveCount(0);
      await home.click();
      await expect(rename).toHaveText(accepted);
      await page.reload();
      await expect(rename).toHaveText(accepted);
      expect(updates()).toHaveLength(1);
      const finalTitle = `Workspace ${width} — prêt ${suffix}`;
      await rename.click();
      await editor.fill(finalTitle);
      await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
      await search.fill(finalTitle);
      await expect(home).toContainText(finalTitle);
      expect(updates()).toHaveLength(2);
      await search.fill('');
      await home.click();
      await expect(rename).toHaveText(finalTitle);
      await page.evaluate(() => {
        for (const socket of window.__titleOwnedSockets) socket.close();
      });
      await expect(rename).toBeEnabled({ timeout: 30000 });
      await page.reload();
      await expect(rename).toHaveText(finalTitle);
      await expect(rename).toBeEnabled();
      expect(updates()).toHaveLength(2);
      await capture('reloaded');
      for (const { request, response } of replies.filter(
        ({ request }) => request.method === 'workspace.update',
      )) {
        expect(Object.keys(request.params).sort()).toEqual(['title', 'workspaceId']);
        expect(response.error).toBeUndefined();
        expect(response.result.workspace.id).toBe(fixture.workspaceId);
        expect(response.result.workspace.repositoryPath).toBe(fixture.repositoryPath);
      }
      expect(
        requests.filter((request) =>
          /^(file\.(write|delete|rename)|git\.(stage|unstage|agentCommit)|workspace\.(create|archive|delete))$/.test(
            request.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.length).toBeGreaterThan(4);
      expect(inputs.every((input) => input.trusted)).toBe(true);
      expect({
        head: git('rev-parse', 'HEAD'),
        branch: git('branch', '--show-current'),
        index: git('ls-files', '--stage'),
        status: git('status', '--porcelain=v1'),
      }).toEqual(before);
      for (const [path, hash] of Object.entries(fixture.files))
        expect(
          createHash('sha256')
            .update(await readFile(fixture.repositoryPath + '/' + path))
            .digest('hex'),
        ).toBe(hash);
      expect(geometry.every((entry) => entry.viewport.scrollWidth <= entry.viewport.width)).toBe(
        true,
      );
      await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
      await expect(page.locator('h1 input')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify({ fixture, before, requests, replies, inputs, geometry, errors }, null, 2),
      );
      await page.goto('about:blank');
    }
  });
}
