import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real older conversation pages preserve reading position and retire with their reader', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const errors = await observeErrors(page);
  const requests = [],
    replies = [],
    pushes = [],
    positions = [];
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
  const transcript = conversation.getByTestId('conversation-messages');
  const older = conversation.getByTestId('conversation-load-older');
  const agents = page.getByTestId('workspace-agents');
  const subscriptions = (id) =>
    replies.filter(
      ({ request, response }) =>
        request.method === 'chat.subscribe' &&
        request.params.agentId === id &&
        response.result?.subscriptionId,
    );
  const pages = (id) =>
    replies.filter(
      ({ request }) => request.method === 'agent.getConversation' && request.params.agentId === id,
    );
  const ids = () =>
    transcript
      .locator('[data-message-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.messageId));
  const open = async (agentId) => {
    await agents.getByRole('button', { name: 'Agents', exact: true }).click();
    const count = subscriptions(agentId).length;
    await agents.locator(`[data-workspace-agent="${agentId}"]`).locator('..').focus();
    await page.keyboard.press('Enter');
    await expect(conversation).toHaveAttribute('data-agent-id', agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => subscriptions(agentId).length).toBeGreaterThan(count);
    const subscription = subscriptions(agentId).at(-1).response.result.subscriptionId;
    await expect
      .poll(() =>
        pushes.some(
          (p) =>
            p.subscriptionId === subscription &&
            (p.history?.complete === true ||
              (p.snapshot?.initialHistory?.complete !== false && p.kind === 'snapshot')),
        ),
      )
      .toBe(true);
    return subscription;
  };
  const back = async (subscriptionId) => {
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
  const anchor = () =>
    transcript.evaluate((container) => {
      const bounds = container.getBoundingClientRect();
      const row = [...container.querySelectorAll('[data-message-id]')].find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      if (!row) throw new Error('No visible conversation row');
      return {
        id: row.dataset.messageId,
        offset: row.getBoundingClientRect().top - bounds.top,
        scrollTop: container.scrollTop,
        height: container.scrollHeight,
        width: container.clientWidth,
      };
    });
  const geometry = async (label) =>
    info.attach(label, {
      body: JSON.stringify({
        container: await transcript.boundingBox(),
        anchor: await anchor(),
        ids: await ids(),
      }),
      contentType: 'application/json',
    });
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.goto(`${base}/workspaces/${encodeURIComponent(workspaceId)}`);
    await expect(agents).toBeVisible({ timeout: 60_000 });
    await agents.getByRole('button', { name: 'Agents', exact: true }).click();
    await expect(agents.locator('[data-workspace-agent]').first()).toBeVisible();
    const available = await agents
      .locator('[data-workspace-agent]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.workspaceAgent));
    const first = [
      'agent-2c670a4a-067d-464f-ac60-fd00efd63010',
      'agent-42a4c634-aeb8-4f5a-b904-fd51f8eaf97e',
    ].find((id) => available.includes(id));
    expect(first, 'A known genuine longer conversation must be available').toBeTruthy();
    const second = available.find((id) => id !== first);
    expect(second).toBeTruthy();
    await agents.getByRole('button', { name: 'Agents', exact: true }).click();
    const subscription = await open(first);
    await expect(older).toBeEnabled();
    const snapshot = pushes.find(
      (p) => p.subscriptionId === subscription && p.kind === 'snapshot',
    ).snapshot;
    const tail = [
      ...snapshot.messages,
      ...pushes
        .filter((p) => p.subscriptionId === subscription && p.history?.message)
        .map((p) => p.history.message),
    ].sort((a, b) => a.seq - b.seq);
    expect(snapshot.totalMessages).toBeGreaterThan(tail.length);
    await expect.poll(ids).toEqual(tail.map((m) => m.id));
    await geometry('before-older-page');
    const expected = new Map(tail.map((m) => [m.id, m]));
    let previousToken;
    for (let index = 0; index < 3; index++) {
      if (index === 1) await page.setViewportSize({ width: 420, height: 850 });
      if (index === 2) {
        const prior = await transcript.evaluate((node) => node.scrollTop);
        await transcript.hover();
        await page.mouse.wheel(0, 180);
        await expect
          .poll(() => transcript.evaluate((node) => node.scrollTop))
          .toBeGreaterThan(prior + 100);
      }
      await older.focus();
      const before = await anchor();
      const count = pages(first).length;
      await page.keyboard.press('Enter');
      await expect.poll(() => pages(first).length).toBe(count + 1);
      const wire = pages(first).at(-1);
      expect(wire.response.error).toBeUndefined();
      expect(wire.request.params.workspaceId).toBe(workspaceId);
      expect(wire.request.params.limit).toBe(5);
      expect(wire.request.params.projection).toBe('slim');
      if (previousToken) expect(wire.request.params.nextToken).toBe(previousToken);
      const pageResult = wire.response.result;
      expect(pageResult.messages.length).toBeGreaterThan(0);
      expect(pageResult.messages.some((m) => !expected.has(m.id))).toBe(true);
      previousToken = pageResult.nextToken;
      for (const row of pageResult.messages) expected.set(row.id, row);
      const ordered = [...expected.values()].sort((a, b) => a.seq - b.seq);
      await expect.poll(ids).toEqual(ordered.map((m) => m.id));
      await expect(older).toBeEnabled();
      await expect
        .poll(() =>
          transcript
            .locator(`[data-message-id="${before.id}"]`)
            .evaluate(
              (row, offset) =>
                Math.abs(
                  row.getBoundingClientRect().top -
                    row.closest('[data-testid="conversation-messages"]').getBoundingClientRect()
                      .top -
                    offset,
                ),
              before.offset,
            ),
        )
        .toBeLessThanOrEqual(1);
      positions.push({
        before,
        after: await anchor(),
        request: wire.request.params,
        ids: pageResult.messages.map((m) => m.id),
      });
      // Independently repeat the actual bounded read through the existing real
      // transport. This corroborates message identity, order and content without
      // injecting state or manufacturing a network response.
      const independent = await page.evaluate(async (params) => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!resource) throw new Error('Real transport not observed');
        const { backendRequest } = await import(resource.name);
        return backendRequest('agent.getConversation', params);
      }, wire.request.params);
      expect(independent.messages).toEqual(pageResult.messages);
    }
    await geometry('after-older-pages');
    await expect
      .poll(() => conversation.evaluate((node) => node.scrollWidth - node.clientWidth))
      .toBeLessThanOrEqual(1);
    // The preserved position is intentional; native upward scrolling reveals
    // the newly loaded rows without replacing or seeking the live tail.
    await transcript.hover();
    await page.mouse.wheel(0, -(await transcript.evaluate((node) => node.scrollHeight)));
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBe(0);
    const oldest = [...expected.values()].sort((a, b) => a.seq - b.seq)[0];
    await expect(transcript.locator('[data-message-id]').first()).toHaveAttribute(
      'data-message-id',
      oldest.id,
    );
    await expect(transcript.locator('[data-message-id]').first()).toBeInViewport();
    await stableLocatorScreenshot(page, conversation, async ({ png, attempt }) => {
      if (png)
        await info.attach(`older-history-mobile-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    await back(subscription);
    const secondSubscription = await open(second);
    const secondRows = await ids();
    expect(secondRows.some((id) => expected.has(id))).toBe(false);
    await back(secondSubscription);
    const returned = await open(first);
    await expect(older).toBeEnabled();
    const freshSnapshot = pushes.find(
      (p) => p.subscriptionId === returned && p.kind === 'snapshot',
    ).snapshot;
    const freshTail = [
      ...freshSnapshot.messages,
      ...pushes
        .filter((p) => p.subscriptionId === returned && p.history?.message)
        .map((p) => p.history.message),
    ].sort((a, b) => a.seq - b.seq);
    await expect.poll(ids).toEqual(freshTail.map((m) => m.id));
    const count = pages(first).length;
    await older.click();
    await expect.poll(() => pages(first).length).toBe(count + 1);
    await expect.poll(async () => (await ids()).length).toBeGreaterThan(freshTail.length);
    await back(returned);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('history-wire-and-positions', {
      body: JSON.stringify({ requests, replies, pushes, positions, errors }),
      contentType: 'application/json',
    });
  }
});
