import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';
import { isolatedRetryFixture, observeDaemonWire } from '../lib/isolated-retry.mjs';

for (const method of ['note.get', 'note.list']) {
  test(`${method} failure retries in place and recovers real content`, async ({ page }, info) => {
    const fixture = await isolatedRetryFixture();
    const { base, workspaceId, noteId } = fixture;
    const errors = await observeErrors(page);
    const wire = observeDaemonWire(page);
    const requests = wire.requests;
    const reads = () =>
      wire.replies.filter(
        ({ request }) =>
          request.method === method &&
          request.params.workspaceId === workspaceId &&
          (method === 'note.list' || request.params.noteId === noteId),
      );
    let restore;
    const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?note=${encodeURIComponent(noteId)}&q=${encodeURIComponent(noteId)}`;
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    try {
      await page.setViewportSize({ width: 1000, height: 700 });
      if (method === 'note.get') {
        await page.goto(`${base}/workspaces/${encodeURIComponent(workspaceId)}?q=${noteId}`);
        const opener = page.locator(`a[data-note-id="${noteId}"]`);
        await expect(opener).toBeVisible({ timeout: 60_000 });
        restore = await fixture.failNote();
        await opener.click();
      } else {
        restore = await fixture.failNote();
        await page.goto(url);
      }
      await expect(retry).toBeVisible({ timeout: 60_000 });
      const initialReads = reads().length;
      expect(initialReads).toBeGreaterThan(0);
      await expect(page.getByTestId('workspace-note')).toHaveCount(0);
      await expect(retry).toBeFocused();
      await retry.click();
      await expect.poll(() => reads().length).toBe(initialReads + 1);
      await expect(retry).toBeVisible();
      await expect(retry).toBeFocused();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page).toHaveURL(url);
      await page.evaluate(() => document.fonts.ready);
      const failedScreenshot = info.outputPath('note-retry-error.png');
      await page.screenshot({ path: failedScreenshot });
      await info.attach('note-retry-error', { path: failedScreenshot, contentType: 'image/png' });
      expect(reads().at(-1).response.error).toBeDefined();
      expect(reads().at(-1).response.error.code).toBe(-32603);
      expect(reads().at(-1).response.error.data).toContain('column created_at');
      await restore();
      await page.keyboard.press('Enter');
      const note = page.getByTestId('workspace-note');
      await expect(note).toHaveAttribute('data-note-id', noteId);
      expect(reads()).toHaveLength(initialReads + 2);
      for (const { request } of reads()) {
        expect(request.method).toBe(method);
        expect(request.params).toEqual(
          method === 'note.get' ? { workspaceId, noteId } : { workspaceId, projection: 'slim' },
        );
      }
      expect(reads().at(-1).response.error).toBeUndefined();
      const result = reads().at(-1).response.result;
      const title =
        method === 'note.get'
          ? result.note.title
          : result.notes.find((row) => row.id === noteId).title;
      await expect(
        note.getByRole('heading', { level: 2, name: title, exact: true }).first(),
      ).toBeFocused();
      await expect(page).toHaveURL(url);
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      if (method === 'note.get') {
        await note.getByRole('button', { name: 'Source', exact: true }).click();
        await expect(page.getByTestId('note-content')).toHaveText(
          reads().at(-1).response.result.note.content,
        );
      } else await expect(page.getByTestId('note-rendered-content')).toBeVisible();
      const recoveredScreenshot = info.outputPath('note-retry-recovered.png');
      await page.screenshot({ path: recoveredScreenshot });
      await info.attach('note-retry-recovered', {
        path: recoveredScreenshot,
        contentType: 'image/png',
      });
      await page.getByRole('link', { name: 'All notes', exact: true }).click();
      await expect(page.getByRole('searchbox')).toHaveValue(noteId);
      await expect(page.locator(`a[data-note-id="${noteId}"]`)).toBeFocused();
      expect(
        requests.filter(({ method: name }) =>
          /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
            name ?? '',
          ),
        ),
      ).toEqual([]);
      const expectedLogs =
        method === 'note.list'
          ? errors.filter(
              (error) =>
                error.startsWith('console: ') &&
                error.includes('[NotesReadSaga] Failed to hydrate workspace notes') &&
                error.includes('"name":"BackendError"') &&
                error.includes('"message":"Internal error"'),
            )
          : [];
      const failures = reads().filter(({ response }) => response.error);
      for (const { response } of failures)
        expect(response.error.data).toContain('column created_at');
      if (method === 'note.list') {
        expect(expectedLogs.length).toBeGreaterThan(0);
        expect(expectedLogs.length).toBeLessThanOrEqual(failures.length);
      }
      expect(errors.filter((error) => !expectedLogs.includes(error))).toEqual([]);
    } finally {
      await restore?.();
      await info.attach('note-retry-wire', {
        body: JSON.stringify(
          { ...wire, errors, failure: 'Real database type error in disposable workspace' },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    }
  });
}
