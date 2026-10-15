import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// These owned socket calls corroborate persistence; navigation uses native UI input.
function ownedRead(method, params) {
  if (!['agent.get', 'agent.getConversation', 'note.list'].includes(method))
    throw new Error('Read-only corroboration required');
  return new Promise((resolve, reject) => {
    const socket = connect('/owned/data/intentd.sock');
    let buffer = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('Owned daemon timeout')));
    socket.on('error', reject);
    socket.on('connect', () =>
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n'),
    );
    socket.on('data', (bytes) => {
      buffer += bytes.toString();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.id !== 1) continue;
        socket.end();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  });
}
for (const width of [1280, 420]) {
  test(`owned quick switcher navigation at ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const base = process.env.REACT_BASE_URL,
      fixturePath = process.env.ISOLATED_QUICK_SWITCHER_FIXTURES;
    if (!base || !fixturePath || process.env.ISOLATED_QUICK_SWITCHER_READS !== 'owned-test-daemon')
      throw new Error('Owned read-only switcher fixtures required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')),
      f = fixtures.find((row) => row.width === width),
      other = fixtures.find((row) => row.width !== width);
    expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const { workspaceId, agentId, siblingId, repositoryPath } = f;
    expect(repositoryPath).toMatch(/^\/owned\/workspaces\//);
    const git = (...args) =>
      execFileSync(
        'git',
        ['-c', `safe.directory=${repositoryPath}`, '-C', repositoryPath, ...args],
        { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      );
    const disk = async () => ({
      head: git('rev-parse', 'HEAD'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain'),
      files: await Promise.all(
        Object.keys(f.files).map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(repositoryPath + '/' + path))
            .digest('hex'),
        ]),
      ),
    });
    const before = await disk();
    const readAgent = (id) => ownedRead('agent.get', { workspaceId, agentId: id });
    const agentsBefore = await Promise.all([readAgent(agentId), readAgent(siblingId)]),
      notesBefore = await ownedRead('note.list', { workspaceId }),
      otherNotesBefore = await ownedRead('note.list', { workspaceId: other.workspaceId });
    const requests = [],
      replies = [],
      inputs = [],
      geometry = [],
      errors = await observeErrors(page);
    let connection = 0;
    const closedConnections = [];
    const socketLifecycle = [];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', ({ requestId, url }) => {
      if (new URL(url).pathname === '/intentd/ws')
        socketLifecycle.push({ requestId, closed: false });
    });
    cdp.on('Network.webSocketClosed', ({ requestId }) => {
      const entry = socketLifecycle.find((row) => row.requestId === requestId);
      if (entry) entry.closed = true;
    });
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const observedConnection = ++connection;
      socket.on('close', () => closedConnections.push(observedConnection));
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const req = JSON.parse(String(payload));
        req.observedConnection = observedConnection;
        requests.push(req);
        pending.set(req.id, req);
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
    await page.exposeFunction('recordSwitcherInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      window.__switcherSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__switcherSockets.push(this);
        }
      };
      document.addEventListener('input', (event) => {
        if (
          event.target instanceof window.HTMLInputElement &&
          event.target.getAttribute('role') === 'combobox'
        )
          window.recordSwitcherInput({ trusted: event.isTrusted, value: event.target.value });
      });
    });
    const opener = page.getByRole('button', { name: /Quick switcher/ }),
      dialog = page.getByRole('dialog', { name: 'Quick switcher' }),
      search = dialog.getByRole('combobox');
    const pick = (id) => dialog.getByRole('option').filter({ hasText: id });
    const open = async () => {
      await opener.click();
      await expect(search).toBeFocused();
    };
    const capture = async (label) => {
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        width,
        dialog: await dialog.boundingBox(),
        input: await search.boundingBox(),
        overflow: await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      });
      const attempts = [];
      await writeFile(
        info.outputPath(label + '.png'),
        await stableLocatorScreenshot(page, dialog, ({ png: _png, ...a }) => attempts.push(a)),
      );
      await writeFile(
        info.outputPath(label + '-stability.json'),
        JSON.stringify(attempts, null, 2),
      );
    };
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + '/workspaces?q=Switcher');
      await expect(opener).toBeVisible({ timeout: 30000 });
      await open();
      await expect(pick(workspaceId)).toBeVisible({ timeout: 30000 });
      expect(await dialog.getByText(/Conversations in /).count()).toBe(0);
      await search.pressSequentially(workspaceId);
      await expect(pick(workspaceId)).toBeVisible();
      await capture('home');
      await search.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(new URL(page.url()).searchParams.get('q')).toBe('Switcher');
      await opener.press('ControlOrMeta+k');
      await expect(search).toBeFocused();
      await search.fill(workspaceId);
      await search.press('Enter');
      await expect(page).toHaveURL(new RegExp('/workspaces/' + workspaceId));
      await open();
      await search.fill('Duplicate');
      await expect(pick(agentId)).toBeVisible({ timeout: 30000 });
      await expect(pick(siblingId)).toBeVisible();
      await capture('conversations');
      if (width === 1280) {
        await search.fill(siblingId);
        await search.press('Enter');
      } else await pick(siblingId).click();
      await expect(page.getByTestId('workspace-conversation')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30000 },
      );
      expect(new URL(page.url()).searchParams.get('agent')).toBe(siblingId);
      await page.goBack();
      await expect(page).not.toHaveURL(/agent=/);
      await open();
      await search.fill(agentId);
      await pick(agentId).click();
      await expect(page.getByTestId('workspace-conversation')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30000 },
      );
      await page.reload();
      await expect(opener).toBeVisible({ timeout: 30000 });
      await open();
      await expect(pick(agentId)).toBeVisible({ timeout: 30000 });
      await search.press('Escape');
      const reconnectConnection = connection;
      const previous = await page.evaluate(() => {
        const count = window.__switcherSockets.length;
        for (const socket of window.__switcherSockets) socket.close();
        return count;
      });
      await expect
        .poll(
          () =>
            page.evaluate(
              (count) =>
                window.__switcherSockets.length > count &&
                window.__switcherSockets.at(-1).readyState === WebSocket.OPEN,
              previous,
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      await open();
      await expect(pick(siblingId)).toBeVisible({ timeout: 30000 });
      await capture('reconnected');
      await search.press('Escape');
      await page.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      const files = page.getByTestId('workspace-file-browser');
      await files.getByRole('treeitem', { name: 'sentinel.txt', exact: true }).click();
      const editor = page.getByRole('textbox', { name: 'Workspace text editor' });
      await expect(editor).toBeVisible();
      await editor.press('ControlOrMeta+End');
      await page.keyboard.insertText('Unsaved switcher draft Ω');
      await open();
      await search.fill(other.workspaceId);
      await pick(other.workspaceId).click();
      const guard = page.getByRole('dialog');
      await guard.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(editor).toBeFocused();
      expect(new URL(page.url()).pathname).toBe('/workspaces/' + workspaceId);
      await open();
      await search.fill(other.workspaceId);
      await pick(other.workspaceId).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Discard unsaved edits', exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp('/workspaces/' + other.workspaceId));
      await page.getByRole('link', { name: 'Unchanged plan', exact: true }).click();
      await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
      const noteEditor = page.getByRole('textbox', { name: 'Note Markdown editor' });
      await expect(noteEditor).toBeVisible({ timeout: 30000 });
      await page.getByTestId('workspace-text-editor').click({ position: { x: 120, y: 35 } });
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.insertText('Unsaved quick-switcher note Ω');
      await open();
      await search.fill(workspaceId);
      await pick(workspaceId).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(noteEditor).toBeFocused();
      await expect(page.getByTestId('workspace-note-editor')).toHaveAttribute(
        'data-note-dirty',
        'true',
      );
      await open();
      await search.fill(workspaceId);
      await pick(workspaceId).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Discard unsaved edits', exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp('/workspaces/' + workspaceId));
      await open();
      await search.fill('no-such-switcher-xyz');
      await expect(dialog.getByText('No results found')).toBeVisible();
      await search.press('Escape');
      await expect(opener).toBeFocused();
      expect(await disk()).toEqual(before);
      expect(await Promise.all([readAgent(agentId), readAgent(siblingId)])).toEqual(agentsBefore);
      expect(await ownedRead('note.list', { workspaceId })).toEqual(notesBefore);
      expect(await ownedRead('note.list', { workspaceId: other.workspaceId })).toEqual(
        otherNotesBefore,
      );
      expect(
        requests.filter((r) =>
          /^(agent\.(sendMessage|queueMessage|stop|create|rename|delete)|workspace\.(create|update|delete)|note\.(create|setContent|update|delete)|file\.write|git\.(stage|agentCommit))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.length).toBeGreaterThan(5);
      expect(inputs.every((row) => row.trusted)).toBe(true);
      expect(geometry.every((row) => row.overflow.scrollWidth <= width)).toBe(true);
      await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await expect
        .poll(
          () =>
            replies.filter(
              ({ request, response }) => request.method === 'events.unsubscribe' && !response.error,
            ).length,
        )
        .toBeGreaterThan(0);
      await expect
        .poll(() => {
          const activeMetadata = replies.filter(
            ({ request, response }) =>
              request.method === 'agent.subscribe' &&
              request.observedConnection === connection &&
              response.result?.subscriptionId,
          );
          return activeMetadata.filter(
            ({ response }) =>
              !replies.some(
                (row) =>
                  row.request.method === 'events.unsubscribe' &&
                  row.request.params.subscriptionId === response.result.subscriptionId &&
                  row.response.result?.success === true,
              ),
          ).length;
        })
        .toBe(0);
      await expect.poll(() => closedConnections.includes(reconnectConnection)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            fixture: f,
            before,
            requests,
            replies,
            inputs,
            geometry,
            closedConnections,
            socketLifecycle,
            errors,
          },
          null,
          2,
        ),
      );
      await page.goto('about:blank');
      await cdp.detach();
    }
  });
}
