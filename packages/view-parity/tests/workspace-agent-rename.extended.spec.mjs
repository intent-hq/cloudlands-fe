import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// These owned socket calls corroborate persistence; rename itself uses native UI input.
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
  test(`owned conversation rename at ${width}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL,
      fixturePath = process.env.ISOLATED_AGENT_RENAME_FIXTURES;
    if (!base || !fixturePath || process.env.ISOLATED_AGENT_RENAME_WRITES !== 'owned-test-daemon')
      throw new Error('Owned idle agent fixtures required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')).find((f) => f.width === width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const { workspaceId, agentId, siblingId, repositoryPath } = fixture;
    expect(repositoryPath).toMatch(/^\/owned\/workspaces\//);
    const git = (...args) =>
      execFileSync(
        'git',
        ['-c', `safe.directory=${repositoryPath}`, '-C', repositoryPath, ...args],
        { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      );
    const before = {
      head: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain'),
    };
    const readAgent = (id) => ownedRead('agent.get', { workspaceId, agentId: id });
    const mainBefore = await readAgent(agentId),
      siblingBefore = await readAgent(siblingId);
    const transcriptBefore = await ownedRead('agent.getConversation', { workspaceId, agentId });
    const siblingTranscriptBefore = await ownedRead('agent.getConversation', {
      workspaceId,
      agentId: siblingId,
    });
    const notesBefore = await ownedRead('note.list', { workspaceId });
    expect(mainBefore.agent.turnInFlight).toBe(false);
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      inputs = [],
      geometry = [];
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const request = JSON.parse(String(payload));
        requests.push(request);
        pending.set(request.id, request);
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
    await page.exposeFunction('recordRenameInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      const Native = window.WebSocket;
      window.__renameOwnedSockets = [];
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          if (new URL(String(args[0]), window.location.href).pathname === '/intentd/ws')
            window.__renameOwnedSockets.push(this);
        }
      };
      document.addEventListener('input', (event) => {
        if (
          event.target instanceof window.HTMLInputElement &&
          event.target.closest('[data-testid=workspace-conversation] h2')
        )
          window.recordRenameInput({ trusted: event.isTrusted, value: event.target.value });
      });
    });
    const conversation = page.getByTestId('workspace-conversation'),
      heading = conversation.getByRole('heading', { level: 2 });
    const editor = heading.getByRole('textbox'),
      rename = heading.getByRole('button');
    const updates = () => requests.filter((r) => r.method === 'agent.rename');
    const capture = async (label) => {
      await heading.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        width,
        heading: await heading.boundingBox(),
        container: await conversation.boundingBox(),
        overflow: await page.evaluate(() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      });
      const attempts = [];
      await writeFile(
        info.outputPath(label + '.png'),
        await stableLocatorScreenshot(page, conversation, ({ png: _png, ...a }) =>
          attempts.push(a),
        ),
      );
      await writeFile(
        info.outputPath(label + '-stability.json'),
        JSON.stringify(attempts, null, 2),
      );
    };
    let accepted, mainAfter, reconnect;
    const sourceModules = [];
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}`);
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
      await expect(rename).toBeEnabled();
      await expect(rename).toHaveText(fixture.originalName);
      await capture('before');
      await rename.click();
      await editor.fill('Canceled draft');
      await editor.press('Escape');
      await expect(rename).toHaveText(fixture.originalName);
      await expect(rename).toBeFocused();
      await rename.click();
      await editor.fill('   ');
      await editor.press('Enter');
      await rename.click();
      await editor.fill(' ' + fixture.originalName + ' ');
      await editor.press('Enter');
      expect(updates()).toHaveLength(0);
      accepted = `Plan Café 日本語 ${width}`;
      await rename.click();
      await editor.press('ControlOrMeta+A');
      await editor.press('Backspace');
      await editor.pressSequentially('Plan ');
      await page.keyboard.insertText('Café 日本語');
      await editor.pressSequentially(' ' + width);
      await editor.press('Home');
      await editor.press('ArrowRight');
      await editor.press('ArrowRight');
      expect(await editor.evaluate((input) => input.selectionStart)).toBe(2);
      await editor.press('End');
      await expect(editor).toHaveValue(accepted);
      if (width === 1280) await editor.press('Enter');
      else await conversation.locator(':scope > output').click();
      await expect.poll(() => updates().length).toBe(1);
      await expect
        .poll(() => replies.find(({ request }) => request.id === updates()[0].id)?.response.result)
        .toEqual({ success: true, name: accepted });
      expect(updates()[0].params).toEqual({ agentId, name: accepted, workspaceId });
      await expect(rename).toHaveText(accepted);
      await expect(rename).toBeEnabled();
      mainAfter = await readAgent(agentId);
      expect(mainAfter.agent.name).toBe(accepted);
      expect(mainAfter.agent.nameExplicitlySet).toBe(true);
      await capture('renamed');
      await page.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      const list = page.getByTestId('workspace-agents');
      await list.getByRole('button', { name: 'Agents', exact: true }).click();
      const row = page.locator(`[data-workspace-agent="${agentId}"]`);
      await expect(row).toContainText(accepted);
      await list.getByRole('button', { name: 'Search agents...', exact: true }).click();
      const search = list.locator('input');
      await search.fill('日本語');
      await expect(row).toBeVisible();
      await expect(page.locator(`[data-workspace-agent="${siblingId}"]`)).toHaveCount(0);
      await row.click();
      await expect(rename).toHaveText(accepted);
      await page.reload();
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
      await expect(rename).toHaveText(accepted);
      const socketsBefore = await page.evaluate(() => {
        const count = window.__renameOwnedSockets.length;
        for (const socket of window.__renameOwnedSockets) socket.close();
        return count;
      });
      await expect
        .poll(
          () =>
            page.evaluate(
              (before) =>
                window.__renameOwnedSockets.length > before &&
                window.__renameOwnedSockets.at(-1).readyState === WebSocket.OPEN,
              socketsBefore,
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      reconnect = {
        socketsBefore,
        socketsAfter: await page.evaluate(() => window.__renameOwnedSockets.length),
      };
      await expect(rename).toBeEnabled({ timeout: 30000 });
      await expect(rename).toHaveText(accepted);
      await page.reload();
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
      await expect(rename).toHaveText(accepted);
      await expect(rename).toBeEnabled();
      await capture('reloaded');
      sourceModules.push(
        ...(await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((url) =>
              /workspace-agent-name|agent-rename-saga|agent-rename-selectors|agent-session-slice/.test(
                url,
              ),
            ),
        )),
      );
      expect(sourceModules.some((url) => url.includes('workspace-agent-name.tsx'))).toBe(true);
      expect(updates()).toHaveLength(1);
      expect(await readAgent(siblingId)).toEqual(siblingBefore);
      const unchangedFields = (agent) =>
        Object.fromEntries(
          Object.entries(agent).filter(
            ([key]) => !['name', 'nameExplicitlySet', 'updatedAt', 'lastActivity'].includes(key),
          ),
        );
      // The daemon exposes the rename's updatedAt as lastActivity for this idle fixture.
      expect(mainAfter.agent.lastActivity).toBe(mainAfter.agent.updatedAt);
      expect(unchangedFields(mainAfter.agent)).toEqual(unchangedFields(mainBefore.agent));
      expect(await ownedRead('agent.getConversation', { workspaceId, agentId })).toEqual(
        transcriptBefore,
      );
      expect(await ownedRead('agent.getConversation', { workspaceId, agentId: siblingId })).toEqual(
        siblingTranscriptBefore,
      );
      expect(await ownedRead('note.list', { workspaceId })).toEqual(notesBefore);
      expect({
        head: git('rev-parse', 'HEAD'),
        branch: git('branch', '--show-current'),
        index: git('ls-files', '--stage'),
        status: git('status', '--porcelain'),
      }).toEqual(before);
      for (const [path, hash] of Object.entries(fixture.files))
        expect(
          createHash('sha256')
            .update(await readFile(repositoryPath + '/' + path))
            .digest('hex'),
        ).toBe(hash);
      expect(
        requests.filter((r) =>
          /^(agent\.(sendMessage|queueMessage|stop|create|delete)|note\.(create|setContent)|file\.write|git\.(stage|agentCommit))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.length).toBeGreaterThan(8);
      expect(inputs.every((input) => input.trusted)).toBe(true);
      expect(geometry.every((g) => g.overflow.scrollWidth <= g.width)).toBe(true);
      const unsubscribed = replies.filter(
        ({ request }) => request.method === 'chat.unsubscribe',
      ).length;
      await page.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      await expect
        .poll(
          () =>
            replies.filter(
              ({ request, response }) => request.method === 'chat.unsubscribe' && !response.error,
            ).length,
        )
        .toBeGreaterThan(unsubscribed);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            fixture,
            before,
            mainBefore,
            mainAfter,
            accepted,
            requests,
            replies,
            inputs,
            geometry,
            sourceModules,
            reconnect,
            errors,
          },
          null,
          2,
        ),
      );
      await page.goto('about:blank');
    }
  });
}
