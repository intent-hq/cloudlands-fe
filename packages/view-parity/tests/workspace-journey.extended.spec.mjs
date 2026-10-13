import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function connections(port) {
  const { stdout } = await exec('ss', ['-Htn', 'state', 'established', `( sport = :${port} )`]);
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).slice(-2).join(' '));
}

test('real workspace summary survives list navigation and releases its browser connection', async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  const baseUrl = process.env.REACT_BASE_URL;
  const workspaceId = process.env.REACT_WORKSPACE_ID;
  if (!baseUrl || !workspaceId)
    throw new Error('Set REACT_BASE_URL and REACT_WORKSPACE_ID for the real daemon journey');
  const endpoint = new URL(baseUrl);
  if (process.platform !== 'linux' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname))
    throw new Error(
      'Run against an owned loopback Vite server on Linux for socket cleanup evidence',
    );
  const port = endpoint.port || '80';
  const beforeConnections = new Set(await connections(port));
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  const errors = await observeErrors(page);
  const requests = [];
  const pending = new Map();
  const sockets = [];
  let ownedConnections = [];
  let workspace;
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    sockets.push(socket);
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      requests.push(request);
      if (request.method === 'workspace.list') pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      if (!pending.has(response.id)) return;
      expect(pending.get(response.id).params).toEqual({ includeArchived: true });
      workspace = response.result?.workspaces?.find((row) => row.id === workspaceId);
    });
  });
  try {
    await page.goto(`${baseUrl}/workspaces/`);
    await expect
      .poll(() => workspace, {
        timeout: 60_000,
        message: 'The real daemon must return the requested existing workspace',
      })
      .toBeTruthy();
    const list = page.getByTestId('workspace-list');
    const href = `/workspaces/${encodeURIComponent(workspaceId)}`;
    await list.locator(`a[href="${href}"]`).click();
    const overview = page.getByTestId('workspace-overview');
    await expect(overview).toHaveAttribute('data-workspace-id', workspaceId);
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText(workspace.title);
    await expect(overview.getByTestId('workspace-branch')).toHaveText(workspace.branch);
    await expect(overview.getByTestId('workspace-repository')).toHaveText(
      workspace.repositoryName ?? '',
    );
    await expect(overview.getByTestId('workspace-status')).toHaveText(workspace.status);
    if (workspace.statusMessage)
      await expect(overview.getByTestId('workspace-status-message')).toHaveText(
        workspace.statusMessage,
      );
    await overview.getByRole('link', { name: 'Workspaces', exact: true }).click();
    await expect(overview).toHaveCount(0);
    await list.locator(`a[href="${href}"]`).click();
    await expect(overview.getByRole('heading', { level: 1 })).toHaveText(workspace.title);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath('real-workspace.png') });
    await info.attach('real-workspace', {
      path: info.outputPath('real-workspace.png'),
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
    expect(requests.some((request) => request.method === 'workspace.list')).toBe(true);
    expect(
      requests.filter((request) =>
        /\.(set|update|create|delete|markSeen|execute|open)$/.test(request.method ?? ''),
      ),
    ).toEqual([]);
    expect(sockets.length).toBeGreaterThan(0);
    ownedConnections = (await connections(port)).filter((row) => !beforeConnections.has(row));
    expect(ownedConnections.length).toBeGreaterThan(0);
    await context.close();
    await expect
      .poll(async () => (await connections(port)).filter((row) => ownedConnections.includes(row)))
      .toEqual([]);
  } finally {
    await context.close();
    await info.attach('workspace-journey-wire', {
      body: JSON.stringify(
        {
          requests,
          workspace,
          ownedConnections,
          remainingConnections: await connections(port),
          daemonSockets: sockets.length,
          errors,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});
