import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('genuine conversation file links read confined bytes and recover their message on Back', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || workspaceId !== 'system-design')
    throw new Error('The recorded workspace is required');
  const root = '/home/sam/intent/workspaces/system-design/cloudlands-fe';
  const agentId = 'agent-db54e46f-8df7-4b82-ad79-ac9747f19d9e';
  const cases = [
    {
      messageId: '01a13a58-be34-77c9-8bf0-d7d4c38440f0',
      seq: 910,
      file: '.demo-artifacts/avatar-paint-diagnosis/README.md',
      label: 'Exact evidence and native-renderer handoff',
      width: 1100,
    },
    {
      messageId: '01a13a52-212e-774e-8046-d6f079aef350',
      seq: 908,
      file: '.demo-artifacts/avatar-causal-diagnosis/README.md',
      label: 'Evidence and next action',
      width: 420,
    },
  ];
  const errors = await observeErrors(page);
  const requests = [],
    replies = [],
    probes = [],
    inputs = [],
    activations = [],
    failedRequests = [];
  await page.exposeFunction('observeFileLinkActivation', (event) => activations.push(event));
  page.on('requestfailed', (request) =>
    failedRequests.push({ url: request.url(), failure: request.failure() }),
  );
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    const pending = new Map();
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      requests.push(request);
      pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (request) replies.push({ request, response });
    });
  });
  const conversation = page.getByTestId('workspace-conversation');
  const view = page.getByTestId('workspace-file');
  const lease = () =>
    replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === agentId &&
          response.result?.subscriptionId,
      )
      .at(-1)?.response.result.subscriptionId;
  const released = async (id) => {
    expect(id).toBeTruthy();
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === id &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
  };
  const fileEntries = () =>
    page.evaluate(async (workspaceId) => {
      const resource = performance
        .getEntriesByType('resource')
        .find((r) => new URL(r.name).pathname.endsWith('/src/store/index.ts'));
      if (!resource) throw new Error('Real Store module not observed');
      const { store } = await import(resource.name);
      return Object.keys(store.state.files.byWorkspaceId[workspaceId]?.files.map ?? {});
    }, workspaceId);
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    for (const item of cases) {
      const href = `${root}/${item.file}`;
      const disk = fs.readFileSync(path.resolve('../..', item.file), 'utf8');
      expect(fs.realpathSync(path.resolve('../..', item.file))).toBe(
        path.resolve('../..', item.file),
      );
      await page.setViewportSize({ width: item.width, height: 850 });
      await page.goto(
        `${base}/workspaces/${workspaceId}?agent=${agentId}&message=${item.messageId}`,
      );
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      const row = conversation.locator(`[data-message-id="${item.messageId}"]`);
      await expect(row).toBeFocused();
      const actual = await page.evaluate(
        async (params) => {
          const resource = performance
            .getEntriesByType('resource')
            .find((r) =>
              new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'),
            );
          if (!resource) throw new Error('Real transport not observed');
          const { backendRequest } = await import(resource.name);
          const conversation = await backendRequest('agent.getConversation', {
            workspaceId: params.workspaceId,
            agentId: params.agentId,
            aroundMessageId: params.messageId,
            limit: 5,
            projection: 'slim',
          });
          const workspace = await backendRequest('workspace.get', {
            workspaceId: params.workspaceId,
          });
          return {
            message: conversation.messages.find((m) => m.id === params.messageId),
            workspace: workspace.workspace,
          };
        },
        { workspaceId, agentId, messageId: item.messageId },
      );
      expect(actual.message).toMatchObject({
        id: item.messageId,
        role: 'assistant',
        seq: item.seq,
      });
      expect(
        actual.message.contentBlocks.some(
          (b) => b.type === 'text' && b.text.includes(`[${item.label}](${href})`),
        ),
      ).toBe(true);
      expect(actual.workspace.worktreePath ?? actual.workspace.path).toBe(root);
      inputs.push({
        ...item,
        href,
        actual,
        fileSha256: createHash('sha256').update(disk).digest('hex'),
      });
      const link = row.getByRole('link', { name: item.label, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await link.locator('..').scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      probes.push({
        phase: 'before',
        width: item.width,
        row: await row.boundingBox(),
        link: await link.boundingBox(),
      });
      await stableLocatorScreenshot(page, link.locator('..'), async ({ png, attempt }) => {
        if (png)
          await info.attach(`file-link-${item.width}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      });
      await link.evaluate((anchor) => {
        anchor.addEventListener(
          'click',
          (event) => {
            globalThis.observeFileLinkActivation({
              href: anchor.getAttribute('href'),
              trusted: event.isTrusted,
            });
          },
          { once: true, capture: true },
        );
      });
      const subscription = lease();
      if (item.width === 1100) {
        await link.focus();
        await page.keyboard.press('Enter');
      } else await link.click();
      await expect(view).toHaveAttribute('data-file-path', item.file);
      await expect
        .poll(() => activations.some((event) => event.href === href && event.trusted))
        .toBe(true);
      await expect(conversation).toHaveCount(0);
      await released(subscription);
      const read = () =>
        replies
          .filter(
            ({ request, response }) =>
              request.method === 'file.read' &&
              request.params.path === item.file &&
              typeof response.result === 'string',
          )
          .at(-1);
      await expect.poll(() => Boolean(read())).toBe(true);
      expect(read().request.params).toEqual({ workspaceId, path: item.file });
      expect(read().response.result).toBe(disk);
      const sourceLines = disk.split('\n');
      await expect
        .poll(async () => {
          const lines = await view
            .getByTestId('workspace-file-content')
            .locator('.code-line')
            .allTextContents();
          // Empty highlighted lines can contain an empty token or the viewer's
          // one-space height spacer. Preserve every nonempty source line exactly.
          return lines.map((line, index) =>
            sourceLines[index] === '' && line === ' ' ? '' : line,
          );
        })
        .toEqual(sourceLines);
      await expect(view.getByRole('heading')).toBeFocused();
      await expect
        .poll(() => view.evaluate((node) => node.scrollWidth - node.clientWidth))
        .toBeLessThanOrEqual(1);
      await view.scrollIntoViewIfNeeded();
      probes.push({ phase: 'file', width: item.width, box: await view.boundingBox() });
      await stableLocatorScreenshot(
        page,
        view,
        async ({ png, attempt, before, after, changes }) => {
          probes.push({
            phase: 'file-capture',
            width: item.width,
            attempt,
            before,
            after,
            changes,
          });
          if (png)
            await info.attach(`file-content-${item.width}-${attempt}`, {
              body: png,
              contentType: 'image/png',
            });
        },
      );
      await page.goBack();
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      await expect(row).toBeFocused();
      await expect(row).toBeInViewport();
      await expect.poll(() => fileEntries()).toEqual([]);
      expect(new URL(page.url()).searchParams.get('message')).toBe(item.messageId);
      probes.push({
        phase: 'return',
        width: item.width,
        row: await row.boundingBox(),
        transcript: await conversation.getByTestId('conversation-messages').evaluate((node) => ({
          scrollTop: node.scrollTop,
          top: node.getBoundingClientRect().top,
        })),
      });
      const returned = lease();
      expect(returned).not.toBe(subscription);
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      await released(returned);
    }
    const subscriptions = replies.filter(
      ({ request, response }) =>
        request.method === 'chat.subscribe' &&
        request.params.agentId === agentId &&
        response.result?.subscriptionId,
    );
    for (const { response } of subscriptions) await released(response.result.subscriptionId);
    expect(page.context().pages()).toHaveLength(1);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    await info.attach('conversation-file-wire-geometry', {
      body: JSON.stringify({
        browserVersion: browser.version(),
        requests,
        replies,
        inputs,
        activations,
        probes,
        errors,
        failedRequests,
      }),
      contentType: 'application/json',
    });
  }
});
