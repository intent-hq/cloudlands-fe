import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420]) {
  test(`owned workspace file finder at ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const base = process.env.REACT_BASE_URL;
    const fixturePath = process.env.ISOLATED_FILE_FINDER_FIXTURES;
    if (!base || !fixturePath || process.env.ISOLATED_FILE_FINDER_READS !== 'owned-test-daemon')
      throw new Error('Owned finder fixture required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
    const fixture = fixtures.find((f) => f.width === width),
      other = fixtures.find((f) => f.width !== width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const git = (...args) =>
      execFileSync('git', ['-C', fixture.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const index = git('ls-files', '--stage');
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      geometry = [],
      inputs = [];
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
    await page.exposeFunction('recordFinderInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      const Native = window.WebSocket;
      window.__finderOwnedSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__finderOwnedSockets.push(this);
        }
      };
      document.addEventListener('input', (event) => {
        if (
          event.target instanceof window.HTMLInputElement &&
          event.target.closest('[data-testid=workspace-file-finder]')
        )
          window.recordFinderInput({ trusted: event.isTrusted, value: event.target.value });
      });
    });
    const browser = page.getByTestId('workspace-file-browser'),
      finder = page.getByTestId('workspace-file-finder'),
      file = page.getByTestId('workspace-file');
    const input = finder.locator('input');
    const result = (path) => finder.locator(`[data-finder-path=${JSON.stringify(path)}]`);
    const row = (path) =>
      browser.locator(
        `[data-explorer-path=${JSON.stringify(fixture.repositoryPath + '/' + path)}]`,
      );
    const search = async (query) => {
      if (!(await input.count())) await finder.getByRole('button').click();
      await input.fill(query);
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
      const captureTarget = tall
        ? {
            evaluate: (...args) => target.evaluate(...args),
            screenshot: (options) => page.screenshot(options),
          }
        : target;
      await writeFile(
        info.outputPath(label + '.png'),
        await stableLocatorScreenshot(page, captureTarget, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(
        info.outputPath(label + '-stability.json'),
        JSON.stringify({ mode: tall ? 'viewport' : 'element', attempts }, null, 2),
      );
    };
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${fixture.workspaceId}`);
      await expect(row('nested')).toBeVisible({ timeout: 30000 });
      await row('nested').click();
      await expect(row('nested/deeper')).toBeVisible();
      const beforeReads = requests.filter((r) => r.method === 'file.read').length;
      await search('same');
      await expect(result('left/same.txt')).toBeVisible();
      await expect(result('right/same.txt')).toBeVisible();
      expect(requests.filter((r) => r.method === 'file.read')).toHaveLength(beforeReads);
      await input.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const chosen = await page.locator(':focus').getAttribute('data-finder-path');
      expect(['left/same.txt', 'right/same.txt']).toContain(chosen);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('file')).toBe(chosen);
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(result(chosen)).toBeFocused();
      await expect(input).toHaveValue('same');
      await search('résumé');
      const unusual = 'nested/deeper/résumé #1 [draft].txt';
      await expect(result(unusual)).toBeVisible();
      await capture('search', browser);
      await result(unusual).click();
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeVisible();
      await page.getByTestId('workspace-text-editor').click({ position: { x: 100, y: 35 } });
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' unsaved finder draft');
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeFocused();
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Discard unsaved edits', exact: true })
        .click();
      await expect(result(unusual)).toBeFocused();
      await expect(input).toHaveValue('résumé');
      await finder.locator('[data-sidebar-search-clear=files]').click();
      await expect(row('nested/deeper')).toBeVisible();
      await expect(row('nested')).toHaveAttribute('aria-expanded', 'true');
      await search('matches/match-');
      await expect(finder.locator('[data-finder-path]')).toHaveCount(100);
      await expect(
        finder.getByText('Showing the first 100 matches. Refine your search to find more.'),
      ).toBeVisible();
      expect(
        replies.some(
          (r) =>
            r.request.method === 'search.fileNames' &&
            r.response.result?.truncated === true &&
            r.response.result.files.length === 100,
        ),
      ).toBe(true);
      const anchorResult = finder.locator('[data-finder-path]').nth(60),
        path = await anchorResult.getAttribute('data-finder-path');
      await anchorResult.scrollIntoViewIfNeeded();
      await anchorResult.focus();
      const anchor = await anchorResult.boundingBox();
      const beforeReturn = await page.evaluate(() => ({
        scrollY: window.scrollY,
        height: document.documentElement.scrollHeight,
      }));
      await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeVisible();
      await page.goBack();
      await expect(result(path)).toBeFocused();
      await writeFile(
        info.outputPath('return-anchor.json'),
        JSON.stringify(
          {
            path,
            anchor,
            beforeReturn,
            after: await result(path).boundingBox(),
            afterReturn: await page.evaluate(() => ({
              scrollY: window.scrollY,
              height: document.documentElement.scrollHeight,
            })),
          },
          null,
          2,
        ),
      );
      await expect
        .poll(async () => Math.abs((await result(path).boundingBox()).y - anchor.y))
        .toBeLessThanOrEqual(1);
      await search('[invalid');
      await expect(finder.getByRole('alert')).toBeVisible();
      const failures = () =>
        replies.filter(
          (r) =>
            r.request.method === 'search.fileNames' &&
            r.request.params.pattern === '[invalid' &&
            r.response.error,
        ).length;
      await expect.poll(failures).toBe(1);
      await capture('error', browser);
      await finder.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect.poll(failures).toBe(2);
      await search('nothing-matches-this-file');
      await expect(finder.getByText('No results found', { exact: true })).toBeVisible();
      await search('hidden-match');
      await expect(finder.getByText('No results found', { exact: true })).toBeVisible();
      await search('binary.bin');
      await expect(result('binary.bin')).toBeVisible();
      await result('binary.bin').click();
      await expect(
        file.getByText('Binary file - cannot be displayed', { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId('workspace-file-save')).toHaveCount(0);
      await file.getByRole('link', { name: 'Back', exact: true }).click();
      await search('same');
      await expect(result('left/same.txt')).toBeVisible();
      await input.fill('transient');
      await input.fill('');
      await expect(row('nested/deeper')).toBeVisible();
      await page.reload();
      await expect(row('nested')).toBeVisible({ timeout: 30000 });
      await expect(finder.locator('[data-finder-path]')).toHaveCount(0);
      await search('same');
      await expect(result('left/same.txt')).toBeVisible();
      const reconnectLists = () =>
        replies.filter((r) => r.request.method === 'workspace.list').length;
      const beforeReconnect = reconnectLists();
      await page.evaluate(() => window.__finderOwnedSockets.at(-1).close());
      await expect.poll(reconnectLists, { timeout: 30000 }).toBeGreaterThan(beforeReconnect);
      await expect(row('nested')).toBeVisible({ timeout: 30000 });
      await expect(finder.locator('[data-finder-path]')).toHaveCount(0);
      await search('same');
      await expect(result('right/same.txt')).toBeVisible();
      if (width === 420) await page.locator('[data-sidebar=trigger]').click();
      await page.locator(`[data-navigation-workspace="${other.workspaceId}"]`).click();
      await expect(
        browser.locator(`[data-explorer-path=${JSON.stringify(other.repositoryPath + '/nested')}]`),
      ).toBeVisible();
      await expect(finder.locator('[data-finder-path]')).toHaveCount(0);
      await expect(page.locator('.monaco-editor')).toHaveCount(0);
      expect(
        requests.filter((r) =>
          /^(file\.(write|delete|rename)|git\.(stage|agentCommit|push)|terminal\.(create|write)|agent\.(create|sendMessage))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(
        requests
          .filter((r) => r.method === 'search.fileNames')
          .every((r) => r.params.pattern.trim() && r.params.limit === 100),
      ).toBe(true);
      expect(git('ls-files', '--stage')).toBe(index);
      expect(git('status', '--porcelain')).toBe('');
      for (const [path, hash] of Object.entries(fixture.files))
        expect(
          createHash('sha256')
            .update(await readFile(fixture.repositoryPath + '/' + path))
            .digest('hex'),
        ).toBe(hash);
      expect(inputs.some((e) => e.trusted && e.value === 'same')).toBe(true);
      await page
        .getByTestId('workspace-overview')
        .getByRole('link', { name: 'Workspaces', exact: true })
        .click();
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      const retired = await page.evaluate(async () => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/src/store/index.ts'));
        if (!resource) throw new Error('Store provenance missing');
        const { store } = await import(resource.name);
        return {
          searches: Object.keys(store.state.fileExplorer.searches.map),
          explorers: Object.keys(store.state.fileExplorer.byWorkspaceId),
        };
      });
      expect(retired).toEqual({ searches: [], explorers: [] });
      await writeFile(info.outputPath('cleanup.json'), JSON.stringify(retired, null, 2));
      expect(geometry.every((g) => g.scrollWidth <= width)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('finder-evidence.json'),
        JSON.stringify(
          {
            fixture,
            requests,
            replies,
            inputs,
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
