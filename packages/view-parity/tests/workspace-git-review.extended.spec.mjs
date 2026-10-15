import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420])
  test(`real staged and unstaged Git review at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL;
    const workspaceId = process.env.ISOLATED_GIT_WORKSPACE;
    if (!base || !workspaceId || process.env.ISOLATED_GIT_READS !== 'owned-test-daemon')
      throw new Error('Owned Git fixture and candidate required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      geometry = [];
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const r = JSON.parse(String(payload));
        requests.push(r);
        pending.set(r.id, r);
      });
      socket.on('framereceived', ({ payload }) => {
        const r = JSON.parse(String(payload)),
          request = pending.get(r.id);
        if (request) {
          pending.delete(r.id);
          replies.push({ request, response: r });
        }
      });
    });
    const root = `${base}/workspaces/${workspaceId}?fileQuery=git-review`;
    const row = (path, staged) => page.locator(`a[data-git-row="${staged}:git-review/${path}"]`);
    const view = page.getByTestId('workspace-diff');
    const snapshot = async (label) => {
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        box: await view.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
        })),
      });
      await writeFile(info.outputPath(`${label}.png`), await stableLocatorScreenshot(page, view));
    };
    const lifecycle = () =>
      page.evaluate(async () => {
        const entries = performance.getEntriesByType('resource');
        const pool = entries.find((e) =>
          new URL(e.name).pathname.endsWith('/diff-highlighter-preloader.ts'),
        );
        const state = entries.find((e) => new URL(e.name).pathname.endsWith('/src/store/index.ts'));
        if (!pool || !state) throw new Error('Canonical lifetime modules missing');
        const { inspectDiffWorkerPoolLifecycle } = await import(pool.name);
        const { store } = await import(state.name);
        const ws = store.state.git.byWorkspaceId ?? store.state.git.byDomainId;
        return { pool: inspectDiffWorkerPoolLifecycle(), git: ws };
      });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(root);
      await expect(row('both.txt', true)).toBeVisible({ timeout: 30000 });
      await row('both.txt', true).scrollIntoViewIfNeeded();
      const before = await row('both.txt', true).boundingBox();
      if (width === 1280) {
        await row('both.txt', true).focus();
        await page.keyboard.press('Enter');
      } else await row('both.txt', true).click();
      await expect(view).toHaveAttribute('data-diff-staged', 'true');
      const lines = page.getByTestId('workspace-diff-content');
      await expect(lines).toContainText('HEAD baseline');
      await expect(lines).toContainText('INDEX staged value');
      await expect(lines).not.toContainText('WORKTREE unstaged value');
      await snapshot('staged');
      const first = replies.find(
        (r) =>
          r.request.method === 'git.diffs' &&
          r.request.params.path === 'git-review/both.txt' &&
          r.request.params.staged === true,
      );
      expect(first?.response.result[0].hunks[0].lines.map((l) => l.content)).toEqual([
        'HEAD baseline\n',
        'INDEX staged value\n',
        'shared context\n',
      ]);
      const count = requests.filter((r) => r.method === 'git.diffs').length;
      await view.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect
        .poll(() => requests.filter((r) => r.method === 'git.diffs').length)
        .toBe(count + 1);
      await expect(lines).toContainText('INDEX staged value');
      await view.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(row('both.txt', true)).toBeFocused();
      expect(Math.abs((await row('both.txt', true).boundingBox()).y - before.y)).toBeLessThan(2);
      await expect.poll(async () => (await lifecycle()).pool.activeLeases).toBe(0);
      await expect
        .poll(async () => (await lifecycle()).git?.[workspaceId]?.reads.ids.length ?? 0)
        .toBe(0);
      await row('both.txt', false).click();
      await expect(lines).toContainText('INDEX staged value');
      await expect(lines).toContainText('WORKTREE unstaged value');
      await expect(lines).not.toContainText('HEAD baseline');
      await snapshot('unstaged');
      await page.reload();
      await expect(lines).toContainText('WORKTREE unstaged value');
      await view.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(row('both.txt', false)).toBeFocused();
      for (const [path, staged, text] of [
        ['added.txt', true, 'added staged value'],
        ['delete.txt', true, 'deleted baseline'],
        ['rename-new.txt', true, 'renamed content'],
      ]) {
        await row(path, staged).click();
        await expect(lines).toContainText(text);
        await page.goBack();
        await expect(row(path, staged)).toBeFocused();
      }
      for (const [path, staged] of [
        ['binary.bin', false],
        ['large.txt', false],
      ]) {
        await row(path, staged).click();
        await expect(page.getByTestId('git-diff-unavailable')).toBeVisible();
        await expect(page.getByTestId('git-diff-empty')).toHaveCount(0);
        await snapshot(path.replace('.', '-'));
        await view.getByRole('link', { name: 'Back', exact: true }).click();
        await expect(row(path, staged)).toBeFocused();
      }
      await row('both.txt', true).click();
      await expect(lines).toContainText('INDEX staged value');
      await page.getByRole('link', { name: 'Workspaces', exact: true }).last().click();
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await expect.poll(async () => (await lifecycle()).pool.activeLeases).toBe(0);
      await expect
        .poll(async () => (await lifecycle()).git?.[workspaceId]?.reads.ids.length ?? 0)
        .toBe(0);
      expect(requests.filter((r) => r.method === 'file.read')).toHaveLength(0);
      expect(
        requests.filter((r) =>
          /^(git\.(stage|unstage|commit|discard|push)|agent\.(create|sendMessage))$/.test(r.method),
        ),
      ).toHaveLength(0);
      expect(
        requests
          .filter((r) => r.method === 'git.diffs')
          .every(
            (r) => r.params.workspaceId === workspaceId && r.params.path?.startsWith('git-review/'),
          ),
      ).toBe(true);
      for (const g of geometry) expect(g.viewport.scroll).toBeLessThanOrEqual(g.viewport.width);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('wire-and-geometry.json'),
        JSON.stringify({ requests, replies, geometry, errors }, null, 2),
      );
    }
  });
