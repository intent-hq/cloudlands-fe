import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420])
  test(`owned per-file stage and unstage at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL,
      workspaceId = process.env.ISOLATED_GIT_WORKSPACE;
    if (!base || !workspaceId || process.env.ISOLATED_GIT_WRITES !== 'owned-test-daemon')
      throw new Error('Explicit owned mutation fixture required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const path = `git-staging/mixed-${width}.txt`,
      requests = [],
      replies = [],
      geometry = [];
    const errors = await observeErrors(page);
    await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
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
    const row = (staged) => page.locator(`a[data-git-row="${staged}:${path}"]`);
    const view = page.getByTestId('workspace-diff'),
      content = page.getByTestId('workspace-diff-content');
    const action = (kind) => view.locator(`[data-git-write="${kind}"]`);
    const capture = async (label) => {
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
    const activate = async (locator) => {
      if (width === 1280) {
        await locator.focus();
        await page.keyboard.press('Enter');
      } else await locator.click();
    };
    const lifecycle = () =>
      page.evaluate(async () => {
        const entry = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/src/store/index.ts'));
        if (!entry) throw new Error('Store provenance missing');
        const { store } = await import(entry.name);
        return { write: store.state.gitWrite, git: store.state.git, locks: store.state.agentLock };
      });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?fileQuery=git-staging`);
      await expect(row(false)).toBeVisible({ timeout: 30000 });
      await expect(row(true)).toBeVisible();
      const anchor = await row(false).boundingBox();
      await activate(row(false));
      await expect(content).toContainText('INDEX initial');
      await expect(content).toContainText('WORKTREE final');
      await expect(action('stage')).toBeEnabled();
      await capture('before-stage');
      await activate(action('stage'));
      await expect(page.getByTestId('git-diff-empty')).toBeVisible();
      await expect(action('stage')).toBeDisabled();
      expect(requests.filter((r) => r.method === 'git.stage')).toHaveLength(1);
      await view.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(row(false)).toHaveCount(0);
      await expect(row(true)).toBeFocused();
      // Removing the old category can make its old viewport position unattainable at scroll zero.
      // Assert the existing DOM anchor policy exactly, including physical scroll bounds.
      const returned = await row(true).evaluate((element, originalY) => {
        const box = element.getBoundingClientRect();
        const documentY = box.y + window.scrollY;
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const expectedScroll = Math.min(max, Math.max(0, documentY - originalY));
        return {
          actualY: box.y,
          expectedY: documentY - expectedScroll,
          scroll: window.scrollY,
          expectedScroll,
          max,
          originalY,
        };
      }, anchor.y);
      geometry.push({ label: 'return-anchor', returned });
      expect(Math.abs(returned.actualY - returned.expectedY)).toBeLessThan(2);
      expect(Math.abs(returned.scroll - returned.expectedScroll)).toBeLessThan(2);
      await activate(row(true));
      await expect(content).toContainText('BASE original');
      await expect(content).toContainText('WORKTREE final');
      await expect(content).not.toContainText('INDEX initial');
      await expect(action('unstage')).toBeEnabled();
      await capture('after-stage');
      await page.reload();
      await expect(content).toContainText('WORKTREE final');
      await expect(action('unstage')).toBeEnabled();
      await activate(action('unstage'));
      await expect(page.getByTestId('git-diff-empty')).toBeVisible();
      expect(requests.filter((r) => r.method === 'git.unstage')).toHaveLength(1);
      await view.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(row(false)).toBeFocused();
      await expect(row(true)).toHaveCount(0);
      await activate(row(false));
      await expect(content).toContainText('BASE original');
      await expect(content).toContainText('WORKTREE final');
      await capture('after-unstage');
      await page.goBack();
      await expect(row(false)).toBeFocused();
      await page.getByRole('link', { name: 'Workspaces', exact: true }).last().click();
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await expect
        .poll(
          async () =>
            (await lifecycle()).write.byWorkspaceId[workspaceId]?.operations.ids.length ?? 0,
        )
        .toBe(0);
      await expect
        .poll(async () => (await lifecycle()).git.byWorkspaceId[workspaceId]?.reads.ids.length ?? 0)
        .toBe(0);
      await expect
        .poll(async () => (await lifecycle()).locks.byWorkspaceId[workspaceId])
        .toBeUndefined();
      const mutations = requests.filter((r) => /^git\.(stage|unstage)$/.test(r.method));
      expect(mutations.map((r) => ({ method: r.method, params: r.params }))).toEqual(
        ['git.stage', 'git.unstage'].map((method) => ({
          method,
          params: { workspaceId, paths: [path] },
        })),
      );
      expect(
        mutations.every((r) =>
          replies.some((pair) => pair.request.id === r.id && !pair.response.error),
        ),
      ).toBe(true);
      expect(requests.some((r) => r.method === 'file-tracking.getAgentLocks')).toBe(true);
      expect(
        requests.filter((r) =>
          /^(git\.(commit|discard|push|stageHunk|unstageHunk)|agent\.(create|sendMessage))$/.test(
            r.method,
          ),
        ),
      ).toHaveLength(0);
      for (const item of geometry)
        if (item.viewport) expect(item.viewport.scroll).toBeLessThanOrEqual(item.viewport.width);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('wire-and-geometry.json'),
        JSON.stringify({ path, requests, replies, geometry, errors }, null, 2),
      );
    }
  });

