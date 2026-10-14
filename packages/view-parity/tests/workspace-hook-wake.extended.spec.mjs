import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real retired hook wake disclosure preserves text and retires its conversation reader', async ({
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
  const agentId = 'agent-db54e46f-8df7-4b82-ad79-ac9747f19d9e';
  const messageId = 'user-msg-efd4bf3e-1232-4561-8e08-be00e8b1b6c9';
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${agentId}&message=${encodeURIComponent(messageId)}`;
  const conversation = page.getByTestId('workspace-conversation');
  const row = conversation.locator(`[data-message-id="${messageId}"]`);
  const header = row.getByTestId('automated-wake-header');
  const toggle = header.getByTestId('automated-wake-toggle');
  const body = row.getByTestId('hook-wake-expanded-body');
  const probe = async (label) =>
    probes.push({
      label,
      ...(await row.evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        height: el.getBoundingClientRect().height,
        width: el.getBoundingClientRect().width,
        text: el.textContent,
      }))),
    });
  const lease = () =>
    replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === agentId &&
          response.result?.subscriptionId,
      )
      .at(-1)?.response.result.subscriptionId;
  const leave = async () => {
    const subscriptionId = lease();
    expect(subscriptionId).toBeTruthy();
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === subscriptionId &&
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
        const result = await backendRequest('agent.getConversation', {
          workspaceId,
          agentId,
          aroundMessageId: messageId,
          limit: 5,
          projection: 'slim',
        });
        return result.messages.find((m) => m.id === messageId);
      },
      { workspaceId, agentId, messageId },
    );
    expect(actual.metadata).toMatchObject({
      type: 'hook_wake',
      hookId: '046661d6-9c74-4224-971f-457f193baf67',
      reason: 'dispatched',
      hookStillActive: false,
    });
    // This genuine retired wake has no queue note; compare its body to the daemon receipt.
    expect(actual.metadata.queueInfo).toBeUndefined();
    const raw = actual.contentBlocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();
    const prefix = `[Background hook "${actual.metadata.hookName}"] `;
    expect(raw.startsWith(prefix)).toBe(true);
    expect(raw).toContain('\n\n[This hook is now retired');
    const original = raw.slice(prefix.length, raw.lastIndexOf('\n\n[This hook ')).trim();
    expect(original).toContain('Inspect saved output and ownership');
    await row.scrollIntoViewIfNeeded();
    await probe('initial');
    await info.attach('initial-hook-wake', {
      body: await row.screenshot(),
      contentType: 'image/png',
    });
    await expect(header).toHaveAttribute('data-wake-kind', 'hook');
    await expect(header).toHaveAttribute('data-wake-state', 'retired');
    await expect(header).toContainText(actual.metadata.hookName);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    expect(await toggle.getAttribute('aria-controls')).toBe(await body.getAttribute('id'));
    expect(await body.textContent()).toBe(original);
    await expect(body.locator('a, button, script, iframe')).toHaveCount(0);
    await row.scrollIntoViewIfNeeded();
    await probe('expanded');
    await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
      if (png)
        await info.attach(`expanded-hook-wake-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    await toggle.click();
    await expect(body).toHaveCount(0);
    await toggle.click();
    await expect(body).toBeVisible();
    await leave();
    await page.setViewportSize({ width: 420, height: 850 });
    await page.goBack();
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(row).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(body).toBeVisible();
    expect(await body.textContent()).toBe(original);
    await probe('mobile-expanded');
    await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
      if (png)
        await info.attach(`mobile-hook-wake-${attempt}`, { body: png, contentType: 'image/png' });
    });
    await leave();
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('hook-wake-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});
