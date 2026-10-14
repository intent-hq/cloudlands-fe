import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real truncated tool output hydrates only on expansion and retires with its reader', async ({
  page,
}, info) => {
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
  const read = (method, params) =>
    page.evaluate(
      async ({ method, params }) => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!resource) throw new Error('Real transport not observed');
        const { backendRequest } = await import(resource.name);
        return backendRequest(method, params);
      },
      { method, params },
    );
  const conversation = page.getByTestId('workspace-conversation');
  const agentId = 'agent-2c670a4a-067d-464f-ac60-fd00efd63010';
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${encodeURIComponent(agentId)}`;
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.goto(url);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    const history = await read('agent.getConversation', {
      workspaceId,
      agentId,
      limit: 5,
      aroundIndex: 0,
      projection: 'slim',
    });
    const message = history.messages.find((m) =>
      m.contentBlocks?.some((b) => b.type === 'tool_result' && b.outputTruncated && b.id),
    );
    expect(message, 'Genuine persisted truncated tool output is required').toBeTruthy();
    const block = message.contentBlocks.find(
      (b) => b.type === 'tool_result' && b.outputTruncated && b.id,
    );
    await page.goto(`${url}&message=${encodeURIComponent(message.id)}`);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    const reasoning = conversation
      .locator(`[data-message-id="${message.id}"]`)
      .getByRole('button', { name: 'Reasoning', exact: true });
    await reasoning.click();
    await expect(reasoning).toHaveAttribute('aria-expanded', 'true');
    const row = conversation.locator(`[data-tool-block-id="${block.id}"]`);
    const trigger = row.getByRole('button').first();
    await expect(trigger).toBeVisible();
    expect(requests.filter((r) => r.method === 'agent.getMessageBlock')).toHaveLength(0);
    const probe = async (label) =>
      probes.push({
        label,
        ...(await row.evaluate((el) => ({
          top: el.getBoundingClientRect().top,
          height: el.getBoundingClientRect().height,
          body: el.querySelector('pre')?.textContent ?? null,
        }))),
      });
    await trigger.scrollIntoViewIfNeeded();
    const beforeTop = await trigger.evaluate((el) => el.getBoundingClientRect().top);
    await probe('before-expansion');
    await trigger.click();
    const body = row.locator('[data-block-id]');
    await expect(body).toHaveAttribute('data-hydration', 'loaded');
    const uiRead = replies.filter(({ request }) => request.method === 'agent.getMessageBlock');
    expect(uiRead).toHaveLength(1);
    expect(uiRead[0].request.params).toEqual({
      workspaceId,
      agentId,
      messageId: message.id,
      blockId: block.id,
    });
    expect(uiRead[0].response.error).toBeUndefined();
    const full = uiRead[0].response.result.block;
    expect(full.outputTruncated).not.toBe(true);
    expect(full.output).not.toEqual(block.output);
    await expect(body.locator('pre')).toHaveText(JSON.stringify(full.output, null, 2));
    const independent = await read('agent.getMessageBlock', uiRead[0].request.params);
    expect(independent.block).toEqual(full);
    expect(
      Math.abs((await trigger.evaluate((el) => el.getBoundingClientRect().top)) - beforeTop),
    ).toBeLessThanOrEqual(1);
    await row.scrollIntoViewIfNeeded();
    await probe('after-hydration');
    await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
      if (png)
        await info.attach(`hydrated-tool-${attempt}`, { body: png, contentType: 'image/png' });
    });
    const readsBeforeCollapse = requests.filter((r) => r.method === 'agent.getMessageBlock').length;
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(body).toHaveAttribute('data-hydration', 'loaded');
    expect(requests.filter((r) => r.method === 'agent.getMessageBlock')).toHaveLength(
      readsBeforeCollapse,
    );
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
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('tool-hydration-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});
