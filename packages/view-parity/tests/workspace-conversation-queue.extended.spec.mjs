import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Read-only evidence from the task-owned daemon. Product selection, persistence and Send use UI.
function ownedRpc(method, params) {
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
  test(`owned conversation enqueue removal and daemon delivery at ${width}`, async ({
    page,
  }, info) => {
    test.setTimeout(240000);
    const base = process.env.REACT_BASE_URL,
      path = process.env.ISOLATED_CONVERSATION_QUEUE_FIXTURES;
    if (!base || !path || process.env.ISOLATED_CONVERSATION_QUEUE_SEND !== 'owned-test-daemon')
      throw new Error('Requires owned provider queue fixtures');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(path, 'utf8')),
      fixture = fixtures.find((f) => f.width === width),
      other = fixtures.find((f) => f.width !== width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(300000);
    const { workspaceId, agentId } = fixture;
    const git = (...args) =>
      execFileSync('git', ['-C', fixture.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const repo = () => ({
      head: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain=v1'),
    });
    const before = repo(),
      errors = await observeErrors(page),
      requests = [],
      replies = [],
      pushes = [],
      inputs = [],
      geometry = [];
    let history;
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
        if (response.method === 'subscription.push') pushes.push(response.params);
      });
    });
    await page.exposeFunction('recordQueueInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      window.addEventListener(
        'keydown',
        (event) => window.recordQueueInput({ key: event.key, trusted: event.isTrusted }),
        true,
      );
    });
    const composer = page.getByTestId('conversation-composer'),
      textarea = composer.locator('textarea'),
      queue = page.getByTestId('conversation-queue');
    const ready = async () => {
      await expect(page.getByTestId('workspace-conversation')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30000 },
      );
      await expect(textarea).toBeEnabled({ timeout: 20000 });
    };
    const type = async (text) => {
      await textarea.click();
      await textarea.press('ControlOrMeta+A');
      await page.keyboard.insertText(text);
    };
    const calls = (method) => requests.filter((r) => r.method === method);
    const readQueue = async () => {
      const result = await ownedRpc('agent.getQueue', { workspaceId, agentId });
      expect(result.success).toBe(true);
      return result.queue;
    };
    const capture = async (name) => {
      await composer.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push(
        await queue.evaluate((node) => ({
          rect: node.getBoundingClientRect().toJSON(),
          scrollWidth: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        })),
      );
      expect(geometry.at(-1).scrollWidth).toBeLessThanOrEqual(width);
      await writeFile(
        info.outputPath(name + '.png'),
        await stableLocatorScreenshot(page, composer),
      );
    };
    const token = String(Date.now()),
      removed = 'REMOVE_' + width + '_' + token,
      merged = 'MERGED_' + width + '_' + token,
      kept = 'KEEP_Ω_' + width + '_' + token;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}`);
      await ready();
      await expect(queue).toContainText('No messages are queued.');
      expect(await readQueue()).toEqual([]);
      const initial =
        'Run exactly one benign shell command: sleep 75. Wait for it to finish, then reply READY. Do not read or write files, use network, delegate or perform any other tool action.';
      await type(initial);
      await composer.getByRole('button', { name: 'Send', exact: true }).click();
      await expect.poll(() => calls('agent.sendMessage').length).toBe(1);
      // Real provider tool invocation establishes active work, not a fabricated busy flag.
      await expect
        .poll(
          () =>
            pushes.some((push) => {
              const blocks = [...(push.delta?.added ?? []), ...(push.delta?.updated ?? [])].map(
                (row) => row.block,
              );
              blocks.push(
                ...(push.snapshot?.messages ?? []).flatMap(
                  (message) => message.contentBlocks ?? [],
                ),
              );
              return blocks.some(
                (block) => block?.type === 'tool_use' && block.input?.command === 'sleep 75',
              );
            }),
          { timeout: 45000 },
        )
        .toBe(true);
      await expect(composer.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
      await expect(textarea).toHaveValue('');
      await type('Reply only ' + removed);
      await textarea.press('Enter');
      await expect.poll(() => calls('agent.queueMessage').length).toBe(1);
      await expect(textarea).toHaveValue('');
      await type('Reply only ' + merged);
      await composer.getByRole('button', { name: 'Queue message', exact: true }).click();
      await expect.poll(() => calls('agent.queueMessage').length).toBe(2);
      await expect(textarea).toHaveValue('');
      const actual = await readQueue();
      // Same-author plain submissions merge into one daemon-owned removal unit.
      expect(actual).toHaveLength(1);
      expect(actual[0].content).toBe('Reply only ' + removed + '\n\nReply only ' + merged);
      expect([...actual[0].submissionIds].sort()).toEqual(
        calls('agent.queueMessage')
          .map((call) => call.params.messageId)
          .sort(),
      );
      await expect(queue).toContainText('Combined follow-ups. Remove applies to this whole entry.');
      await expect(queue.locator('[data-queued-id]')).toHaveCount(1);
      expect(
        await queue
          .locator('[data-queued-id]')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-queued-id'))),
      ).toEqual(actual.map((row) => row.id));
      await type('newer unsent draft Ω');
      await expect
        .poll(() => {
          const receipt = replies
            .filter(
              ({ request }) =>
                ['drafts.set', 'drafts.clear'].includes(request.method) &&
                request.params.agentId === agentId,
            )
            .at(-1);
          return (
            receipt?.request.method === 'drafts.set' &&
            receipt.request.params.text === 'newer unsent draft Ω' &&
            receipt.response.result?.ok === true
          );
        })
        .toBe(true);
      await capture('queued-follow-ups');
      await page.reload();
      await ready();
      await expect(textarea).toHaveValue('newer unsent draft Ω');
      await expect(queue.locator('[data-queued-id]')).toHaveCount(1);
      expect(calls('agent.queueMessage')).toHaveLength(2);
      await queue
        .locator(`[data-queued-id="${actual[0].id}"]`)
        .getByRole('button', { name: 'Remove', exact: true })
        .click();
      await expect
        .poll(
          () =>
            replies.filter(
              (r) =>
                r.request.method === 'agent.removeQueuedMessage' &&
                r.response.result?.success === true,
            ).length,
        )
        .toBe(1);
      expect(calls('agent.removeQueuedMessage')[0].params).toEqual({
        agentId,
        workspaceId,
        messageId: actual[0].id,
      });
      await expect(queue).toContainText('No longer queued. It may already have been delivered.');
      await expect.poll(async () => (await readQueue()).map((row) => row.id)).toEqual([]);
      await expect(textarea).toHaveValue('newer unsent draft Ω');
      await capture('queue-removal-receipt');
      await type('Reply only ' + kept);
      await composer.getByRole('button', { name: 'Queue message', exact: true }).click();
      await expect.poll(() => calls('agent.queueMessage').length).toBe(3);
      await expect(textarea).toHaveValue('');
      await expect
        .poll(async () => (await readQueue()).map((row) => row.content))
        .toEqual(['Reply only ' + kept]);
      await type('newer unsent draft Ω');
      await expect
        .poll(() => {
          const receipt = replies
            .filter(
              ({ request }) =>
                ['drafts.set', 'drafts.clear'].includes(request.method) &&
                request.params.agentId === agentId,
            )
            .at(-1);
          return (
            receipt?.request.method === 'drafts.set' &&
            receipt.request.params.text === 'newer unsent draft Ω' &&
            receipt.response.result?.ok === true
          );
        })
        .toBe(true);
      await page.goto(`${base}/workspaces/${other.workspaceId}?agent=${other.agentId}`);
      await ready();
      await expect(queue).not.toContainText(kept);
      await page.goBack();
      await ready();
      await expect(textarea).toHaveValue('newer unsent draft Ω');
      await page.evaluate(async () => {
        const url = performance
          .getEntriesByType('resource')
          .find((entry) =>
            new URL(entry.name).pathname.endsWith('/backend-transport-factory.ts'),
          )?.name;
        if (!url) throw new Error('transport missing');
        const { resolveBackendTransport } = await import(url);
        const socket = resolveBackendTransport().socket;
        await new Promise((resolve) => {
          socket.addEventListener('close', resolve, { once: true });
          socket.close();
        });
      });
      await ready();
      await expect(textarea).toHaveValue('newer unsent draft Ω');
      expect(calls('agent.queueMessage')).toHaveLength(3);
      expect(calls('agent.removeQueuedMessage')).toHaveLength(1);
      await expect(page.locator('[data-message-role=assistant]').last()).toContainText(kept, {
        timeout: 130000,
      });
      await expect.poll(async () => (await readQueue()).length).toBe(0);
      await expect(queue.locator('[data-queued-id]')).toHaveCount(0);
      await expect
        .poll(
          async () => {
            history = await ownedRpc('agent.getConversation', { workspaceId, agentId });
            return history.messages.filter(
              (message) =>
                message.role === 'assistant' &&
                JSON.stringify(message.contentBlocks).includes(kept),
            ).length;
          },
          { timeout: 20000 },
        )
        .toBe(1);
      const user = history.messages.filter((message) => message.role === 'user');
      expect(
        user.filter((message) => JSON.stringify(message.contentBlocks).includes(kept)),
      ).toHaveLength(1);
      expect(
        user.filter((message) => JSON.stringify(message.contentBlocks).includes(removed)),
      ).toHaveLength(0);
      const tools = history.messages
        .flatMap((message) => message.contentBlocks ?? [])
        .filter((block) => block.type === 'tool_use');
      expect(tools).toHaveLength(1);
      expect(JSON.stringify(tools[0].input)).toContain('sleep 75');
      const assistant = history.messages.filter((message) => message.role === 'assistant');
      expect(
        assistant.filter((message) => JSON.stringify(message.contentBlocks).includes(kept)),
      ).toHaveLength(1);
      await capture('delivered-follow-up');
      await page.reload();
      await ready();
      await expect(textarea).toHaveValue('newer unsent draft Ω');
      await expect(page.locator('[data-message-role=assistant]').last()).toContainText(kept);
      expect(calls('agent.sendMessage')).toHaveLength(1);
      expect(calls('agent.queueMessage')).toHaveLength(3);
      expect(calls('agent.removeQueuedMessage')).toHaveLength(1);
      // Exercise the actual Stop control while a newer draft is present.
      await type(
        'Run exactly one benign shell command: sleep 60. Do not read or change files, use network, or perform any other tool action.',
      );
      await composer.getByRole('button', { name: 'Send', exact: true }).click();
      await expect
        .poll(
          () =>
            pushes.some((push) =>
              [...(push.delta?.added ?? []), ...(push.delta?.updated ?? [])].some(
                (row) => row.block?.type === 'tool_use' && row.block.input?.command === 'sleep 60',
              ),
            ),
          { timeout: 45000 },
        )
        .toBe(true);
      await expect(textarea).toHaveValue('');
      await type('newer unsent draft Ω');
      await expect
        .poll(() => {
          const receipt = replies
            .filter(
              ({ request }) =>
                ['drafts.set', 'drafts.clear'].includes(request.method) &&
                request.params.agentId === agentId,
            )
            .at(-1);
          return (
            receipt?.request.method === 'drafts.set' &&
            receipt.request.params.text === 'newer unsent draft Ω' &&
            receipt.response.result?.ok === true
          );
        })
        .toBe(true);
      await composer.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect
        .poll(() =>
          replies.some(
            ({ request, response }) =>
              request.method === 'agent.stop' && response.result?.success === true,
          ),
        )
        .toBe(true);
      await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
        timeout: 20000,
      });
      await expect(textarea).toHaveValue('newer unsent draft Ω');
      expect(calls('agent.sendMessage')).toHaveLength(2);
      expect(calls('agent.queueMessage')).toHaveLength(3);
      expect(calls('agent.stop')).toHaveLength(1);
      expect(await readQueue()).toEqual([]);
      expect(repo()).toEqual(before);
      expect(
        createHash('sha256')
          .update(await readFile(fixture.repositoryPath + '/untouched.txt'))
          .digest('hex'),
      ).toBe(fixture.bytesSha256);
      expect(calls('file.write')).toHaveLength(0);
      expect(calls('note.setContent')).toHaveLength(0);
      const lease = replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' && response.result?.subscriptionId,
        )
        .at(-1)?.response.result.subscriptionId;
      expect(lease).toBeTruthy();
      await page
        .getByTestId('workspace-overview')
        .getByRole('link', { name: 'Workspaces', exact: true })
        .click();
      await expect(page.getByTestId('workspace-conversation')).toHaveCount(0);
      await expect
        .poll(() =>
          replies.some(
            ({ request, response }) =>
              request.method === 'chat.unsubscribe' &&
              request.params.subscriptionId === lease &&
              response.result?.success,
          ),
        )
        .toBe(true);
      expect(inputs.some((event) => event.trusted && event.key === 'Enter')).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            fixture,
            requests,
            replies,
            pushes,
            inputs,
            geometry,
            history,
            errors,
            before,
            after: repo(),
          },
          null,
          2,
        ),
      );
      await page.goto('about:blank');
    }
  });
}
