import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real workspace agents match the daemon and release their subscriptions', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const errors = await observeErrors(page);
  const requests = [];
  const replies = [];
  const pushes = [];
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
  const subscriptions = (id = workspaceId) =>
    replies.filter(
      ({ request, response }) =>
        request.method === 'agent.subscribe' &&
        request.params.workspaceId === id &&
        response.result?.subscriptionId,
    );
  const view = page.getByTestId('workspace-agents');
  const toggle = view.getByRole('button', { name: 'Agents', exact: true });
  const rows = view.locator('[data-workspace-agent]');
  const assertDaemonRows = async (id = workspaceId) => {
    const result = await page.evaluate(async (workspaceId) => {
      const module = performance
        .getEntriesByType('resource')
        .find((entry) =>
          new URL(entry.name).pathname.endsWith('/features/backend/backend-transport.ts'),
        );
      if (!module) throw new Error('The real React transport was not observed');
      const { backendRequest } = await import(module.name);
      return backendRequest('agent.list', { workspaceId, scope: 'topLevel' });
    }, id);
    if (id === workspaceId) expect(result.agents.length).toBeGreaterThan(0);
    const expected = result.agents
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.id.localeCompare(b.id));
    await expect
      .poll(() =>
        rows.evaluateAll((nodes) =>
          nodes
            .map((node) => ({
              id: node.getAttribute('data-workspace-agent'),
              name: node.querySelector('[data-slot="list-row-title"]').textContent,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        ),
      )
      .toEqual(expected);
    return expected;
  };
  const subscribed = async (targetId, before) => {
    await expect.poll(() => subscriptions(targetId).length).toBeGreaterThan(before);
    const { request, response } = subscriptions(targetId).at(-1);
    expect(request.params).toEqual({ workspaceId: targetId });
    const id = response.result.subscriptionId;
    await expect
      .poll(() => pushes.some((push) => push.subscriptionId === id && push.kind === 'snapshot'))
      .toBe(true);
    await assertDaemonRows(targetId);
    return id;
  };
  const open = async (id = workspaceId) => {
    const before = subscriptions(id).length;
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    return subscribed(id, before);
  };
  const released = async (id) => {
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'events.unsubscribe' &&
            request.params.subscriptionId === id &&
            !response.error &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
  };
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`${base}/workspaces/${encodeURIComponent(workspaceId)}`);
    await expect(toggle).toBeVisible({ timeout: 60_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(subscriptions()).toHaveLength(0);
    const firstId = await open();
    await page.keyboard.press('Tab');
    await expect(view.getByRole('listitem').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(view.getByRole('listitem').last()).toBeFocused();
    await toggle.click();
    await expect(rows).toHaveCount(0);
    await released(firstId);
    const secondId = await open();
    expect(secondId).not.toBe(firstId);
    const navigation = page.getByTestId('workspace-navigation');
    const otherId = await navigation
      .locator('[data-navigation-workspace]')
      .evaluateAll(
        (nodes, workspaceId) =>
          nodes.map((node) => node.dataset.navigationWorkspace).find((id) => id !== workspaceId),
        workspaceId,
      );
    expect(otherId, 'A second real workspace is required for agent switching').toBeTruthy();
    expect(
      replies.some(
        ({ request, response }) =>
          request.method === 'workspace.list' &&
          response.result?.workspaces.some((workspace) => workspace.id === otherId),
      ),
    ).toBe(true);
    const switchWorkspace = async (id, previousSubscriptionId) => {
      const before = subscriptions(id).length;
      const link = navigation.locator(`[data-navigation-workspace="${id}"]`);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('workspace-overview')).toHaveAttribute('data-workspace-id', id);
      await expect(link).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(rows).toHaveCount(0);
      await released(previousSubscriptionId);
      expect(subscriptions(id)).toHaveLength(before);
      return open(id);
    };
    const otherSubscriptionId = await switchWorkspace(otherId, secondId);
    expect(otherSubscriptionId).not.toBe(secondId);
    const otherRows = await assertDaemonRows(otherId);
    await info.attach('workspace-agent-switch', {
      body: JSON.stringify({
        workspaceId: otherId,
        subscriptionId: otherSubscriptionId,
        otherRows,
      }),
      contentType: 'application/json',
    });
    const restoredId = await switchWorkspace(workspaceId, otherSubscriptionId);
    expect(restoredId).not.toBe(secondId);
    expect(restoredId).not.toBe(otherSubscriptionId);
    await page.setViewportSize({ width: 420, height: 800 });
    await expect
      .poll(() => view.evaluate((node) => node.scrollWidth - node.clientWidth))
      .toBeLessThanOrEqual(1);
    await stableLocatorScreenshot(page, view, async ({ png, attempt }) => {
      if (png)
        await info.attach(`real-workspace-agents-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(view).toHaveCount(0);
    await released(restoredId);
    await page.goBack();
    await expect(toggle).toBeVisible();
    await open();
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
    await expect(page.getByTestId('workspace-connection-lost')).toBeVisible();
    await expect(view).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    const finalId = await open();
    await assertDaemonRows();
    await toggle.click();
    await expect(rows).toHaveCount(0);
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
    await info.attach('workspace-agent-wire', {
      body: JSON.stringify({ requests, replies, pushes, errors }, null, 2),
      contentType: 'application/json',
    });
  }
});
