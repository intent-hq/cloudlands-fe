import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real agent conversation reads canonical messages and releases on back, switch and reconnect', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const errors = await observeErrors(page);
  const requests = [],
    replies = [],
    pushes = [];
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
      if (response.method === 'subscription.push') pushes.push(response.params);
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (request) replies.push({ request, response });
    });
  });
  const conversation = page.getByTestId('workspace-conversation');
  const subscriptions = (id) =>
    replies.filter(
      ({ request, response }) =>
        request.method === 'chat.subscribe' &&
        request.params.agentId === id &&
        response.result?.subscriptionId,
    );
  const released = async (id) =>
    expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === id &&
            !response.error &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
  const agents = page.getByTestId('workspace-agents');
  const showLatest = async () => {
    const transcript = conversation.getByTestId('conversation-messages');
    await transcript.hover();
    await page.mouse.wheel(0, await transcript.evaluate((node) => node.scrollHeight));
    await expect
      .poll(() =>
        transcript.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
      )
      .toBeLessThanOrEqual(1);
  };
  const open = async (agentId) => {
    await agents.getByRole('button', { name: 'Agents', exact: true }).click();
    const row = agents.locator(`[data-workspace-agent="${agentId}"]`).locator('..');
    const before = subscriptions(agentId).length;
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(conversation).toHaveAttribute('data-agent-id', agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect.poll(() => subscriptions(agentId).length).toBeGreaterThan(before);
    const subscription = subscriptions(agentId).at(-1);
    expect(subscription.request.params.workspaceId).toBe(workspaceId);
    const id = subscription.response.result.subscriptionId;
    await expect
      .poll(() => pushes.some((push) => push.subscriptionId === id && push.kind === 'snapshot'))
      .toBe(true);
    return id;
  };
  const assertMessages = async (agentId) => {
    const subscriptionId = subscriptions(agentId).at(-1).response.result.subscriptionId;
    const snapshot = pushes.find(
      (push) => push.subscriptionId === subscriptionId && push.kind === 'snapshot',
    ).snapshot;
    if (snapshot.initialHistory?.complete === false) {
      await expect
        .poll(() =>
          pushes.some(
            (push) => push.subscriptionId === subscriptionId && push.history?.complete === true,
          ),
        )
        .toBe(true);
    }
    const delivered = [
      ...snapshot.messages,
      ...pushes
        .filter((push) => push.subscriptionId === subscriptionId && push.history?.message)
        .map((push) => push.history.message),
    ].sort((a, b) => a.seq - b.seq);
    // The standing subscription supplies a bounded progressive window. The
    // independent history page may be larger; it must corroborate every row.
    const result = await page.evaluate(
      async ({ workspaceId, agentId }) => {
        const module = performance
          .getEntriesByType('resource')
          .find((entry) =>
            new URL(entry.name).pathname.endsWith('/features/backend/backend-transport.ts'),
          );
        if (!module) throw new Error('The real React transport was not observed');
        const { backendRequest } = await import(module.name);
        return backendRequest('agent.getConversation', { workspaceId, agentId, limit: 50 });
      },
      { workspaceId, agentId },
    );
    expect(result.messages.length).toBeGreaterThan(0);
    const expected = delivered.map((message) => message.id);
    expect(expected.length).toBeGreaterThan(0);
    for (const message of delivered) {
      const independent = result.messages.find((row) => row.id === message.id);
      expect(independent, `Independent history contains ${message.id}`).toBeTruthy();
      expect(independent.role).toBe(message.role);
      expect(independent.contentBlocks).toEqual(message.contentBlocks);
    }
    await expect
      .poll(() =>
        conversation
          .locator('[data-message-id]')
          .evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId)),
      )
      .toEqual(expected);
    const readable = delivered
      .flatMap((message) =>
        (message.contentBlocks ?? [])
          .filter((block) => block.type === 'text')
          .flatMap((block) =>
            (block.text ?? '').split('\n').map((text) => ({ id: message.id, text: text.trim() })),
          ),
      )
      .find(({ text }) => text.length > 30 && /^[\p{L}\p{N}][^`*#[\]<>|{}\\]*$/u.test(text));
    expect(
      readable,
      'A genuine plain-text line is available for rendered content verification',
    ).toBeTruthy();
    // Canonical event reports and agent messages start collapsed. Open their
    // disclosure with native input before checking the chosen genuine text.
    const readableRow = conversation.locator(`[data-message-id="${readable.id}"]`);
    const selectedMessage = delivered.find((message) => message.id === readable.id);
    const isEventReport = selectedMessage.metadata?.type === 'event_notification';
    const disclosure = readableRow.getByTestId(
      isEventReport ? 'event-wakeup-summary' : 'agent-message-disclosure-toggle',
    );
    if (isEventReport) await expect(disclosure).toHaveCount(1);
    if (await disclosure.count()) {
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(
        readableRow.getByTestId(
          isEventReport ? 'event-wakeup-details' : 'agent-message-expanded-body',
        ),
      ).toBeVisible();
      await info.attach(`opened-disclosure-${readable.id}`, {
        body: JSON.stringify({ messageId: readable.id, text: readable.text }),
        contentType: 'application/json',
      });
    }
    await expect(conversation.locator(`[data-message-id="${readable.id}"]`)).toContainText(
      readable.text,
    );
    await info.attach(`canonical-message-ids-${agentId}`, {
      body: JSON.stringify({ agentId, expected }),
      contentType: 'application/json',
    });
  };
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.goto(`${base}/workspaces/${encodeURIComponent(workspaceId)}`);
    await expect(agents).toBeVisible({ timeout: 60_000 });
    await agents.getByRole('button', { name: 'Agents', exact: true }).click();
    await expect(agents.locator('[data-workspace-agent]').first()).toBeVisible();
    const ids = await agents
      .locator('[data-workspace-agent]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.workspaceAgent));
    const preferred = 'agent-42a4c634-aeb8-4f5a-b904-fd51f8eaf97e';
    const first = ids.includes(preferred) ? preferred : ids[0];
    const second = ids.find((id) => id !== first);
    expect(second, 'Two existing agents are required').toBeTruthy();
    await agents.getByRole('button', { name: 'Agents', exact: true }).click();
    const firstSubscription = await open(first);
    await expect(conversation.getByRole('heading', { level: 2 })).toBeFocused();
    await assertMessages(first);
    await showLatest();
    const before = await conversation.boundingBox();
    await stableLocatorScreenshot(page, conversation, async ({ png, attempt }) => {
      if (png)
        await info.attach(`real-conversation-${attempt}`, { body: png, contentType: 'image/png' });
    });
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await expect(
      page.getByTestId('workspace-overview').getByRole('heading', { level: 1 }),
    ).toBeFocused();
    await released(firstSubscription);
    const secondSubscription = await open(second);
    await assertMessages(second);
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await released(secondSubscription);
    await open(first);
    await page.evaluate(async () => {
      const module = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname.endsWith('/backend-transport-factory.ts'));
      if (!module) throw new Error('The actual backend transport was not observed');
      const { resolveBackendTransport } = await import(module.name);
      const socket = resolveBackendTransport().socket;
      if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
        throw new Error('Expected the real daemon socket');
      await new Promise((resolve) => {
        socket.addEventListener('close', resolve, { once: true });
        socket.close();
      });
    });
    await page.context().setOffline(true);
    await expect(conversation).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Daemon is not connected');
    const beforeReconnect = subscriptions(first).length;
    await page.context().setOffline(false);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect.poll(() => subscriptions(first).length).toBeGreaterThan(beforeReconnect);
    await assertMessages(first);
    const finalId = subscriptions(first).at(-1).response.result.subscriptionId;
    await page.setViewportSize({ width: 420, height: 850 });
    await expect
      .poll(() => conversation.evaluate((node) => node.scrollWidth - node.clientWidth))
      .toBeLessThanOrEqual(1);
    await info.attach('conversation-geometry', {
      body: JSON.stringify({ desktop: before, mobile: await conversation.boundingBox() }),
      contentType: 'application/json',
    });
    await showLatest();
    await stableLocatorScreenshot(page, conversation, async ({ png, attempt }) => {
      if (png)
        await info.attach(`real-conversation-mobile-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(conversation).toHaveCount(0);
    await released(finalId);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.context().setOffline(false);
    await info.attach('conversation-wire', {
      body: JSON.stringify({ requests, replies, pushes, errors }),
      contentType: 'application/json',
    });
  }
});
