import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Mutating acceptance is confined to a freshly provisioned owned daemon/workspace.
test('isolated empty workspace creates one real agent and sends its first message', async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const {
    REACT_BASE_URL: base,
    ISOLATED_CREATION_FIXTURE: fixturePath,
    ISOLATED_CREATION_SOCKET_PROOF: proofPath,
  } = process.env;
  if (
    !base ||
    !fixturePath ||
    !proofPath ||
    process.env.ISOLATED_CREATION_ALLOW_WRITE !== 'owned-test-daemon'
  )
    throw new Error('Owned isolated creation fixture, socket proof and write opt-in required');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  expect(proof.passed).toBe(true);
  expect(proof.peerPid).toBe(fixture.daemon.pid);
  expect(proof.socket).toBe(fixture.hostSocket);
  expect(Date.parse(proof.expiresAt) - Date.now()).toBeGreaterThan(180_000);
  expect(fixture.workspacePath).toMatch(/^\/owned\/workspaces\//);
  expect(proof.workspace.result.workspace.id).toBe(fixture.workspaceId);
  expect(proof.workspace.result.workspace.worktreePath).toBe(fixture.workspacePath);
  expect(new URL(base).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const errors = await observeErrors(page),
    requests = [],
    replies = [],
    pushes = [],
    events = [],
    geometry = [];
  await page.exposeBinding('__creationInputEvidence', (_source, event) => events.push(event));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    for (const type of ['click', 'keydown', 'input'])
      window.addEventListener(
        type,
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              '[data-testid=workspace-agent-creation],[data-testid=conversation-composer]',
            )
          )
            window.__creationInputEvidence({ type, key: event.key, trusted: event.isTrusted });
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
        if (!module) throw new Error('Actual transport missing');
        const { backendRequest } = await import(module.name);
        return backendRequest(method, params);
      },
      { method, params },
    );
  const { workspaceId } = fixture;
  const resize = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    // The responsive sidebar changes the DOM path of the focused control.
    // Observe that real layout transition before the strict capture guard starts.
    await expect(page.locator('[data-slot=sidebar-gap]')).toHaveCount(width < 768 ? 0 : 1);
  };
  const agents = page.getByTestId('workspace-agents'),
    conversation = page.getByTestId('workspace-conversation'),
    composer = page.getByTestId('conversation-composer');
  const create = agents.getByRole('button', { name: 'Create new agent', exact: true });
  const showAgents = async () => {
    const toggle = agents.getByRole('button', { name: 'Agents', exact: true });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  };
  const measure = async (label, node) =>
    geometry.push({
      label,
      ...(await node.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      })),
    });
  let agentId, actual, history, finalList;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/workspaces/${workspaceId}`);
    await expect(agents).toBeVisible({ timeout: 30_000 });
    await showAgents();
    await expect(create).toBeEnabled({ timeout: 30_000 });
    const before = await rpc('agent.list', { workspaceId, scope: 'topLevel' });
    expect(before.agents).toEqual([]);
    await expect(agents.locator('[data-workspace-agent]')).toHaveCount(0);
    await expect(agents.locator('[data-state-kind=empty]')).toBeVisible();
    await agents.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)),
      );
    });
    await measure('empty-desktop', agents);
    await writeFile(
      info.outputPath('empty-desktop.png'),
      await stableLocatorScreenshot(page, agents),
    );
    await resize(420);
    await measure('empty-narrow', agents);
    await writeFile(
      info.outputPath('empty-narrow.png'),
      await stableLocatorScreenshot(page, agents),
    );
    await resize(1280);
    await create.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect
      .poll(
        () =>
          replies.filter((r) => r.request.method === 'agent.create' && r.response.result?.agent?.id)
            .length,
        { timeout: 30_000 },
      )
      .toBe(1);
    expect(requests.filter((r) => r.method === 'agent.create')).toHaveLength(1);
    const created = replies.find((r) => r.request.method === 'agent.create');
    agentId = created.response.result.agent.id;
    expect(created.request.params.workspaceId).toBe(workspaceId);
    expect(created.request.params.idempotencyKey).toBeTruthy();
    expect(created.request.params.agentId).toBeUndefined();
    expect(created.request.params.provider).toBe(fixture.provider);
    expect(created.request.params.model).toBe(fixture.model);
    await expect(conversation).toHaveAttribute('data-agent-id', agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    actual = await rpc('agent.get', { workspaceId, agentId });
    expect(actual.agent.id).toBe(agentId);
    expect(actual.agent.workspaceId).toBe(workspaceId);
    expect(actual.agent.provider).toBe(fixture.provider);
    expect(actual.agent.model).toBe(fixture.model);
    const textarea = composer.locator('textarea');
    await expect(textarea).toBeEnabled();
    const token = `CREATED_NATIVE_${Date.now()}`;
    await textarea.pressSequentially(
      `Reply with exactly ${token}. Do not use tools, read files, run commands, delegate, or change any state.`,
    );
    await textarea.press('Enter');
    await expect(page.locator('[data-message-role=assistant]').last()).toContainText(token, {
      timeout: 90_000,
    });
    await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(requests.filter((r) => r.method === 'agent.sendMessage')).toHaveLength(1);
    expect(pushes.some((p) => p.kind === 'delta' && JSON.stringify(p).includes(token))).toBe(true);
    history = await rpc('agent.getConversation', { workspaceId, agentId, limit: 50 });
    const user = history.messages.find(
      (m) => m.role === 'user' && JSON.stringify(m.contentBlocks).includes(token),
    );
    const assistant = history.messages.find(
      (m) => m.role === 'assistant' && JSON.stringify(m.contentBlocks).includes(token),
    );
    expect(user.id).toBeTruthy();
    expect(assistant.seq).toBeGreaterThan(user.seq);
    await measure('conversation-desktop', conversation);
    await writeFile(
      info.outputPath('conversation-desktop.png'),
      await stableLocatorScreenshot(page, conversation),
    );
    await page.reload();
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect(page.locator(`[data-message-id="${assistant.id}"]`)).toContainText(token);
    finalList = await rpc('agent.list', { workspaceId, scope: 'topLevel' });
    expect(finalList.agents.map((a) => a.id)).toEqual([agentId]);
    await resize(420);
    await measure('conversation-narrow', conversation);
    await writeFile(
      info.outputPath('conversation-narrow.png'),
      await stableLocatorScreenshot(page, conversation),
    );
    const lease = replies
      .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
      .at(-1).response.result.subscriptionId;
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'chat.unsubscribe' &&
            r.request.params.subscriptionId === lease &&
            r.response.result?.success,
        ),
      )
      .toBe(true);
    await showAgents();
    const row = agents.locator(`[data-workspace-agent="${agentId}"]`).locator('..');
    await row.click();
    await expect(conversation).toHaveAttribute('data-agent-id', agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(conversation).toHaveCount(0);
    expect(requests.filter((r) => r.method === 'agent.create')).toHaveLength(1);
    expect(
      requests.filter((r) =>
        /^(agent\.(delete|retire|delegate)|workspace\.(create|archive)|file\.(write|delete))$/.test(
          r.method,
        ),
      ),
    ).toEqual([]);
    for (const r of requests.filter((r) =>
      ['agent.create', 'agent.sendMessage', 'drafts.set', 'drafts.clear'].includes(r.method),
    )) {
      if (r.params.workspaceId) expect(r.params.workspaceId).toBe(workspaceId);
      if (r.params.agentId) expect(r.params.agentId).toBe(agentId);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.trusted)).toBe(true);
    expect(geometry.every((g) => g.scrollWidth <= g.viewport)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('creation-wire-and-geometry.json'),
      JSON.stringify(
        {
          browserVersion: context.browser()?.version(),
          fixture,
          proof,
          agentId,
          actual,
          history,
          finalList,
          requests,
          replies,
          pushes,
          events,
          geometry,
          errors,
        },
        null,
        2,
      ),
    );
  }
});
