import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection('/owned/data/intentd.sock');
    const id = randomUUID();
    let pending = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('Owned terminal RPC timeout')));
    socket.on('error', reject);
    socket.on('connect', () =>
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'),
    );
    socket.on('data', (chunk) => {
      pending += chunk;
      while (pending.includes('\n')) {
        const end = pending.indexOf('\n'),
          message = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (message.id !== id) continue;
        socket.end();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  });
}
for (const width of [1280, 420])
  test(`owned interactive terminal lifecycle at ${width}`, async ({ page }, info) => {
    test.setTimeout(180000);
    const base = process.env.REACT_BASE_URL;
    if (
      !base ||
      process.env.ISOLATED_TERMINAL_WRITES !== 'owned-test-daemon' ||
      !process.env.ISOLATED_TERMINAL_FIXTURES
    )
      throw new Error('Owned terminal fixture required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixture = JSON.parse(await readFile(process.env.ISOLATED_TERMINAL_FIXTURES, 'utf8')).find(
      (f) => f.width === width,
    );
    expect(fixture.repositoryPath).toMatch(/^\/owned\/terminal-(1280|420)$/);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const git = (...args) =>
      execFileSync(
        'git',
        ['-c', `safe.directory=${fixture.repositoryPath}`, '-C', fixture.repositoryPath, ...args],
        { encoding: 'utf8' },
      ).trim();
    expect(git('remote')).toBe('');
    expect(git('rev-parse', 'HEAD')).toBe(fixture.baseSha);
    const index = git('ls-files', '--stage'),
      bytes = await readFile(fixture.repositoryPath + '/untouched.txt');
    const requests = [],
      replies = [],
      inputs = [],
      geometry = [];
    const errors = await observeErrors(page);
    let terminalId;
    await page.exposeBinding('__terminalNativeInput', (_source, event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      const Native = window.WebSocket;
      window.__terminalOwnedSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__terminalOwnedSockets.push(this);
        }
      };
      window.addEventListener(
        'keydown',
        (event) => window.__terminalNativeInput({ key: event.key, trusted: event.isTrusted }),
        true,
      );
      window.addEventListener(
        'input',
        (event) => window.__terminalNativeInput({ input: true, trusted: event.isTrusted }),
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
        const response = JSON.parse(String(payload));
        const request = pending.get(response.id);
        if (request) {
          pending.delete(response.id);
          replies.push({ request, response });
        }
      });
    });
    const panel = page.getByTestId('workspace-terminals'),
      view = page.getByTestId('workspace-terminal-view');
    const activate = async (locator) => {
      await expect(locator).toBeEnabled();
      if (width === 1280) {
        await locator.focus();
        await page.keyboard.press('Enter');
      } else await locator.click();
    };
    const capture = async (label) => {
      await panel.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        box: await panel.boundingBox(),
        scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      });
      const attempts = [];
      await writeFile(
        info.outputPath(label + '.png'),
        await stableLocatorScreenshot(page, panel, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(
        info.outputPath(label + '-stability.json'),
        JSON.stringify(attempts, null, 2),
      );
    };
    const buffer = async () =>
      Buffer.from(
        (await rpc('terminal.getBuffer', { workspaceId: fixture.workspaceId, terminalId })).data,
        'base64',
      ).toString('utf8');
    const command = async (text) => {
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready');
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.insertText(text);
      await page.keyboard.press('Enter');
    };
    const writes = () =>
      requests
        .filter((r) => r.method === 'terminal.write')
        .map((r) => Buffer.from(r.params.data, 'base64').toString('utf8'))
        .join('');
    const readOwners = () =>
      page.evaluate(async () => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/src/store/index.ts'));
        if (!resource) throw new Error('Store provenance missing');
        const { store } = await import(resource.name);
        return store.state.terminals;
      });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${fixture.workspaceId}`);
      await expect(panel).toBeVisible({ timeout: 30000 });
      await expect(panel.getByText('No terminals open', { exact: true })).toBeVisible();
      await capture('before');
      await activate(panel.getByRole('button', { name: 'New Terminal', exact: true }));
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready', { timeout: 30000 });
      terminalId = await view.getAttribute('data-terminal-id');
      expect(terminalId).toBeTruthy();
      expect(
        (await rpc('terminal.list', { workspaceId: fixture.workspaceId })).terminals.map(
          (t) => t.id,
        ),
      ).toEqual([terminalId]);
      await command('pwd');
      await expect.poll(buffer).toContain(fixture.repositoryPath);
      const unicode = `printf 'terminal-%s\\n' '雪-${width}'`;
      await command(unicode);
      await expect.poll(buffer).toContain(`terminal-雪-${width}`);
      await capture('output');
      const resizeCount = requests.filter((r) => r.method === 'terminal.resize').length;
      await page.setViewportSize({ width: width === 1280 ? 1000 : 460, height: 760 });
      await expect
        .poll(() => requests.filter((r) => r.method === 'terminal.resize').length)
        .toBeGreaterThan(resizeCount);
      await expect
        .poll(() => requests.filter((r) => r.method === 'terminal.resize').at(-1)?.params.cols)
        .toBeGreaterThan(10);
      await command('stty size');
      const size = requests.filter((r) => r.method === 'terminal.resize').at(-1).params;
      await expect
        .poll(buffer)
        .toMatch(new RegExp(`(?:^|[\\r\\n])${size.rows} ${size.cols}(?:[\\r\\n]|$)`));
      await page.setViewportSize({ width, height: 900 });
      const inputBefore = writes();
      await activate(panel.getByRole('button', { name: 'Hide terminal', exact: true }));
      await expect(view).toHaveCount(0);
      expect(
        (await rpc('terminal.list', { workspaceId: fixture.workspaceId })).terminals.map(
          (t) => t.id,
        ),
      ).toEqual([terminalId]);
      await activate(panel.getByRole('button', { name: 'Open', exact: true }));
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready');
      await activate(
        page
          .getByTestId('workspace-overview')
          .getByRole('link', { name: 'Workspaces', exact: true }),
      );
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await expect(page.locator('.xterm')).toHaveCount(0);
      await expect
        .poll(async () => (await readOwners()).workspaces[fixture.workspaceId])
        .toBeUndefined();
      await page.goBack();
      await expect(panel).toBeVisible();
      await activate(panel.getByRole('button', { name: 'Open', exact: true }));
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready');
      const other = JSON.parse(await readFile(process.env.ISOLATED_TERMINAL_FIXTURES, 'utf8')).find(
        (f) => f.width !== width,
      );
      await activate(
        page
          .getByTestId('workspace-overview')
          .getByRole('link', { name: 'Workspaces', exact: true }),
      );
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await activate(
        page.getByTestId('workspace-list').locator(`a[href="/workspaces/${other.workspaceId}"]`),
      );
      await expect(page).toHaveURL(`${base}/workspaces/${other.workspaceId}`);
      await expect(page.locator('.xterm')).toHaveCount(0);
      await activate(
        page
          .getByTestId('workspace-overview')
          .getByRole('link', { name: 'Workspaces', exact: true }),
      );
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await activate(
        page.getByTestId('workspace-list').locator(`a[href="/workspaces/${fixture.workspaceId}"]`),
      );
      await expect(panel).toBeVisible();
      await activate(panel.getByRole('button', { name: 'Open', exact: true }));
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready');
      await page.reload();
      await expect(panel).toBeVisible({ timeout: 30000 });
      await activate(panel.getByRole('button', { name: 'Open', exact: true }));
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready');
      await activate(view.getByRole('button', { name: 'Reconnect', exact: true }));
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready');
      const listsBeforeReconnect = replies.filter(
        (r) => r.request.method === 'terminal.list',
      ).length;
      const buffersBeforeReconnect = replies.filter(
        (r) => r.request.method === 'terminal.getBuffer',
      ).length;
      await page.evaluate(() => window.__terminalOwnedSockets.at(-1).close());
      await expect
        .poll(() => replies.filter((r) => r.request.method === 'terminal.list').length, {
          timeout: 30000,
        })
        .toBeGreaterThan(listsBeforeReconnect);
      await expect(panel).toBeVisible();
      await activate(panel.getByRole('button', { name: 'Open', exact: true }));
      await expect
        .poll(() => replies.filter((r) => r.request.method === 'terminal.getBuffer').length)
        .toBeGreaterThan(buffersBeforeReconnect);
      await expect(view).toHaveAttribute('data-terminal-phase', 'ready', { timeout: 30000 });
      expect(writes()).toBe(inputBefore);
      await command(`printf 'reconnected-${width}\\n'`);
      await expect.poll(buffer).toContain(`reconnected-${width}`);
      await capture('reconnected');
      expect(requests.filter((r) => r.method === 'terminal.create')).toHaveLength(1);
      expect(writes()).toBe(`pwd\r${unicode}\rstty size\rprintf 'reconnected-${width}\\n'\r`);
      await activate(panel.getByRole('button', { name: 'Close Terminal', exact: true }));
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await activate(dialog.getByRole('button', { name: 'Close Terminal', exact: true }));
      await expect(panel.getByText('No terminals open', { exact: true })).toBeVisible();
      await expect(page.locator('.xterm')).toHaveCount(0);
      expect((await rpc('terminal.list', { workspaceId: fixture.workspaceId })).terminals).toEqual(
        [],
      );
      expect(requests.filter((r) => r.method === 'terminal.kill')).toHaveLength(1);
      expect(replies.find((r) => r.request.method === 'terminal.kill')?.response.result).toEqual({
        ok: true,
      });
      await capture('closed');
      expect(git('ls-files', '--stage')).toBe(index);
      expect(await readFile(fixture.repositoryPath + '/untouched.txt')).toEqual(bytes);
      expect(git('status', '--porcelain')).toBe('');
      expect(
        requests.filter((r) =>
          /^(file\.(write|delete|rename)|git\.(stage|agentCommit|push)|agent\.(create|sendMessage))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.some((e) => e.trusted && e.input)).toBe(true);
      expect(geometry.every((g) => g.scrollWidth <= g.width)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('terminal-evidence.json'),
        JSON.stringify(
          {
            fixture,
            terminalId,
            requests,
            replies,
            inputs,
            geometry,
            errors,
            owners: await readOwners().catch(String),
            buffer: terminalId ? await buffer().catch(String) : null,
          },
          null,
          2,
        ),
      );
      // Only fixture-owned PTYs: teardown after failed assertions must not leak processes.
      for (const terminal of (await rpc('terminal.list', { workspaceId: fixture.workspaceId }))
        .terminals)
        await rpc('terminal.kill', { workspaceId: fixture.workspaceId, terminalId: terminal.id });
    }
  });
