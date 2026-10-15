import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// A real, already-emitted and inspected non-writing plan request is required.
// This test does not manufacture permission events or exercise sandbox escalation.
test('isolated genuine plan permission recovery and native decision', async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  const {
    REACT_BASE_URL: base,
    ISOLATED_PERMISSION_REQUEST: input,
    ISOLATED_PERMISSION_PROOF: proofPath,
    ISOLATED_PERMISSION_SHA256: expectedHash,
    ISOLATED_PERMISSION_OPTION: option,
  } = process.env;
  if (
    !base ||
    !input ||
    !proofPath ||
    !expectedHash ||
    !['implement_plan', 'revise_plan'].includes(option) ||
    process.env.ISOLATED_PERMISSION_ALLOW_DECISION !== 'owned-nonwriting-plan'
  )
    throw new Error(
      'Requires an inspected genuine plan receipt, exact hash, current isolated peer proof and explicit decision scope',
    );
  const bytes = await readFile(input);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedHash);
  const { fixture, request: expected } = JSON.parse(bytes);
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  expect(proof.passed).toBe(true);
  expect(proof.peerPid).toBe(fixture.daemon.pid);
  expect(proof.startTimeTicks).toBe(fixture.daemon.startTimeTicks);
  expect(fixture.workspacePath).toMatch(/^\/owned\/workspaces\//);
  expect(new URL(base).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  expect(context.browser()?.version()).toBe('153.0.8010.12');
  expect(expected.title).toBe('Implement this plan?');
  expect(expected.sessionId).toBe(fixture.agentId);
  expect(expected.options.map((o) => o.id).sort()).toEqual(['implement_plan', 'revise_plan']);
  const plan = JSON.parse(expected.description.slice('Tool input: '.length)).plan;
  expect(plan).toBeTruthy();
  const requests = [],
    replies = [],
    pushes = [],
    inputEvents = [],
    geometry = [];
  const errors = await observeErrors(page);
  await page.exposeBinding('__permissionNativeInput', (_, e) => inputEvents.push(e));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    for (const type of ['click', 'keydown', 'input'])
      window.addEventListener(
        type,
        (e) => {
          if (
            e.target instanceof Element &&
            e.target.closest(
              '[data-testid=conversation-permissions],[data-testid=conversation-composer]',
            )
          )
            window.__permissionNativeInput({ type, key: e.key, trusted: e.isTrusted });
        },
        true,
      );
  });
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    const pending = new Map();
    socket.on('framesent', ({ payload }) => {
      const r = JSON.parse(String(payload));
      requests.push(r);
      pending.set(r.id, r);
    });
    socket.on('framereceived', ({ payload }) => {
      const r = JSON.parse(String(payload));
      if (r.method === 'subscription.push') pushes.push(r.params);
      const request = pending.get(r.id);
      if (request) {
        replies.push({ request, response: r });
        pending.delete(r.id);
      }
    });
  });
  const rpc = (method, params) =>
    page.evaluate(
      async ({ method, params }) => {
        const entry = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!entry) throw new Error('Canonical React transport module missing');
        const { backendRequest } = await import(entry.name);
        return backendRequest(method, params);
      },
      { method, params },
    );
  const url = `${base}/workspaces/${fixture.workspaceId}?agent=${fixture.agentId}`;
  const host = page.getByTestId('conversation-permissions');
  const card = host.locator(`[data-permission-request="${expected.requestId}"]`);
  let before, after;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    await expect(card).toBeVisible({ timeout: 30_000 });
    const pending = await rpc('agent.pendingPermissions', {});
    expect(pending.requests.find((r) => r.requestId === expected.requestId)).toEqual(expected);
    before = await rpc('agent.getConversation', {
      workspaceId: fixture.workspaceId,
      agentId: fixture.agentId,
      limit: 30,
    });
    await card.getByRole('button', { name: 'Show raw details' }).click();
    await expect(card).toContainText(expected.description);
    for (const width of [1280, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      geometry.push({
        width,
        card: await card.boundingBox(),
        page: await page.evaluate(() => ({
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      });
      expect(geometry.at(-1).page.scrollWidth).toBeLessThanOrEqual(width);
      await writeFile(
        info.outputPath(`pending-${width}.png`),
        await stableLocatorScreenshot(page, card),
      );
    }
    const textarea = page.getByTestId('conversation-composer').locator('textarea');
    await textarea.focus();
    await textarea.press('1');
    await textarea.press('Escape');
    expect(requests.filter((r) => r.method === 'agent.respondPermission')).toEqual([]);
    await textarea.fill('');
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(host).toHaveCount(0);
    await page.goBack();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const recoveredCount = replies.filter(
      (r) => r.request.method === 'agent.pendingPermissions',
    ).length;
    // Close the actual owned socket, exercising the existing transport reconnect.
    // No response/error/readiness callback or Store value is synthesized.
    await page.evaluate(async () => {
      const entry = performance
        .getEntriesByType('resource')
        .find((e) => new URL(e.name).pathname.endsWith('/backend-transport-factory.ts'));
      if (!entry) throw new Error('Transport lifetime module missing');
      const { resolveBackendTransport } = await import(entry.name);
      const socket = resolveBackendTransport().socket;
      if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
        throw new Error('Expected an owned open socket');
      await new Promise((resolve) => {
        socket.addEventListener('close', resolve, { once: true });
        socket.close();
      });
    });
    await expect
      .poll(() => replies.filter((r) => r.request.method === 'agent.pendingPermissions').length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(recoveredCount);
    await expect(card).toBeVisible();
    expect(requests.filter((r) => r.method === 'agent.respondPermission')).toEqual([]);
    const button = card.getByRole('button', {
      name: new RegExp(expected.options.find((o) => o.id === option).label),
    });
    if (option === 'implement_plan') {
      await button.focus();
      await button.press('Enter');
    } else await button.click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect
      .poll(() => replies.filter((r) => r.request.method === 'agent.respondPermission').length)
      .toBe(1);
    const response = replies.find((r) => r.request.method === 'agent.respondPermission');
    expect(response.request.params).toEqual({
      requestId: expected.requestId,
      outcome: { outcome: 'selected', optionId: option },
      workspaceId: fixture.workspaceId,
    });
    expect(response.response.result).toEqual({ resolved: true });
    await expect
      .poll(
        async () =>
          (
            await rpc('agent.getConversation', {
              workspaceId: fixture.workspaceId,
              agentId: fixture.agentId,
              limit: 30,
            })
          ).turnInFlight,
        { timeout: 60_000 },
      )
      .toBe(false);
    after = await rpc('agent.getConversation', {
      workspaceId: fixture.workspaceId,
      agentId: fixture.agentId,
      limit: 30,
    });
    expect(
      (await rpc('agent.pendingPermissions', {})).requests.some(
        (r) => r.requestId === expected.requestId,
      ),
    ).toBe(false);
    // A pending plan can still exist only in the streamed transcript. The daemon
    // persists it when this turn completes; both positions are valid. Preserve
    // earlier persisted messages and corroborate the final plan against the
    // exact genuine permission payload, rather than assuming it was persisted.
    const project = (message) => ({
      id: message.id,
      role: message.role,
      contentBlocks: message.contentBlocks,
    });
    const lastBefore = before.messages.at(-1);
    const planAlreadyPersisted =
      lastBefore?.role === 'assistant' &&
      lastBefore.contentBlocks.length === 1 &&
      lastBefore.contentBlocks[0].text?.trim() === plan.trim();
    const earlier = planAlreadyPersisted ? before.messages.slice(0, -1) : before.messages;
    expect(after.messages.slice(0, earlier.length).map(project)).toEqual(earlier.map(project));
    expect(after.messages).toHaveLength(earlier.length + 1);
    const finalPlan = after.messages.at(-1);
    expect(finalPlan.role).toBe('assistant');
    if (planAlreadyPersisted) expect(finalPlan.id).toBe(lastBefore.id);
    expect(finalPlan.contentBlocks).toHaveLength(1);
    expect(finalPlan.contentBlocks[0].type).toBe('text');
    const reply = option === 'implement_plan' ? process.env.ISOLATED_PERMISSION_EXPECTED_REPLY : '';
    if (option === 'implement_plan') expect(reply).toBeTruthy();
    // Revise completes the proposed plan without an implementation prompt. It
    // does not establish denial of an ordinary sandbox command or file write.
    expect(finalPlan.contentBlocks[0].text.trim()).toBe((plan + reply).trim());
    await expect(page.locator(`[data-message-id="${finalPlan.id}"]`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('workspace-conversation')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await expect(host).toHaveCount(0);
    const leases = replies.filter(
      (r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId,
    );
    const last = leases.at(-1).response.result.subscriptionId;
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'chat.unsubscribe' &&
            r.request.params.subscriptionId === last &&
            r.response.result?.success,
        ),
      )
      .toBe(true);
    expect(requests.filter((r) => r.method === 'agent.respondPermission')).toHaveLength(1);
    expect(
      requests.filter((r) =>
        /^(agent\.(sendMessage|create)|file\.(write|delete)|workspace\.(create|update))$/.test(
          r.method,
        ),
      ),
    ).toEqual([]);
    expect(inputEvents.length).toBeGreaterThan(0);
    expect(inputEvents.every((e) => e.trusted)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('wire-and-geometry.json'),
      JSON.stringify(
        {
          fixture,
          expected,
          proof,
          option,
          before,
          after,
          geometry,
          requests,
          replies,
          pushes,
          inputEvents,
          errors,
        },
        null,
        2,
      ),
    );
  }
});
