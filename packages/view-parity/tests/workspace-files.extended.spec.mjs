import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

function observeFileReads(page) {
  const requests = [];
  const replies = [];
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
      if (request?.method === 'file.read' || request?.method === 'search.fileNames')
        replies.push({ request, response });
    });
  });
  return { requests, replies };
}

function environment() {
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  return { workspaceId, url: `${base}/workspaces/${encodeURIComponent(workspaceId)}` };
}

async function readFileState(page, workspaceId) {
  return page.evaluate(async (id) => {
    const module = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname.endsWith('/src/store/index.ts'));
    if (!module) throw new Error('The running Store was not observed');
    const { store } = await import(module.name);
    return store.state.files.byWorkspaceId[id]?.files.map ?? {};
  }, workspaceId);
}

test('real file contents survive navigation and release their read lifetime', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const { workspaceId, url } = environment();
  const file = 'apps/react/src/features/workspace/workspace-git-status.tsx';
  const noteId = 'e5250bf8-08d9-445d-8a1d-d195c59ca4b2';
  const wire = observeFileReads(page);
  const errors = await observeErrors(page);
  const view = page.getByTestId('workspace-file');
  const content = page.getByTestId('workspace-file-content');
  const successful = () =>
    wire.replies.filter(
      ({ request, response }) =>
        request.method === 'file.read' &&
        request.params.path === file &&
        typeof response.result === 'string',
    );
  const assertContent = async () => {
    await expect.poll(() => successful().length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(successful().at(-1).request.params).toEqual({ workspaceId, path: file });
    const expected = successful()
      .at(-1)
      .response.result.split('\n')
      .map((line) => line || ' ');
    await expect.poll(() => content.locator('.code-line').allTextContents()).toEqual(expected);
  };
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(url);
    const opener = page.locator(`a[data-file-path="${file}"]`);
    await expect(opener).toBeVisible({ timeout: 60_000 });
    await opener.focus();
    await page.keyboard.press('Enter');
    await assertContent();
    await expect(view.getByRole('heading')).toBeFocused();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath('real-workspace-file.png') });
    await info.attach('real-workspace-file', {
      path: info.outputPath('real-workspace-file.png'),
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 420, height: 900 });
    await expect
      .poll(() => view.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    await expect(view.getByRole('link', { name: 'Back', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('real-workspace-file-narrow.png') });
    await info.attach('real-workspace-file-narrow', {
      path: info.outputPath('real-workspace-file-narrow.png'),
      contentType: 'image/png',
    });
    await view.getByRole('link', { name: 'Back', exact: true }).click();
    await expect(opener).toBeFocused();
    await expect.poll(() => readFileState(page, workspaceId)).toEqual({});
    await page.goto(`${url}?note=${noteId}&q=${noteId}`);
    await page
      .getByTestId('workspace-note')
      .getByRole('link', { name: 'React Git list', exact: true })
      .click();
    await assertContent();
    expect(new URL(page.url()).searchParams.get('note')).toBe(noteId);
    expect(new URL(page.url()).searchParams.get('q')).toBe(noteId);
    expect(new URL(page.url()).searchParams.get('line')).toBe('1');
    await page.reload();
    await assertContent();
    await view.getByRole('link', { name: 'Back', exact: true }).click();
    await expect(
      page.getByTestId('workspace-note').locator('header').getByRole('heading'),
    ).toBeFocused();
    await expect.poll(() => readFileState(page, workspaceId)).toEqual({});
    await page.goBack();
    await assertContent();
    await page.evaluate(async () => {
      const module = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname.endsWith('/backend-transport-factory.ts'));
      if (!module) throw new Error('The real backend transport was not observed');
      const { resolveBackendTransport } = await import(module.name);
      const socket = resolveBackendTransport().socket;
      if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
        throw new Error('Expected the actual daemon socket');
      await new Promise((resolve) => {
        socket.addEventListener('close', resolve, { once: true });
        socket.close();
      });
    });
    await page.context().setOffline(true);
    await expect.poll(() => readFileState(page, workspaceId)).toEqual({});
    await expect(content).toHaveCount(0);
    const beforeReconnect = successful().length;
    await page.context().setOffline(false);
    await expect
      .poll(() => successful().length, { timeout: 30_000 })
      .toBeGreaterThan(beforeReconnect);
    await assertContent();
    await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await expect.poll(() => readFileState(page, workspaceId)).toEqual({});
    expect(
      wire.requests.filter(({ method }) =>
        /\.(write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|update|setContent)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('file-wire', {
      body: JSON.stringify({ ...wire, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});

test('real missing, binary and invalid paths have explicit read-only outcomes', async ({
  page,
}, info) => {
  const { workspaceId, url } = environment();
  const wire = observeFileReads(page);
  const view = page.getByTestId('workspace-file');
  try {
    await page.goto(
      `${url}?file=${encodeURIComponent('recovery-missing-file-does-not-exist.txt')}`,
    );
    await expect(view.getByRole('alert')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('workspace-file-content')).toHaveCount(0);
    expect(
      wire.replies.find(({ request }) => request.method === 'file.read')?.response.error,
    ).toBeTruthy();
    expect(
      wire.requests.some(
        ({ method, params }) =>
          method === 'search.fileNames' &&
          params.workspaceId === workspaceId &&
          params.pattern === 'recovery-missing-file-does-not-exist.txt' &&
          params.limit === 50,
      ),
    ).toBe(true);
    const beforeRetry = wire.replies.length;
    await view.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => wire.replies.length).toBeGreaterThan(beforeRetry);
    await expect(view.getByRole('alert')).toBeVisible();
    await page.goto(`${url}?file=workspace-file.tsx`);
    const candidate = view.getByRole('link', {
      name: 'apps/react/src/features/workspace/workspace-file.tsx',
      exact: true,
    });
    await candidate.click();
    await expect(page.getByTestId('workspace-file-content')).toBeVisible();
    await page.goto(`${url}?file=static%2Ffavicon.png`);
    await expect(
      view.getByText('Binary file - cannot be displayed', { exact: true }),
    ).toBeVisible();
    const beforeInvalid = wire.requests.filter(({ method }) => method === 'file.read').length;
    await page.goto(`${url}?file=..%2Fpackage.json`);
    await expect(view.getByRole('alert')).toBeVisible();
    expect(wire.requests.filter(({ method }) => method === 'file.read')).toHaveLength(
      beforeInvalid,
    );
  } finally {
    await info.attach('file-outcomes-wire', {
      body: JSON.stringify(wire, null, 2),
      contentType: 'application/json',
    });
  }
});
