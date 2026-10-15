import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// MUTATING acceptance: opt in only with an owned isolated daemon receipt.
// The launcher must verify the socket peer/namespace before starting its bridge.
test('isolated existing-agent Send, stream, Stop, draft/reconnect and persisted history', async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const {
    REACT_BASE_URL: base,
    ISOLATED_CHAT_FIXTURE: fixturePath,
    ISOLATED_CHAT_SOCKET_PROOF: proofPath,
  } = process.env;
  if (
    !base ||
    !fixturePath ||
    !proofPath ||
    process.env.ISOLATED_CHAT_ALLOW_SEND !== 'owned-test-daemon'
  )
    throw new Error(
      'Requires an explicitly owned test daemon, peer proof, fixture and Send opt-in',
    );
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  expect(proof.passed).toBe(true);
  expect(proof.peerPid).toBe(fixture.daemon.pid);
  expect(proof.socket).toBe(fixture.hostSocket);
  expect(fixture.workspacePath).toMatch(/^\/owned\/workspaces\//);
  expect(new URL(base).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const { workspaceId, agentId } = fixture;
  const errors = await observeErrors(page);
  const requests = [],
    replies = [],
    pushes = [],
    inputEvents = [];
  await page.exposeBinding('__chatInputEvidence', (_source, event) => inputEvents.push(event));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    for (const type of ['click', 'keydown', 'input'])
      window.addEventListener(
        type,
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-testid=conversation-composer]')
          )
            window.__chatInputEvidence({ type, trusted: event.isTrusted, key: event.key });
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
      pending.delete(r.id);
      if (request) replies.push({ request, response: r });
    });
  });
  const rpc = (method, params) =>
    page.evaluate(
      async ({ method, params }) => {
        const module = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!module) throw new Error('Actual React transport module missing');
        const { backendRequest } = await import(module.name);
        return backendRequest(method, params);
      },
      { method, params },
    );
  const composer = page.getByTestId('conversation-composer');
  const textarea = composer.locator('textarea');
  const send = composer.getByRole('button', { name: 'Send', exact: true });
  const ready = async () => {
    await expect(page.getByTestId('workspace-conversation')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await expect(textarea).toBeEnabled({ timeout: 15_000 });
    await expect(send).toBeVisible({ timeout: 30_000 });
  };
  const sendCount = () => requests.filter((r) => r.method === 'agent.sendMessage').length;
  const geometry = async () =>
    composer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
  let before, after, history;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}`);
    await ready();
    const actual = await rpc('agent.get', { workspaceId, agentId });
    expect(actual.agent.id).toBe(agentId);
    expect(actual.agent.workspaceId).toBe(workspaceId);
    expect(actual.agent.provider).toBe(fixture.provider);
    before = await geometry();
    const token = `NATIVE_CHAT_${Date.now()}`;
    const prompt = `Reply with exactly ${token}. Do not use tools, read files, run commands, delegate, or change any state.`;
    await textarea.pressSequentially(prompt);
    await expect(textarea).toHaveValue(prompt);
    // Reload after the canonical drafts.set acknowledgement, not a debounce sleep.
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'drafts.set' &&
            r.request.params.text === prompt &&
            r.response.result?.ok,
        ),
      )
      .toBe(true);
    await page.reload();
    await ready();
    await expect(textarea).toHaveValue(prompt);
    await textarea.press('Enter');
    await expect.poll(sendCount, { timeout: 30_000 }).toBe(1);
    await expect(page.locator('[data-message-role=assistant]').last()).toContainText(token, {
      timeout: 60_000,
    });
    await expect(textarea).toHaveValue('');
    await ready();
    expect(pushes.some((p) => p.kind === 'delta' && JSON.stringify(p).includes(token))).toBe(true);
    history = await rpc('agent.getConversation', { workspaceId, agentId, limit: 50 });
    const user = history.messages.find(
      (m) => m.role === 'user' && JSON.stringify(m.contentBlocks).includes(token),
    );
    const assistant = history.messages.find(
      (m) => m.role === 'assistant' && JSON.stringify(m.contentBlocks).includes(token),
    );
    expect(user?.id).toBeTruthy();
    expect(assistant?.id).toBeTruthy();
    expect(assistant.seq).toBeGreaterThan(user.seq);
    await page.reload();
    await ready();
    await expect(page.locator(`[data-message-id="${assistant.id}"]`)).toContainText(token);
    expect(sendCount()).toBe(1);
    const savedDraft = `Retained unsent ${token}`;
    await textarea.fill(savedDraft);
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'drafts.set' &&
            r.request.params.text === savedDraft &&
            r.response.result?.ok,
        ),
      )
      .toBe(true);
    const draft = `Unsaved during disconnect ${token}`;
    for (const recoveredDraft of [draft, '']) {
      const replyStart = replies.length;
      await textarea.fill(recoveredDraft);
      await page.evaluate(async () => {
        const module = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/backend-transport-factory.ts'));
        if (!module) throw new Error('Transport lifetime module missing');
        const { resolveBackendTransport } = await import(module.name);
        const socket = resolveBackendTransport().socket;
        if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
          throw new Error('Expected owned open socket');
        await new Promise((resolve) => {
          socket.addEventListener('close', resolve, { once: true });
          socket.close();
        });
      });
      await context.setOffline(true);
      await expect(page.getByTestId('workspace-conversation')).toHaveCount(0);
      await context.setOffline(false);
      await ready();
      await expect(textarea).toHaveValue(recoveredDraft);
      await expect
        .poll(() =>
          replies
            .slice(replyStart)
            .some(
              (r) =>
                r.request.method === 'drafts.set' &&
                r.request.params.text === recoveredDraft &&
                r.response.result?.ok,
            ),
        )
        .toBe(true);
      await page.reload();
      await ready();
      await expect(textarea).toHaveValue(recoveredDraft);
      expect(sendCount()).toBe(1);
    }
    await page.setViewportSize({ width: 420, height: 900 });
    const stopToken = `CLOUD_${Date.now()}`;
    const count = await page.locator('[data-message-role=assistant]').count();
    await textarea.fill(
      `Write 150 numbered one-sentence observations about clouds, starting with ${stopToken}. Text only. Do not use tools, read files, run commands, delegate, or change any state.`,
    );
    await send.click();
    const stop = composer.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.locator('[data-message-role=assistant]').count(), { timeout: 60_000 })
      .toBeGreaterThan(count);
    await expect(page.locator('[data-message-role=assistant]').last()).toContainText(stopToken, {
      timeout: 60_000,
    });
    await stop.click();
    await expect
      .poll(
        () => replies.some((r) => r.request.method === 'agent.stop' && r.response.result?.success),
        { timeout: 30_000 },
      )
      .toBe(true);
    await ready();
    expect(sendCount()).toBe(2);
    after = await geometry();
    expect(after.scrollWidth).toBeLessThanOrEqual(after.viewport);
    await composer.scrollIntoViewIfNeeded();
    await writeFile(
      info.outputPath('composer-narrow.png'),
      await stableLocatorScreenshot(page, composer),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    // Wait for native locator stability after responsive layout, before capture.
    await composer.scrollIntoViewIfNeeded();
    await writeFile(
      info.outputPath('composer-desktop.png'),
      await stableLocatorScreenshot(page, composer),
    );
    const subscriptions = replies.filter(
      (r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId,
    );
    const lastLease = subscriptions.at(-1).response.result.subscriptionId;
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(page.getByTestId('workspace-conversation')).toHaveCount(0);
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'chat.unsubscribe' &&
            r.request.params.subscriptionId === lastLease &&
            r.response.result?.success,
        ),
      )
      .toBe(true);
    for (const r of requests.filter((r) =>
      ['agent.sendMessage', 'agent.stop', 'drafts.set', 'drafts.clear'].includes(r.method),
    )) {
      expect(r.params.agentId).toBe(agentId);
      if (r.params.workspaceId) expect(r.params.workspaceId).toBe(workspaceId);
    }
    expect(
      requests.filter((r) =>
        /^(file\.(write|delete)|workspace\.(create|archive)|agent\.create)/.test(r.method),
      ),
    ).toEqual([]);
    expect(inputEvents.length).toBeGreaterThan(0);
    expect(inputEvents.every((e) => e.trusted)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
    await writeFile(
      info.outputPath('wire-and-geometry.json'),
      JSON.stringify(
        {
          browserVersion: context.browser()?.version(),
          fixture,
          proof,
          before,
          after,
          history,
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
