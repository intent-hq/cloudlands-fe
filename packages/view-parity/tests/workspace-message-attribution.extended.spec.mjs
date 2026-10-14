import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real agent sender disclosure navigates with read-only reader cleanup', async ({
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
  const agentId = 'agent-2c670a4a-067d-464f-ac60-fd00efd63010';
  const messageId = 'user-msg-88e1538c-2ed2-43df-a8b6-10de3251bed3';
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${agentId}&message=${messageId}`;
  const conversation = page.getByTestId('workspace-conversation');
  const row = conversation.locator(`[data-message-id="${messageId}"]`);
  const probe = async (label) =>
    probes.push({
      label,
      ...(await row.evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        height: el.getBoundingClientRect().height,
        text: el.textContent,
      }))),
    });
  const subscription = (id) =>
    replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === id &&
          response.result?.subscriptionId,
      )
      .at(-1)?.response.result.subscriptionId;
  const expectReleased = async (id) => {
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
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.goto(url);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(row).toBeFocused();
    const actual = await page.evaluate(
      async ({ workspaceId, agentId, messageId }) => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!resource) throw new Error('Real transport not observed');
        const { backendRequest } = await import(resource.name);
        const history = await backendRequest('agent.getConversation', {
          workspaceId,
          agentId,
          aroundMessageId: messageId,
          limit: 5,
          projection: 'slim',
        });
        return history.messages.find((m) => m.id === messageId);
      },
      { workspaceId, agentId, messageId },
    );
    expect(actual.metadata.type).toBe('agent_message');
    expect(actual.metadata.fromAgentId).toBeTruthy();
    await row.scrollIntoViewIfNeeded();
    await probe('initial');
    await info.attach('initial-attribution-row', {
      body: await row.screenshot(),
      contentType: 'image/png',
    });
    const header = row.getByTestId('agent-message-disclosure-header');
    await expect(header).toBeVisible();
    await expect(header.getByTestId('agent-message-actor-name')).toHaveText(
      actual.metadata.fromAgentName,
    );
    const toggle = header.getByTestId('agent-message-disclosure-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByTestId('agent-message-expanded-body')).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const body = row.getByTestId('agent-message-expanded-body');
    await expect(body).toBeVisible();
    const original = actual.contentBlocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const prefix = `[MESSAGE FROM AGENT ${actual.metadata.fromAgentName} (${actual.metadata.fromAgentId})]`;
    expect(original.startsWith(prefix)).toBe(true);
    const meaningful = original.slice(prefix.length).trim().split('\n')[0];
    expect(meaningful).toBeTruthy();
    await expect(body).toContainText(meaningful);
    await expect(body).not.toContainText(prefix);
    await row.scrollIntoViewIfNeeded();
    await probe('expanded');
    await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
      if (png)
        await info.attach(`attributed-message-${attempt}`, { body: png, contentType: 'image/png' });
    });
    const originalLease = subscription(agentId);
    await header.getByTestId('agent-message-attribution').click();
    await expect(conversation).toHaveAttribute('data-agent-id', actual.metadata.fromAgentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expectReleased(originalLease);
    const senderLease = subscription(actual.metadata.fromAgentId);
    await page.goBack();
    await expect(conversation).toHaveAttribute('data-agent-id', agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(row).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expectReleased(senderLease);
    const returnedLease = subscription(agentId);
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await expectReleased(returnedLease);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('sender-attribution-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});
