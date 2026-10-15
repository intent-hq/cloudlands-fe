import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Navigation/copy only. Purpose-created persisted fixtures belong to a separate setup receipt.
function ownedRead(method, params) {
  if (!['agent.getConversation', 'note.list'].includes(method)) throw new Error('Read-only proof');
  return new Promise((resolve, reject) => {
    const socket = connect('/owned/data/intentd.sock');
    let buffer = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('Owned read timeout')));
    socket.on('error', reject);
    socket.on('connect', () =>
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n'),
    );
    socket.on('data', (data) => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const response = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (response.id !== 1) continue;
        socket.end();
        if (response.error) reject(new Error(JSON.stringify(response.error)));
        else resolve(response.result);
      }
    });
  });
}
for (const width of [1280, 420])
  test(`copy persisted message text at ${width}`, async ({ page, context }, info) => {
    test.setTimeout(90000);
    const base = process.env.REACT_BASE_URL,
      fixtures = process.env.OWNED_MESSAGE_TEXT_FIXTURES;
    if (!base || !fixtures || process.env.OWNED_MESSAGE_TEXT_READS !== 'owned-test-daemon')
      throw new Error('Requires owned persisted-message fixtures');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const f = JSON.parse(await readFile(`${fixtures}/prepared-complete-${width}.json`, 'utf8'));
    expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const { workspaceId, agentId } = f;
    const read = () => ownedRead('agent.getConversation', { workspaceId, agentId });
    const before = await read(),
      sibling = await ownedRead('agent.getConversation', { workspaceId, agentId: f.targetAgentId });
    expect(before.turnInFlight).toBeFalsy();
    const notes = await ownedRead('note.list', { workspaceId });
    const git = (...args) =>
      execFileSync('git', ['-C', f.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const repo = () => ({
      head: git('rev-parse', 'HEAD'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain'),
    });
    const repository = repo();
    const messages = [
      before.messages.find((m) => m.id === f.sourceMessageId),
      before.messages.find((m) => m.role === 'assistant' && Number.isSafeInteger(m.seq)),
    ];
    expect(messages[0].contentBlocks.map((b) => b.text ?? b.content ?? '').join('')).toBe(
      f.sourceContent,
    );
    expect(messages.every(Boolean)).toBe(true);
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      inputs = [],
      geometry = [],
      copies = [];
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
          replies.push({ request, response });
          pending.delete(response.id);
        }
      });
    });
    await page.exposeFunction('recordCopyInput', (e) => inputs.push(e));
    await page.addInitScript(() => {
      for (const kind of ['pointerdown', 'keydown'])
        window.addEventListener(
          kind,
          (e) => window.recordCopyInput({ kind, trusted: e.isTrusted, key: e.key }),
          true,
        );
    });
    // A fresh headless context owns this clipboard. Never read the user's desktop clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.setViewportSize({ width, height: 900 });
    const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${encodeURIComponent(agentId)}`;
    const conversation = page.getByTestId('workspace-conversation');
    const ready = () =>
      expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
    const row = (id) => page.locator(`article[data-message-id="${id}"]`);
    async function copy(message, keyboard) {
      const target = row(message.id),
        button = target.getByRole('button', { name: 'Copy text', exact: true });
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      // Wait for the actual Markdown/route layout before starting the strict capture.
      // A capture-context change still fails immediately; it is never retried away.
      await target.evaluate(async (element) => {
        let prior = '',
          stable = 0;
        for (let frame = 0; frame < 60; frame++) {
          await new Promise(requestAnimationFrame);
          const r = element.getBoundingClientRect();
          const current = JSON.stringify([
            r.x,
            r.y,
            r.width,
            r.height,
            window.scrollY,
            document.documentElement.scrollHeight,
          ]);
          stable = current === prior ? stable + 1 : 0;
          if (stable === 6) return;
          prior = current;
        }
        throw new Error('Message layout did not settle before capture');
      });
      const beforeBox = await target.boundingBox();
      await stableLocatorScreenshot(
        page,
        target,
        async ({ png, attempt, before, after, changes }) => {
          await writeFile(
            info.outputPath(
              `capture-${message.role}-${copies.length}-${attempt}-${copies.length ? 'after' : 'before'}.json`,
            ),
            JSON.stringify({ before, after, changes }),
          );
          if (png)
            await writeFile(
              info.outputPath(`before-${message.role}-${copies.length}-${attempt}.png`),
              png,
            );
        },
      );
      if (keyboard) {
        await button.focus();
        await page.keyboard.press('Enter');
      } else await button.click();
      await expect(
        target.getByRole('status').filter({ hasText: 'Message text copied' }),
      ).toHaveCount(1);
      const actual = await page.evaluate(() => navigator.clipboard.readText());
      // Independently inspect the genuine daemon fixture. No formatter import or DOM serialization.
      expect(message.contentBlocks.every((b) => b.type === 'text')).toBe(true);
      const expected = message.contentBlocks
        .map((b) => b.text ?? b.content ?? '')
        .join(message.role === 'user' ? '' : '\n\n');
      expect(actual).toBe(expected);
      const afterBox = await target.boundingBox();
      for (const k of ['x', 'y', 'width', 'height'])
        expect(Math.abs(afterBox[k] - beforeBox[k])).toBeLessThanOrEqual(1);
      expect(afterBox.x).toBeGreaterThanOrEqual(0);
      expect(afterBox.x + afterBox.width).toBeLessThanOrEqual(width + 1);
      expect(await button.evaluate((e) => e === document.activeElement)).toBe(true);
      geometry.push({ role: message.role, before: beforeBox, after: afterBox });
      copies.push({
        messageId: message.id,
        role: message.role,
        seq: message.seq,
        actual,
        expected,
      });
      await stableLocatorScreenshot(
        page,
        target,
        async ({ png, attempt, before, after, changes }) => {
          await writeFile(
            info.outputPath(
              `capture-${message.role}-${copies.length}-${attempt}-${copies.length ? 'after' : 'before'}.json`,
            ),
            JSON.stringify({ before, after, changes }),
          );
          if (png)
            await writeFile(
              info.outputPath(`copied-${message.role}-${copies.length}-${attempt}.png`),
              png,
            );
        },
      );
    }
    try {
      await page.goto(url);
      await ready();
      await copy(messages[0], false);
      await copy(messages[1], true);
      const link = row(messages[1].id).getByRole('button', {
        name: 'Copy message link',
        exact: true,
      });
      await link.click();
      await expect(
        row(messages[1].id).getByRole('status').filter({ hasText: 'Message link copied' }),
      ).toHaveCount(1);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        `intent://local/${workspaceId}/agent/${agentId}/message/${messages[1].id}`,
      );
      await page.reload();
      await ready();
      await copy(messages[0], true);
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      await page.goBack();
      await ready();
      await copy(messages[1], false);
      // The previously persisted sibling target supplies a genuine Unicode fixture.
      await page.goto(
        `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${encodeURIComponent(f.targetAgentId)}`,
      );
      await ready();
      const unicode = sibling.messages.find((m) => m.id === f.targetMessageId);
      expect(unicode.contentBlocks[0].text).toContain('Ω');
      await copy(unicode, true);
      const subscription = replies
        .filter((x) => x.request.method === 'chat.subscribe' && x.response.result?.subscriptionId)
        .at(-1)?.response.result.subscriptionId;
      expect(subscription).toBeTruthy();
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect
        .poll(() =>
          replies.some(
            (x) =>
              x.request.method === 'chat.unsubscribe' &&
              x.request.params.subscriptionId === subscription &&
              x.response.result?.success === true,
          ),
        )
        .toBe(true);
      expect(await read()).toEqual(before);
      expect(
        await ownedRead('agent.getConversation', { workspaceId, agentId: f.targetAgentId }),
      ).toEqual(sibling);
      expect(await ownedRead('note.list', { workspaceId })).toEqual(notes);
      expect(repo()).toEqual(repository);
      expect(
        requests.filter((x) =>
          /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|queueMessage|execute)$/.test(
            x.method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(inputs.some((x) => x.kind === 'keydown' && x.key === 'Enter')).toBe(true);
      expect(inputs.every((x) => x.trusted)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            width,
            workspaceId,
            agentId,
            copies,
            geometry,
            inputs,
            requests,
            replies,
            errors,
            repository,
          },
          null,
          2,
        ),
      );
      await context.clearPermissions();
      await page.close();
    }
  });
