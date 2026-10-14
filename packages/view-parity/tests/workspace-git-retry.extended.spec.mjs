import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';
import { isolatedRetryFixture, observeDaemonWire } from '../lib/isolated-retry.mjs';

test('Git refresh recovers from a real repository failure without losing keyboard focus', async ({
  page,
}, info) => {
  const fixture = await isolatedRetryFixture();
  const { base, workspaceId } = fixture;
  const wire = observeDaemonWire(page);
  const requests = wire.requests;
  const reads = () => wire.replies.filter(({ request }) => request.method === 'git.status');
  const errors = await observeErrors(page);
  const restore = await fixture.failGit();
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?q=${workspaceId}`;
  const view = page.getByTestId('workspace-git-status');
  const refresh = view.locator('[data-changes-refresh]');
  info.annotations.push({
    type: 'coverage-gap',
    description:
      'Moving focus during an intentionally held reply remains outside genuine-daemon acceptance; no reply is delayed or replaced here.',
  });
  try {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(url);
    await expect(view.getByRole('alert')).toBeVisible({ timeout: 60_000 });
    await expect(refresh).toBeEnabled();
    const initialReads = reads().length;
    expect(initialReads).toBeGreaterThan(0);
    expect(reads().at(-1).response.error).toBeDefined();
    expect(reads().at(-1).response.error.code).toBe(-32603);
    expect(reads().at(-1).response.error.data).toContain('failed to read index');
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => reads().length).toBe(initialReads + 1);
    await expect(refresh).toBeEnabled();
    await expect(refresh).toBeFocused();
    await expect(view.getByRole('alert')).toBeVisible();
    expect(reads().at(-1).response.error).toBeDefined();
    await restore();
    await page.keyboard.press('Enter');
    await expect.poll(() => reads().length).toBe(initialReads + 2);
    await expect(refresh).toBeEnabled();
    await expect(refresh).toBeFocused();
    await expect(view.getByRole('alert')).toHaveCount(0);
    const recovered = reads().at(-1).response;
    expect(recovered.error).toBeUndefined();
    expect(recovered.result.files.length).toBeGreaterThan(0);
    await expect
      .poll(() =>
        view.locator('[data-git-staged]').evaluateAll((rows) =>
          rows.map((row) => ({
            path: row.getAttribute('data-git-path'),
            status: row.querySelector('[data-git-status]').textContent,
            staged: row.getAttribute('data-git-staged') === 'true',
          })),
        ),
      )
      .toEqual(
        recovered.result.files.map(({ path, status, staged }) => ({ path, status, staged })),
      );
    await page.evaluate(() => document.fonts.ready);
    const screenshot = info.outputPath('git-retry-recovered.png');
    await page.screenshot({ path: screenshot });
    await info.attach('git-retry-recovered', { path: screenshot, contentType: 'image/png' });
    await expect(page).toHaveURL(url);
    expect(reads()).toHaveLength(initialReads + 2);
    for (const { request } of reads().slice(initialReads))
      expect(request.params).toEqual({ workspaceId, forceRefresh: true });
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await restore();
    await info.attach('git-retry-wire', {
      body: JSON.stringify(
        { ...wire, errors, failure: 'Real unreadable Git index in disposable workspace' },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});
