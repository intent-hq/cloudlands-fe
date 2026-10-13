import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

function observeWorkspaces(page) {
  const requests = [];
  const rows = [];
  const pending = new Map();
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      requests.push(request);
      pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (request?.method === 'workspace.list' && response.result)
        rows.splice(0, rows.length, ...response.result.workspaces);
    });
  });
  return { requests, rows };
}

function environment() {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const file = 'apps/react/src/features/workspace/workspace-git-status.tsx';
  return {
    workspaceId,
    file,
    url: `${base}/workspaces/${encodeURIComponent(workspaceId)}?file=${encodeURIComponent(file)}`,
  };
}

async function readWorkspaceState(page, workspaceId) {
  return page.evaluate(async (id) => {
    const module = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname.endsWith('/src/store/index.ts'));
    if (!module) throw new Error('The running Store was not observed');
    const { store } = await import(module.name);
    return {
      files: store.state.files.byWorkspaceId[id] ?? null,
      notes: store.state.workspaceNotes.byWorkspaceId[id] ?? null,
      git: store.state.git.byWorkspaceId[id] ?? null,
    };
  }, workspaceId);
}

for (const mode of ['desktop keyboard', 'mobile drawer']) {
  test(`workspace navigation preserves read ownership with ${mode}`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const { workspaceId, url } = environment();
    const wire = observeWorkspaces(page);
    const errors = await observeErrors(page);
    const mobile = mode === 'mobile drawer';
    await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
    await page.setViewportSize(mobile ? { width: 420, height: 900 } : { width: 1200, height: 800 });
    const navigation = page.getByTestId('workspace-navigation');
    const trigger = page.locator('[data-sidebar="trigger"]');
    const current = navigation.locator(`[data-navigation-workspace="${workspaceId}"]`);
    try {
      await page.goto(url);
      await expect(page.getByTestId('workspace-file-content')).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => wire.rows.length).toBeGreaterThan(1);
      if (mobile) {
        await expect(navigation).toBeHidden();
        await trigger.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.click();
      }
      await expect(current).toHaveAttribute('aria-current', 'page');
      await current.focus();
      await page.keyboard.press('End');
      const last = navigation.locator('[data-navigation-workspace]').last();
      await expect(last).toBeFocused();
      await expect
        .poll(() =>
          last.evaluate((element) => {
            const row = element.getBoundingClientRect();
            const viewport = element.closest('[data-sidebar="content"]').getBoundingClientRect();
            return row.top >= viewport.top - 1 && row.bottom <= viewport.bottom + 1;
          }),
        )
        .toBe(true);
      await current.focus();
      await page.keyboard.press('ArrowDown');
      const next = navigation.locator('[data-navigation-workspace]:focus');
      const targetId = await next.getAttribute('data-navigation-workspace');
      expect(targetId).not.toBe(workspaceId);
      const target = wire.rows.find((row) => row.id === targetId);
      expect(target).toBeTruthy();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('workspace-overview')).toHaveAttribute(
        'data-workspace-id',
        targetId,
      );
      await expect(
        page.getByTestId('workspace-overview').getByRole('heading', { level: 1 }),
      ).toHaveText(target.title);
      await expect
        .poll(() => readWorkspaceState(page, workspaceId))
        .toEqual({ files: null, notes: null, git: null });
      expect(new URL(page.url()).search).toBe('');
      if (mobile) {
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(trigger).toBeFocused();
      } else {
        await expect(navigation.locator(`[data-navigation-workspace="${targetId}"]`)).toBeFocused();
        await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute(
          'data-navigation-workspace',
          targetId,
        );
      }
      await page.goBack();
      await expect(page.getByTestId('workspace-file-content')).toBeVisible();
      await expect
        .poll(() => readWorkspaceState(page, targetId))
        .toEqual({ files: null, notes: null, git: null });
      if (mobile) await trigger.click();
      await expect(current).toHaveAttribute('aria-current', 'page');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1);
      await page.evaluate(() => document.fonts.ready);
      const screenshot = info.outputPath(
        mobile ? 'workspace-navigation-mobile.png' : 'workspace-navigation-desktop.png',
      );
      await page.screenshot({ path: screenshot });
      await info.attach('workspace-navigation', { path: screenshot, contentType: 'image/png' });
      if (mobile) {
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
      } else {
        await trigger.click();
        await expect(navigation).not.toBeInViewport();
        await expect(page.getByRole('navigation', { name: 'Workspaces', exact: true })).toHaveCount(
          0,
        );
        await page.keyboard.press('Tab');
        expect(
          await navigation.evaluate((element) => element.contains(document.activeElement)),
        ).toBe(false);
        await expect(page.getByTestId('workspace-file-content')).toBeVisible();
        await trigger.click();
        await expect(navigation).toBeInViewport();
        await expect(
          page.getByRole('navigation', { name: 'Workspaces', exact: true }),
        ).toBeVisible();
      }
      expect(
        wire.requests.filter(({ method }) =>
          /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await info.attach('navigation-wire', {
        body: JSON.stringify({ ...wire, errors }, null, 2),
        contentType: 'application/json',
      });
    }
  });
}
