import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';
for (const width of [1280, 420])
  test(`owned primary-root commit history at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL,
      fixtureFile = process.env.ISOLATED_HISTORY_FIXTURES;
    const identity = JSON.parse(
      await readFile(
        new URL(
          '../../../.demo-artifacts/connected-commit-history/runtime-identity.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    if (Date.parse(identity.expiresAt) - Date.now() < 180000)
      throw new Error('Owned daemon lease insufficient');
    if (!base || !fixtureFile || process.env.ISOLATED_HISTORY_READS !== 'owned-test-daemon')
      throw new Error('Explicit owned history fixtures required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixture = JSON.parse(await readFile(fixtureFile, 'utf8')).find((f) => f.width === width),
      wid = fixture.workspaceId;
    const requests = [],
      replies = [],
      events = [],
      geometry = [],
      errors = await observeErrors(page);
    await page.exposeBinding('__historyEvidence', (_s, e) => events.push(e));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      for (const type of ['click', 'keydown'])
        window.addEventListener(
          type,
          (e) => {
            if (
              e.target instanceof Element &&
              e.target.closest(
                '[data-testid=workspace-commit-history],[data-testid=workspace-diff]',
              )
            )
              window.__historyEvidence({ type, key: e.key, trusted: e.isTrusted });
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
    const history = page.getByTestId('workspace-commit-history'),
      diff = page.getByTestId('workspace-diff');
    const entry = (hash) => history.locator(`[data-history-entry="${hash}"]`);
    const activate = async (l) => {
      if (width === 1280) {
        await l.focus();
        await page.keyboard.press('Enter');
      } else await l.click();
    };
    const lifecycle = () =>
      page.evaluate(async () => {
        const module = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/src/store/index.ts'));
        if (!module) throw new Error('Store provenance missing');
        const { store } = await import(module.name);
        return { git: store.state.git, changes: store.state.changes };
      });
    const capture = async (label, locator) => {
      await locator.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        box: await locator.boundingBox(),
        viewport: await page.evaluate(() => ({
          width: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
        })),
      });
      await writeFile(
        info.outputPath(`${label}.png`),
        await stableLocatorScreenshot(page, locator),
      );
    };
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${wid}`);
      await expect(history.locator('[data-history-entry]')).toHaveCount(
        fixture.first.commits.length,
        { timeout: 30000 },
      );
      expect(
        await history
          .locator('[data-history-entry]')
          .evaluateAll((es) => es.map((e) => e.dataset.historyEntry)),
      ).toEqual(fixture.first.commits.map((c) => c.hash));
      await expect(history.locator('[data-history-boundary]')).toHaveAttribute(
        'data-history-boundary',
        fixture.first.boundarySha,
      );
      await capture('changes-after', page.getByTestId('workspace-git-status'));
      const more = history.locator('[data-history-more]');
      await more.scrollIntoViewIfNeeded();
      await more.focus();
      const anchor = entry(fixture.first.commits.at(-1).hash);
      const oldY = (await anchor.boundingBox()).y;
      await activate(more);
      await expect(history.locator('[data-history-entry]')).toHaveCount(
        fixture.first.commits.length + fixture.second.commits.length,
      );
      expect(Math.abs((await anchor.boundingBox()).y - oldY)).toBeLessThanOrEqual(1);
      expect(
        await history
          .locator('[data-history-entry]')
          .evaluateAll((es) => es.map((e) => e.dataset.historyEntry)),
      ).toEqual([...fixture.first.commits, ...fixture.second.commits].map((c) => c.hash));
      expect(
        requests.filter(
          (r) =>
            r.method === 'file-tracking.loadCommits' &&
            r.params.nextToken === fixture.first.nextToken,
        ),
      ).toHaveLength(1);
      await activate(entry(fixture.head).getByRole('button'));
      await expect(entry(fixture.head).locator('[data-history-sha]')).toHaveText(fixture.head);
      await expect(entry(fixture.head).locator('[data-history-message]')).toHaveText(
        fixture.details.message,
      );
      await capture('expanded', entry(fixture.head));
      for (const path of [
        'history-fixture/created.txt',
        'history-fixture/delete.txt',
        'history-fixture/rename-new.txt',
        'history-fixture/binary.bin',
      ]) {
        const file = entry(fixture.head).locator(`[data-history-file="${path}"]`);
        await file.scrollIntoViewIfNeeded();
        await file.focus();
        const y = (await file.boundingBox()).y;
        await activate(file);
        await expect(diff).toHaveAttribute('data-diff-commit', fixture.head);
        expect(
          await diff
            .locator('[data-diff-reference]')
            .evaluate((e) => e.scrollWidth <= e.clientWidth),
        ).toBe(true);
        const chunks = fixture.diffs[path];
        const lines = chunks
          .flatMap((c) => c.hunks.flatMap((h) => h.lines))
          .filter((l) => l.content.trim());
        if (lines.length) {
          for (const line of lines)
            await expect(page.getByTestId('workspace-diff-content')).toContainText(
              line.content.trim(),
            );
        } else await expect(page.getByTestId('git-diff-unavailable')).toBeVisible();
        await expect(diff.locator('[data-git-write]')).toHaveCount(0);
        if (path.endsWith('created.txt')) await capture('committed-file', diff);
        await activate(diff.getByRole('link', { name: 'Back', exact: true }));
        await expect(file).toBeFocused();
        expect(Math.abs((await file.boundingBox()).y - y)).toBeLessThanOrEqual(1);
      }
      await activate(history.locator('[data-history-older]'));
      await expect(history.locator('[data-history-entry]')).toHaveCount(fixture.order.length);
      expect(
        await history
          .locator('[data-history-entry]')
          .evaluateAll((es) => es.map((e) => e.dataset.historyEntry)),
      ).toEqual(
        [...fixture.first.commits, ...fixture.second.commits, ...fixture.older.commits].map(
          (c) => c.hash,
        ),
      );
      const root = entry(fixture.root.hash);
      await activate(root.getByRole('button'));
      await expect(root.locator('[data-history-sha]')).toHaveText(fixture.root.hash);
      await activate(root.locator(`[data-history-file="${fixture.root.path}"]`));
      for (const line of fixture.root.diff
        .flatMap((c) => c.hunks.flatMap((h) => h.lines))
        .filter((l) => l.content.trim()))
        await expect(page.getByTestId('workspace-diff-content')).toContainText(line.content.trim());
      await page.goBack();
      await expect(root.locator(`[data-history-file="${fixture.root.path}"]`)).toBeFocused();
      await activate(history.getByRole('button', { name: 'Refresh', exact: true }));
      await expect(history.locator('[data-history-entry]')).toHaveCount(20);
      await page.reload();
      await expect(history.locator('[data-history-entry]')).toHaveCount(20);
      expect(
        await history
          .locator('[data-history-entry]')
          .evaluateAll((es) => es.map((e) => e.dataset.historyEntry)),
      ).toEqual(fixture.first.commits.map((c) => c.hash));
      await page.getByRole('link', { name: 'Workspaces', exact: true }).last().click();
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await expect
        .poll(async () => (await lifecycle()).git.byWorkspaceId[wid]?.reads.ids.length ?? 0)
        .toBe(0);
      await expect.poll(async () => (await lifecycle()).changes.byWorkspaceId[wid]).toBeUndefined();
      expect(
        requests.filter((r) =>
          /^git\.(agentCommit|stage|unstage|push|reset|discard|amend)/.test(r.method),
        ),
      ).toHaveLength(0);
      expect(
        requests.filter(
          (r) =>
            r.method === 'file.read' ||
            r.method === 'file.readChunk' ||
            r.method === 'git.showFile',
        ),
      ).toHaveLength(0);
      expect(
        events.some((e) => e.trusted && e.type === (width === 1280 ? 'keydown' : 'click')),
      ).toBe(true);
      for (const g of geometry) expect(g.viewport.scroll).toBeLessThanOrEqual(g.viewport.width);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('wire-geometry.json'),
        JSON.stringify(
          {
            fixture,
            requests,
            replies,
            events,
            geometry,
            errors,
            lifetime: await lifecycle().catch((e) => ({ error: String(e) })),
          },
          null,
          2,
        ),
      );
    }
  });
