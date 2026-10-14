import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real message links seek the canonical row and retire on return', async ({ page }, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const errors = await observeErrors(page);
  const requests = [],
    replies = [],
    probes = [];
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
  const transcript = conversation.getByTestId('conversation-messages');
  const rows = () =>
    transcript
      .locator('[data-message-id]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.messageId));
  const read = (params) =>
    page.evaluate(async (params) => {
      const resource = performance
        .getEntriesByType('resource')
        .find((r) => new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'));
      if (!resource) throw new Error('Real transport not observed');
      const { backendRequest } = await import(resource.name);
      return backendRequest('agent.getConversation', params);
    }, params);
  const probe = async (label) => {
    const value = await transcript.evaluate((container) => ({
      scrollTop: container.scrollTop,
      height: container.clientHeight,
      rows: [...container.querySelectorAll('[data-message-id]')].map((row) => ({
        id: row.dataset.messageId,
        top: row.getBoundingClientRect().top - container.getBoundingClientRect().top,
        height: row.getBoundingClientRect().height,
        focused: row === document.activeElement,
      })),
    }));
    probes.push({ label, ...value });
  };
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    const agentId = 'agent-2c670a4a-067d-464f-ac60-fd00efd63010';
    const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${encodeURIComponent(agentId)}`;
    await page.goto(url);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(page.getByTestId('conversation-load-older')).toBeEnabled();
    const tail = await rows();
    expect(tail.length).toBeGreaterThan(0);
    const older = await read({
      workspaceId,
      agentId,
      limit: 5,
      aroundIndex: 0,
      projection: 'slim',
    });
    const target = older.messages.find((message) => !tail.includes(message.id));
    expect(target, 'A genuine older message outside the resident tail is required').toBeTruthy();
    await probe('before-message-navigation');
    await info.attach('before-message-navigation', {
      body: await conversation.screenshot(),
      contentType: 'image/png',
    });
    await page.goto(`${url}&message=${encodeURIComponent(target.id)}`);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    const targetRow = transcript.locator(`[data-message-id="${target.id}"]`);
    await expect(targetRow).toBeFocused();
    await expect(targetRow).toBeInViewport();
    const seek = replies.find(
      ({ request }) =>
        request.method === 'agent.getConversation' && request.params.aroundMessageId === target.id,
    );
    expect(seek).toBeTruthy();
    expect(seek.response.error).toBeUndefined();
    expect(seek.request.params).toMatchObject({
      workspaceId,
      agentId,
      limit: 5,
      projection: 'slim',
    });
    const independent = await read(seek.request.params);
    expect(independent.messages).toEqual(seek.response.result.messages);
    const actual = await rows();
    for (const id of tail) expect(actual).toContain(id);
    const expectedPageIds = independent.messages.map((message) => message.id);
    expect(actual.filter((id) => expectedPageIds.includes(id))).toEqual(expectedPageIds);
    const text = target.contentBlocks
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    expect(text?.trim(), 'The genuine target must contain readable text').toBeTruthy();
    await expect(targetRow).toContainText(text.trim().split('\n')[0]);
    await probe('after-message-navigation');
    await stableLocatorScreenshot(page, conversation, async ({ png, attempt }) => {
      if (png)
        await info.attach(`message-target-${attempt}`, { body: png, contentType: 'image/png' });
    });
    const subscription = replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === agentId &&
          response.result?.subscriptionId,
      )
      .at(-1).response.result.subscriptionId;
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('message')).toBe(false);
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === subscription &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
    await page.setViewportSize({ width: 420, height: 850 });
    await page.goto(`${url}&message=${encodeURIComponent(tail.at(-1))}`);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(transcript.locator(`[data-message-id="${tail.at(-1)}"]`)).toBeFocused();
    await expect(transcript.locator(`[data-message-id="${tail.at(-1)}"]`)).toBeInViewport();
    await probe('resident-mobile-target');
    const mobileSubscription = replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === agentId &&
          response.result?.subscriptionId,
      )
      .at(-1).response.result.subscriptionId;
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === mobileSubscription &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('message-target-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});
