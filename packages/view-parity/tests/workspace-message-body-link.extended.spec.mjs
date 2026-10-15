import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Only reads: separate public-Send fixture preparation owns the provider mutations.
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
        const result = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (result.id !== 1) continue;
        socket.end();
        if (result.error) reject(new Error(JSON.stringify(result.error)));
        else resolve(result.result);
      }
    });
  });
}
const text = (message) =>
  (message.contentBlocks ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

for (const width of [1280, 420]) {
  test(`persisted in-body message links and Back at ${width}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const base = process.env.REACT_BASE_URL,
      fixtureRoot = process.env.OWNED_MESSAGE_LINK_FIXTURES;
    if (!base || !fixtureRoot || process.env.OWNED_MESSAGE_LINK_READS !== 'owned-test-daemon')
      throw new Error('Requires purpose-created persisted fixtures on owned daemon');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const f = JSON.parse(await readFile(`${fixtureRoot}/prepared-complete-${width}.json`, 'utf8'));
    expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const { workspaceId, agentId, targetAgentId } = f;
    const history = (id) => ownedRead('agent.getConversation', { workspaceId, agentId: id });
    const sourceBefore = await history(agentId),
      targetBefore = await history(targetAgentId);
    const sourceMessage = sourceBefore.messages.find((m) => m.id === f.sourceMessageId);
    expect(sourceMessage.role).toBe('user');
    expect(text(sourceMessage)).toBe(f.sourceContent);
    expect(text(sourceBefore.messages.find((m) => m.id === f.missingMessageSourceId))).toBe(
      f.missingMessageSourceContent,
    );
    expect(text(targetBefore.messages.find((m) => m.id === f.targetMessageId))).toBe(
      f.targetContent,
    );
    expect(sourceBefore.messages.findIndex((m) => m.id === f.earlierMessageId)).toBeLessThan(
      sourceBefore.messages.findIndex((m) => m.id === f.sourceMessageId),
    );
    expect(sourceBefore.turnInFlight || targetBefore.turnInFlight).toBeFalsy();
    const git = (...args) =>
      execFileSync('git', ['-C', f.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const beforeRepo = {
      head: git('rev-parse', 'HEAD'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain'),
    };
    const notesBefore = await ownedRead('note.list', { workspaceId });
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
    await page.exposeFunction('recordMessageLinkInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      for (const kind of ['pointerdown', 'keydown'])
        window.addEventListener(
          kind,
          (event) =>
            window.recordMessageLinkInput({ kind, trusted: event.isTrusted, key: event.key }),
          true,
        );
    });
    await page.setViewportSize({ width, height: 900 });
    const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${encodeURIComponent(agentId)}&message=${encodeURIComponent(f.earlierMessageId)}`;
    const conversation = page.getByTestId('workspace-conversation'),
      transcript = page.getByTestId('conversation-messages');
    const row = (id) => transcript.locator(`[data-message-id="${id}"]`);
    const ready = async (id) => {
      await expect(conversation).toHaveAttribute('data-agent-id', id, { timeout: 30000 });
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
    };
    const capture = async (label, messageId = f.sourceMessageId) => {
      const frame = row(messageId);
      await frame.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        width,
        subject: await frame.boundingBox(),
        source: (await row(f.sourceMessageId).count())
          ? await row(f.sourceMessageId).boundingBox()
          : null,
        transcript: await transcript.boundingBox(),
        scroll: await transcript.evaluate((e) => e.scrollTop),
      });
      await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
        if (png) await writeFile(info.outputPath(`${label}-${attempt}.png`), png);
      });
    };
    try {
      await page.goto(url);
      await ready(agentId);
      await expect(row(f.earlierMessageId)).toBeFocused();
      for (const [href, targetId, destination] of [
        [f.otherLink, f.targetMessageId, targetAgentId],
        [f.sameLink, f.earlierMessageId, agentId],
      ]) {
        const link = row(f.sourceMessageId).locator('a').filter({ hasText: href });
        await expect(link).toHaveAttribute('href', href);
        await link.scrollIntoViewIfNeeded();
        await capture(destination === agentId ? 'same-source' : 'cross-source');
        const before = await row(f.sourceMessageId).boundingBox();
        if (width === 1280) {
          await link.focus();
          await page.keyboard.press('Enter');
        } else await link.click();
        await ready(destination);
        await expect.poll(() => new URL(page.url()).searchParams.get('message')).toBe(targetId);
        await expect(row(targetId)).toBeFocused();
        await expect(row(targetId)).toBeInViewport();
        await expect(row(targetId)).toContainText(
          destination === agentId ? f.earlierContent : f.targetContent,
        );
        await capture(destination === agentId ? 'same-target' : 'cross-target', targetId);
        await page.goBack();
        await ready(agentId);
        await expect(row(f.sourceMessageId)).toBeFocused();
        await expect(row(f.sourceMessageId)).toBeInViewport();
        expect(new URL(page.url()).searchParams.get('message')).toBe(f.sourceMessageId);
        await expect
          .poll(async () => Math.abs((await row(f.sourceMessageId).boundingBox()).y - before.y))
          .toBeLessThanOrEqual(1);
        await capture(destination === agentId ? 'same-return' : 'cross-return');
        for (const message of sourceBefore.messages) await expect(row(message.id)).toHaveCount(1);
      }
      const invalid = row(f.sourceMessageId).getByRole('link', {
        name: f.invalidLink,
        exact: true,
      });
      const previous = page.url();
      await invalid.click();
      expect(page.url()).toBe(previous);
      await page.reload();
      await ready(agentId);
      await expect(row(f.sourceMessageId)).toBeFocused();
      await expect(row(f.sourceMessageId)).toBeInViewport();
      const active = replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' && response.result?.subscriptionId,
        )
        .at(-1)?.response.result.subscriptionId;
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      await expect
        .poll(() =>
          replies.some(
            ({ request, response }) =>
              request.method === 'chat.unsubscribe' &&
              request.params.subscriptionId === active &&
              response.result?.success === true,
          ),
        )
        .toBe(true);
      // Reopen through the real workspace list after the old reader unsubscribed.
      const list = page.getByTestId('workspace-agents');
      await list.getByRole('button', { name: 'Agents', exact: true }).click();
      await page.locator(`[data-workspace-agent="${agentId}"]`).click();
      await ready(agentId);
      await expect(row(f.sourceMessageId)).toHaveCount(1);
      await expect(row(f.missingMessageSourceId)).toContainText(`Missing target fixture ${width}.`);
      expect(sourceBefore.messages.some((message) => message.id === f.targetMessageId)).toBe(false);
      const missing = row(f.missingMessageSourceId).getByRole('link', {
        name: f.missingLink,
        exact: true,
      });
      await missing.scrollIntoViewIfNeeded();
      await capture('missing-source', f.missingMessageSourceId);
      const missingSourceBox = await row(f.missingMessageSourceId).boundingBox();
      await missing.click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get('message'))
        .toBe(f.targetMessageId);
      await expect
        .poll(() =>
          replies.some(
            ({ request }) =>
              request.method === 'agent.getConversation' &&
              request.params.agentId === agentId &&
              request.params.aroundMessageId === f.targetMessageId,
          ),
        )
        .toBe(true);
      await expect(
        conversation
          .getByRole('status')
          .filter({ hasText: 'The linked message could not be opened in this conversation.' }),
      ).toBeVisible();
      const unavailable = conversation
        .getByRole('status')
        .filter({ hasText: 'The linked message could not be opened in this conversation.' });
      await stableLocatorScreenshot(page, unavailable, async ({ png, attempt }) => {
        if (png) await writeFile(info.outputPath(`message-unavailable-${attempt}.png`), png);
      });
      await expect(row(f.targetMessageId)).toHaveCount(0);
      for (const message of sourceBefore.messages) await expect(row(message.id)).toHaveCount(1);
      await page.goBack();
      await expect(row(f.missingMessageSourceId)).toBeFocused();
      await expect
        .poll(async () =>
          Math.abs((await row(f.missingMessageSourceId).boundingBox()).y - missingSourceBox.y),
        )
        .toBeLessThanOrEqual(1);
      await capture('missing-return', f.missingMessageSourceId);
      const reopened = replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' && response.result?.subscriptionId,
        )
        .at(-1)?.response.result.subscriptionId;
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect
        .poll(() =>
          replies.some(
            ({ request, response }) =>
              request.method === 'chat.unsubscribe' &&
              request.params.subscriptionId === reopened &&
              response.result?.success === true,
          ),
        )
        .toBe(true);
      expect(await history(agentId)).toEqual(sourceBefore);
      expect(await history(targetAgentId)).toEqual(targetBefore);
      expect(await ownedRead('note.list', { workspaceId })).toEqual(notesBefore);
      expect({
        head: git('rev-parse', 'HEAD'),
        index: git('ls-files', '--stage'),
        status: git('status', '--porcelain'),
      }).toEqual(beforeRepo);
      expect(
        requests.filter(({ method }) =>
          /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|queueMessage|execute)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.every((x) => x.trusted)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            fixture: f,
            sourceBefore,
            targetBefore,
            beforeRepo,
            notesBefore,
            requests,
            replies,
            inputs,
            geometry,
            errors,
          },
          null,
          2,
        ),
      );
      await page.goto(base);
    }
  });
}
