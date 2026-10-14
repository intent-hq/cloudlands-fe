import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('genuine completion wake preserves its report and actor navigation lifetime', async ({
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
  const agentId = 'agent-1c311418-f301-4710-815e-417c1a33aded';
  const messageId = 'completion-wake:3ebe49a3-e16b-4bea-bf95-8d79e2f64147';
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${agentId}&message=${encodeURIComponent(messageId)}`;
  const conversation = page.getByTestId('workspace-conversation');
  const row = conversation.locator(`[data-message-id="${messageId}"]`);
  const header = row.getByTestId('event-wakeup-header');
  const toggle = header.getByTestId('event-wakeup-summary');
  const body = row.getByTestId('event-wakeup-details');
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
    expect(actual.metadata).toMatchObject({ type: 'event_notification', eventCount: 1 });
    const event = actual.metadata.events[0];
    expect(event.type).toBe('agent:idle');
    expect(event.data.agentId).toBe('agent-db54e46f-8df7-4b82-ad79-ac9747f19d9e');
    const original =
      event.data.completionReport || event.data.report || event.data.lastResponseSummary;
    expect(original).toBeTruthy();
    await row.scrollIntoViewIfNeeded();
    await probe('initial');
    await info.attach('initial-event-wake', {
      body: await row.screenshot(),
      contentType: 'image/png',
    });
    await expect(header).toContainText(event.data.agentName);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    expect(await toggle.getAttribute('aria-controls')).toBe(await body.getAttribute('id'));
    expect(await body.getByTestId('event-wakeup-report').textContent()).toBe(original);
    await expect(body.getByTestId('event-wakeup-timestamp')).toHaveAttribute(
      'datetime',
      event.timestamp,
    );
    await expect(body.locator('a, button, script, iframe')).toHaveCount(0);
    await row.scrollIntoViewIfNeeded();
    await probe('expanded');
    await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
      if (png)
        await info.attach(`expanded-event-wake-${attempt}`, {
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
    expect(await body.getByTestId('event-wakeup-report').textContent()).toBe(original);
    await expect(body.getByTestId('event-wakeup-timestamp')).toHaveAttribute(
      'datetime',
      event.timestamp,
    );
    await probe('mobile-expanded');
    await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
      if (png)
        await info.attach(`mobile-event-wake-${attempt}`, { body: png, contentType: 'image/png' });
    });
    const sourceLease = lease();
    await header
      .getByRole('button', { name: `Open agent ${event.data.agentName}`, exact: true })
      .click();
    await expect(conversation).toHaveAttribute('data-agent-id', event.data.agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === sourceLease &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
    await page.goBack();
    await expect(conversation).toHaveAttribute('data-agent-id', agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(row).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(lease()).not.toBe(sourceLease);
    await leave();
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    for (const id of new Set(
      replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' && response.result?.subscriptionId,
        )
        .map(({ response }) => response.result.subscriptionId),
    )) {
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
    }
    expect(errors).toEqual([]);
  } finally {
    await info.attach('event-wake-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});

test('genuine externally-waiting advisory is not presented as a completion', async ({
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
  const agentId = 'agent-1c311418-f301-4710-815e-417c1a33aded';
  const messageId =
    'advisory-wake:9c4fe991-14d2-4121-a8c4-9ab4fe3e78a2:01a13757-554a-7741-91fc-a5bc2a857045';
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${agentId}&message=${encodeURIComponent(messageId)}`;
  const conversation = page.getByTestId('workspace-conversation');
  const row = conversation.locator(`[data-message-id="${messageId}"]`);
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
      type: 'event_notification',
      childExternallyWaiting: true,
      watchStillArmed: true,
    });
    expect(actual.metadata.events[0].type).toBe('agent:idle');
    const original = actual.contentBlocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    expect(original).toContain('NOT its completion');
    await row.scrollIntoViewIfNeeded();
    await probe('advisory');
    await info.attach('advisory-event-wake', {
      body: await row.screenshot(),
      contentType: 'image/png',
    });
    await expect(row.getByTestId('event-wakeup-card')).toHaveCount(0);
    await expect(row).toContainText('NOT its completion');
    for (const monitor of actual.metadata.waitingOnScriptMonitors) {
      await expect(row).toContainText(monitor.runId);
    }
    await leave();
    await page.goBack();
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(row).toBeFocused();
    await expect(row.getByTestId('event-wakeup-card')).toHaveCount(0);
    await expect(row).toContainText('NOT its completion');
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
    await info.attach('event-wake-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});
