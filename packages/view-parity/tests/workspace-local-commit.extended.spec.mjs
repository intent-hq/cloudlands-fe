import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420])
  test(`owned current-index local commit at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL;
    if (
      !base ||
      process.env.ISOLATED_GIT_WRITES !== 'owned-test-daemon' ||
      !process.env.ISOLATED_COMMIT_FIXTURES
    )
      throw new Error('Explicit isolated commit fixtures required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(process.env.ISOLATED_COMMIT_FIXTURES, 'utf8'));
    const fixture = fixtures.find((f) => f.width === width),
      workspaceId = fixture.workspaceId;
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(90000);
    const requests = [],
      replies = [],
      geometry = [],
      events = [],
      errors = await observeErrors(page);
    await page.exposeBinding('__commitEvidence', (_source, event) => events.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      for (const type of ['click', 'keydown'])
        window.addEventListener(
          type,
          (e) => {
            if (
              e.target instanceof Element &&
              e.target.closest('[data-testid=workspace-git-status],[data-testid=workspace-diff]')
            )
              window.__commitEvidence({ type, key: e.key, trusted: e.isTrusted });
          },
          true,
        );
    });
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
    const activate = async (locator) => {
      if (width === 1280) {
        await locator.focus();
        await page.keyboard.press('Enter');
      } else await locator.click();
    };
    const surface = page.getByTestId('workspace-git-status'),
      commit = page.getByTestId('workspace-git-commit');
    const row = (staged, path) => page.locator(`a[data-git-row="${staged}:${path}"]`);
    const capture = async (label) => {
      await page.evaluate(() => document.fonts.ready);
      const box = await surface.boundingBox();
      const height = page.viewportSize().height;
      if (box.y + box.height > height) {
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, box.y + box.height - height + 16);
        await expect
          .poll(async () => {
            const current = await surface.boundingBox();
            return current.y + current.height;
          })
          .toBeLessThanOrEqual(height);
      }
      geometry.push({
        label,
        box: await surface.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
        })),
      });
      await writeFile(
        info.outputPath(`${label}.png`),
        await stableLocatorScreenshot(page, surface),
      );
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
    let sha;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?fileQuery=commit-fixture`);
      await expect(row(true, 'commit-fixture/mixed.txt')).toBeVisible({ timeout: 30000 });
      await expect(row(false, 'commit-fixture/mixed.txt')).toBeVisible();
      await capture('before');
      await activate(
        surface.locator(
          '[data-git-write="stage"][data-git-write-path="commit-fixture/to-stage.txt"]',
        ),
      );
      await expect(row(true, 'commit-fixture/to-stage.txt')).toBeVisible();
      await activate(row(true, 'commit-fixture/mixed.txt'));
      const diff = page.getByTestId('workspace-diff-content');
      await expect(diff).toContainText(fixture.baseText ?? 'BASE original');
      await expect(diff).toContainText(fixture.indexText ?? 'INDEX reviewed');
      await expect(diff).not.toContainText(fixture.worktreeText ?? 'WORKTREE preserved');
      await page
        .getByTestId('workspace-diff')
        .getByRole('link', { name: 'Back', exact: true })
        .click();
      await expect(row(true, 'commit-fixture/mixed.txt')).toBeFocused();
      const message = `Owned current-index acceptance ${width}`;
      await commit.getByLabel('Commit Message', { exact: true }).fill(message);
      await expect(commit.locator('[data-git-commit]')).toBeEnabled();
      await activate(commit.locator('[data-git-commit]'));
      await expect(commit.getByText('Commit confirmed', { exact: true })).toBeVisible({
        timeout: 30000,
      });
      await expect(commit.locator('[data-commit-message]')).toHaveText(message);
      sha = await commit.locator('[data-commit-hash]').textContent();
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(requests.filter((r) => r.method === 'git.agentCommit')).toHaveLength(1);
      const wire = replies.find((p) => p.request.method === 'git.agentCommit');
      expect(wire.request.params).toEqual({ workspaceId, message, userRequested: true });
      expect(wire.response.result).toMatchObject({ ok: true, hash: sha });
      expect([...wire.response.result.files].sort()).toEqual([
        'commit-fixture/mixed.txt',
        'commit-fixture/to-stage.txt',
      ]);
      await expect(row(true, 'commit-fixture/mixed.txt')).toHaveCount(0);
      await expect(row(false, 'commit-fixture/mixed.txt')).toBeVisible();
      await expect(commit.getByLabel('Commit Message', { exact: true })).toHaveValue('');
      await capture('confirmed');
      await activate(row(false, 'commit-fixture/mixed.txt'));
      await expect(diff).toContainText(fixture.indexText ?? 'INDEX reviewed');
      await expect(diff).toContainText(fixture.worktreeText ?? 'WORKTREE preserved');
      await page.goBack();
      await expect(row(false, 'commit-fixture/mixed.txt')).toBeFocused();
      await expect(commit.locator('[data-commit-hash]')).toHaveText(sha);
      await page.reload();
      await expect(commit).toBeVisible();
      await commit.getByRole('button', { name: 'Inspect latest commit', exact: true }).click();
      await expect(commit.locator('[data-commit-hash]')).toHaveText(sha);
      await expect(commit.locator('[data-commit-message]')).toHaveText(message);
      expect(requests.filter((r) => r.method === 'git.agentCommit')).toHaveLength(1);
      await capture('reloaded-inspection');
      await page.getByRole('link', { name: 'Workspaces', exact: true }).last().click();
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await expect
        .poll(async () => (await lifecycle()).git.byWorkspaceId[workspaceId]?.reads.ids.length ?? 0)
        .toBe(0);
      await expect
        .poll(async () => (await lifecycle()).locks.byWorkspaceId[workspaceId])
        .toBeUndefined();
      expect(
        events.some((e) => e.type === (width === 1280 ? 'keydown' : 'click') && e.trusted),
      ).toBe(true);
      expect(
        requests.filter((r) =>
          /^git\.(push|discard|reset|amend|unstage|stageHunk|unstageHunk)$/.test(r.method),
        ),
      ).toHaveLength(0);
      for (const g of geometry) expect(g.viewport.scroll).toBeLessThanOrEqual(g.viewport.width);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('wire-geometry.json'),
        JSON.stringify(
          {
            fixture,
            sha,
            requests,
            replies,
            events,
            geometry,
            errors,
            lifetime: await lifecycle().catch((error) => ({ error: String(error) })),
          },
          null,
          2,
        ),
      );
    }
  });
