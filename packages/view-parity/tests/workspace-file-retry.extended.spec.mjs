import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';
import { isolatedRetryFixture, observeDaemonWire } from '../lib/isolated-retry.mjs';

test('file read retries restore keyboard focus and preserve the note return route', async ({
  page,
}, info) => {
  const fixture = await isolatedRetryFixture();
  const { base, workspaceId, noteId, fileRelativePath: path } = fixture;
  const wire = observeDaemonWire(page);
  const requests = wire.requests;
  const reads = () =>
    wire.replies.filter(
      ({ request }) =>
        request.method === 'file.read' &&
        request.params.workspaceId === workspaceId &&
        request.params.path === path,
    );
  const errors = await observeErrors(page);
  let restore;
  const search = new URLSearchParams({ file: path, note: noteId, q: noteId, line: '1' });
  const view = page.getByTestId('workspace-file');
  const retry = view.getByRole('button', { name: 'Retry', exact: true });
  const content = page.getByTestId('workspace-file-content');
  const assertRoute = () => {
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(
      Object.fromEntries(search),
    );
  };
  try {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(
      `${base}/workspaces/${encodeURIComponent(workspaceId)}?note=${noteId}&q=${noteId}`,
    );
    const opener = page
      .getByTestId('workspace-note')
      .getByRole('link', { name: 'Retry file', exact: true });
    await expect(opener).toBeVisible({ timeout: 60_000 });
    restore = await fixture.failFile();
    await opener.click();
    await expect(retry).toBeFocused({ timeout: 60_000 });
    const initialReads = reads().length;
    expect(initialReads).toBe(1);
    await page.keyboard.press('Enter');
    await expect.poll(() => reads().length).toBe(initialReads + 1);
    await expect(retry).toBeFocused();
    await expect(view.getByRole('alert')).toBeVisible();
    expect(reads().at(-1).response.error.data).toContain('Permission denied');
    await expect(content).toHaveCount(0);
    assertRoute();
    await page.evaluate(() => document.fonts.ready);
    const errorShot = info.outputPath('file-retry-error.png');
    await page.screenshot({ path: errorShot });
    await info.attach('file-retry-error', { path: errorShot, contentType: 'image/png' });
    await restore?.();
    await page.keyboard.press('Enter');
    await expect(view.getByRole('heading', { name: path, exact: true })).toBeFocused();
    expect(reads()).toHaveLength(initialReads + 2);
    for (const { request } of reads()) expect(request.params).toEqual({ workspaceId, path });
    const read = reads().at(-1).response;
    expect(read.error).toBeUndefined();
    expect(typeof read.result).toBe('string');
    await expect
      .poll(() => content.locator('.code-line').allTextContents())
      .toEqual(read.result.split('\n').map((line) => line || ' '));
    await expect(retry).toHaveCount(0);
    await expect(view.getByRole('alert')).toHaveCount(0);
    assertRoute();
    const recoveredShot = info.outputPath('file-retry-recovered.png');
    await page.screenshot({ path: recoveredShot });
    await info.attach('file-retry-recovered', {
      path: recoveredShot,
      contentType: 'image/png',
    });
    await view.getByRole('link', { name: 'Back', exact: true }).click();
    const note = page.getByTestId('workspace-note');
    await expect(note).toHaveAttribute('data-note-id', noteId);
    await expect(note.locator('header').getByRole('heading')).toBeFocused();
    expect(new URL(page.url()).searchParams.get('q')).toBe(noteId);
    expect(
      requests.filter(({ method }) =>
        /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors.filter((error) => !error.includes('Permission denied'))).toEqual([]);
  } finally {
    await restore?.();
    await info.attach('file-retry-wire', {
      body: JSON.stringify(
        { ...wire, errors, failure: 'Real file permission denial in disposable workspace' },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});
