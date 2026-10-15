import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Fixture preparation is separate: only genuine persisted messages on an owned daemon.
function readOwned(method, params) {
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
const messageText = (message) =>
  (message.contentBlocks ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

for (const width of [1280, 420]) {
  test(`older persisted in-body targets and source return at ${width}`, async ({ page }, info) => {
    test.setTimeout(180000);
    const base = process.env.REACT_BASE_URL;
    const fixturePath = process.env.OWNED_OLDER_MESSAGE_FIXTURE;
    if (!base || !fixturePath || process.env.OWNED_MESSAGE_LINK_READS !== 'owned-test-daemon')
      throw new Error('Requires genuine older-message fixtures on the owned daemon');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const f = JSON.parse(await readFile(fixturePath, 'utf8'));
    expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const { workspaceId, agentId, targetAgentId } = f;
    const history = (id) => readOwned('agent.getConversation', { workspaceId, agentId: id });
    const sourceBefore = await history(agentId),
      targetBefore = await history(targetAgentId);
    expect(sourceBefore.turnInFlight || targetBefore.turnInFlight).toBeFalsy();
    expect(messageText(sourceBefore.messages.find((m) => m.id === f.sourceMessageId))).toBe(
      f.sourceContent,
    );
    expect(messageText(sourceBefore.messages.find((m) => m.id === f.earlierMessageId))).toBe(
      f.earlierContent,
    );
    expect(messageText(targetBefore.messages.find((m) => m.id === f.targetMessageId))).toBe(
      f.targetContent,
    );
    const notesBefore = await readOwned('note.list', { workspaceId });
    const git = (...args) =>
      execFileSync('git', ['-C', f.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const repository = () => ({
      head: git('rev-parse', 'HEAD'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain'),
    });
    const repoBefore = repository();
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      notifications = [],
      connections = [],
      inputs = [],
      geometry = [],
      admissions = [];
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const connection = { id: connections.length, closed: false };
      connections.push(connection);
      socket.on('close', () => {
        connection.closed = true;
      });
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const request = JSON.parse(String(payload));
        requests.push({ connection: connection.id, ...request });
        pending.set(request.id, request);
      });
      socket.on('framereceived', ({ payload }) => {
        const response = JSON.parse(String(payload));
        const request = pending.get(response.id);
        if (request) {
          pending.delete(response.id);
          replies.push({ connection: connection.id, request, response });
        } else notifications.push({ connection: connection.id, response });
      });
    });
    await page.exposeFunction('recordOlderLinkInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      for (const kind of ['pointerdown', 'keydown'])
        window.addEventListener(
          kind,
          (event) =>
            window.recordOlderLinkInput({ kind, trusted: event.isTrusted, key: event.key }),
          true,
        );
    });
    await page.setViewportSize({ width, height: 900 });
    const route = (id) =>
      `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${encodeURIComponent(id)}`;
    const conversation = page.getByTestId('workspace-conversation'),
      transcript = page.getByTestId('conversation-messages');
    const row = (id) => transcript.locator(`[data-message-id="${id}"]`);
    const rows = () =>
      transcript
        .locator('[data-message-id]')
        .evaluateAll((es) => es.map((e) => e.dataset.messageId));
    const ready = async (id) => {
      await expect(conversation).toHaveAttribute('data-agent-id', id, { timeout: 60000 });
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
    };
    const position = async (id) => ({
      box: await row(id).boundingBox(),
      scroll: await transcript.evaluate((e) => e.scrollTop),
      documentY: await page.evaluate(() => window.scrollY),
    });
    const capture = async (label, id) => {
      const frame = row(id);
      await frame.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        label,
        width,
        id,
        ...(await position(id)),
        transcript: await transcript.boundingBox(),
      });
      await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
        if (png) await writeFile(info.outputPath(`${label}-${attempt}.png`), png);
      });
    };
    const initial = async (id, absent) => {
      await page.goto(route(id));
      await ready(id);
      await expect(page.getByTestId('conversation-load-older')).toBeEnabled();
      const subscription = replies
        .filter((r) => r.request.method === 'chat.subscribe' && r.request.params.agentId === id)
        .at(-1);
      expect(subscription.response.result.subscriptionId).toBeTruthy();
      const own = () =>
        notifications.filter(
          (r) =>
            r.connection === subscription.connection &&
            r.response.params?.subscriptionId === subscription.response.result.subscriptionId,
        );
      await expect
        .poll(() =>
          own().some(
            (r) =>
              r.response.params?.history?.complete === true ||
              r.response.params?.snapshot?.initialHistory?.complete === true,
          ),
        )
        .toBe(true);
      const snapshot = own().find((r) => r.response.params.kind === 'snapshot').response.params
        .snapshot;
      const ids = await rows();
      expect(snapshot.initialHistory.target).toBe(20);
      expect(ids).toHaveLength(snapshot.initialHistory.target);
      expect(ids).not.toContain(absent);
      expect(snapshot.totalMessages).toBeGreaterThan(ids.length);
      const admitted = {
        agentId: id,
        target: absent,
        subscription: subscription.response.result.subscriptionId,
        ids,
        snapshot,
      };
      admissions.push(admitted);
      return admitted;
    };
    const unsubscribe = async () => {
      const current = replies
        .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
        .at(-1);
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      await expect
        .poll(() =>
          replies.some(
            (r) =>
              r.connection === current.connection &&
              r.request.method === 'chat.unsubscribe' &&
              r.request.params.subscriptionId === current.response.result.subscriptionId &&
              r.response.result?.success === true,
          ),
        )
        .toBe(true);
    };
    try {
      // Establish both actual production windows before activating any message link.
      const otherInitial = await initial(targetAgentId, f.targetMessageId);
      const sourceInitial = await initial(agentId, f.earlierMessageId);
      for (const [kind, href, targetId, destination, content, tail] of [
        ['cross', f.otherLink, f.targetMessageId, targetAgentId, f.targetContent, otherInitial.ids],
        ['same', f.sameLink, f.earlierMessageId, agentId, f.earlierContent, sourceInitial.ids],
      ]) {
        if (kind === 'same') await expect(row(targetId)).toHaveCount(0);
        const sourceIds = await rows();
        const link = row(f.sourceMessageId).getByRole('link', { name: href, exact: true });
        await link.scrollIntoViewIfNeeded();
        await capture(`${kind}-before`, f.sourceMessageId);
        const before = await position(f.sourceMessageId),
          start = replies.length;
        if (width === 1280) {
          await link.focus();
          await page.keyboard.press('Enter');
        } else await link.click();
        await ready(destination);
        await expect.poll(() => new URL(page.url()).searchParams.get('message')).toBe(targetId);
        await expect(row(targetId)).toBeFocused();
        await expect(row(targetId)).toBeInViewport();
        await expect(row(targetId)).toContainText(content);
        const seek = replies
          .slice(start)
          .filter(
            (r) =>
              r.request.method === 'agent.getConversation' &&
              r.request.params.aroundMessageId === targetId,
          );
        expect(seek).toHaveLength(1);
        expect(seek[0].request.params).toEqual({
          workspaceId,
          agentId: destination,
          limit: 5,
          projection: 'slim',
          aroundMessageId: targetId,
        });
        expect(seek[0].response.error).toBeUndefined();
        const independent = await readOwned('agent.getConversation', seek[0].request.params);
        expect(seek[0].response.result.messages).toEqual(independent.messages);
        const ids = await rows(),
          pageIds = independent.messages.map((m) => m.id);
        for (const id of tail) expect(ids).toContain(id);
        expect(ids.filter((id) => pageIds.includes(id))).toEqual(pageIds);
        await capture(`${kind}-target`, targetId);
        const reloadStart = replies.length;
        await page.reload();
        await ready(destination);
        await expect(row(targetId)).toBeFocused();
        await expect(row(targetId)).toBeInViewport();
        expect(
          replies
            .slice(reloadStart)
            .filter(
              (r) =>
                r.request.method === 'agent.getConversation' &&
                r.request.params.aroundMessageId === targetId,
            ),
        ).toHaveLength(1);
        await page.goBack();
        await ready(agentId);
        await expect(row(f.sourceMessageId)).toBeFocused();
        await expect(row(f.sourceMessageId)).toBeInViewport();
        expect(new URL(page.url()).searchParams.get('message')).toBe(f.sourceMessageId);
        await expect
          .poll(async () => Math.abs((await position(f.sourceMessageId)).box.y - before.box.y))
          .toBeLessThanOrEqual(1);
        const after = await position(f.sourceMessageId);
        expect(after.documentY).toBe(before.documentY);
        geometry.push({ label: `${kind}-return-comparison`, before, after });
        for (const id of sourceIds) await expect(row(id)).toHaveCount(1);
        await capture(`${kind}-return`, f.sourceMessageId);
      }
      const residentStart = replies.length;
      await row(f.sourceMessageId).getByRole('link', { name: f.residentLink, exact: true }).click();
      await expect(row(f.residentId)).toBeFocused();
      expect(
        replies
          .slice(residentStart)
          .filter(
            (r) =>
              r.request.method === 'agent.getConversation' &&
              r.request.params.aroundMessageId === f.residentId,
          ),
      ).toHaveLength(0);
      await page.goBack();
      await expect(row(f.sourceMessageId)).toBeFocused();
      await unsubscribe();
      await page
        .getByTestId('workspace-agents')
        .getByRole('button', { name: 'Agents', exact: true })
        .click();
      await page.locator(`[data-workspace-agent="${agentId}"]`).click();
      await ready(agentId);
      // Markdown line breaks are elements; textContent does not contain their newlines.
      // Exact persisted bytes were checked independently before navigation.
      for (const line of f.sourceContent.split('\n'))
        await expect(row(f.sourceMessageId)).toContainText(line);
      await expect(row(f.earlierMessageId)).toHaveCount(0);
      const missing = row(f.missingMessageSourceId).getByRole('link', {
        name: f.missingLink,
        exact: true,
      });
      await missing.click();
      await expect(
        conversation
          .getByRole('status')
          .filter({ hasText: 'The linked message could not be opened in this conversation.' }),
      ).toBeVisible();
      await expect(row(f.targetMessageId)).toHaveCount(0);
      await page.goBack();
      await expect(row(f.missingMessageSourceId)).toBeFocused();
      await unsubscribe();
      await page.goto(`${base}/workspaces`);
      expect(await history(agentId)).toEqual(sourceBefore);
      expect(await history(targetAgentId)).toEqual(targetBefore);
      expect(await readOwned('note.list', { workspaceId })).toEqual(notesBefore);
      expect(repository()).toEqual(repoBefore);
      expect(
        requests.filter(({ method }) =>
          /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|queueMessage|execute)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.every((event) => event.trusted)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            fixture: f,
            sourceBefore,
            targetBefore,
            notesBefore,
            repoBefore,
            requests,
            replies,
            notifications,
            connections,
            inputs,
            geometry,
            admissions,
            errors,
          },
          null,
          2,
        ),
      );
      await page.goto(`${base}/workspaces`);
    }
  });
}