test('owned staging definite failure retains retry and never mutates another path', async ({
  page,
}, info) => {
  const base = process.env.REACT_BASE_URL,
    workspaceId = process.env.ISOLATED_GIT_WORKSPACE;
  const fixtureRoot = process.env.ISOLATED_GIT_FIXTURE_ROOT;
  if (
    !base ||
    !workspaceId ||
    !fixtureRoot ||
    process.env.ISOLATED_GIT_WRITES !== 'owned-test-daemon'
  )
    throw new Error('Explicit disposable fixture path required');
  const { readFile, unlink, writeFile: writeFixture } = await import('node:fs/promises');
  const path = 'git-staging/retry.txt',
    bytes = 'Owned staging retry fixture\n';
  const file = `${fixtureRoot}/${path}`;
  expect(fixtureRoot).toMatch(
    /\/\.demo-artifacts\/connected-workspace-creation\/runtime\/workspaces\/restless-dove\/local-start$/,
  );
  expect(await readFile(file, 'utf8')).toBe(bytes);
  const requests = [],
    errors = await observeErrors(page);
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/intentd/ws')
      socket.on('framesent', ({ payload }) => requests.push(JSON.parse(String(payload))));
  });
  const row = page.locator(`a[data-git-row="false:${path}"]`),
    surface = page.getByTestId('workspace-git-status');
  try {
    await page.goto(`${base}/workspaces/${workspaceId}?fileQuery=git-staging/retry`);
    await expect(row).toBeVisible({ timeout: 30000 });
    const stage = surface.locator(`[data-git-write="stage"][data-git-write-path="${path}"]`);
    await expect(stage).toBeEnabled();
    // Real task-authored untracked file disappears after listing. No transport interception.
    await unlink(file);
    await stage.click();
    await expect(surface.getByRole('alert')).toContainText('pathspec');
    expect(requests.filter((r) => r.method === 'git.stage')).toHaveLength(1);
    await writeFixture(file, bytes, { flag: 'wx' });
    await surface.getByRole('button', { name: 'Refresh git status', exact: true }).click();
    await expect(stage).toBeEnabled();
    await stage.click();
    await expect(page.locator(`a[data-git-row="true:${path}"]`)).toBeVisible();
    expect(requests.filter((r) => r.method === 'git.stage')).toHaveLength(2);
    expect(
      requests
        .filter((r) => r.method === 'git.stage')
        .every((r) => JSON.stringify(r.params) === JSON.stringify({ workspaceId, paths: [path] })),
    ).toBe(true);
    await surface.locator(`[data-git-write="unstage"][data-git-write-path="${path}"]`).click();
    await expect(row).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(bytes);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('retry-wire.json'),
      JSON.stringify({ requests, errors }, null, 2),
    );
  }
});
