import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('owned local repository creates one workspace then a genuine first conversation', async ({
  page,
}, info) => {
  test.setTimeout(210_000);
  const base = process.env.REACT_BASE_URL;
  if (
    !base ||
    !process.env.ISOLATED_WORKSPACE_FIXTURE ||
    process.env.ISOLATED_CREATION_ALLOW_WRITE !== 'owned-test-daemon'
  )
    throw new Error('Owned isolated daemon proof and explicit mutation opt-in required');
  expect(new URL(base).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const fixture = JSON.parse(await readFile(process.env.ISOLATED_WORKSPACE_FIXTURE, 'utf8'));
  expect(fixture.passed).toBe(true);
  expect(fixture.daemon.pid).toBeGreaterThan(0);
  expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(210_000);
  expect(fixture.repository.daemonPath).toMatch(/^\/owned\/repositories\//);
  const errors = await observeErrors(page),
    requests = [],
    replies = [],
    pushes = [],
    events = [],
    geometry = [];
  await page.exposeBinding('__localCreationEvidence', (_source, event) => events.push(event));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    for (const type of ['click', 'keydown', 'input'])
      window.addEventListener(
        type,
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              '[role=dialog],[data-testid=workspace-agents],[data-testid=conversation-composer]',
            )
          )
            window.__localCreationEvidence({ type, key: event.key, trusted: event.isTrusted });
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
        const allowed = [
          'workspace.list',
          'workspace.get',
          'agent.list',
          'agent.get',
          'agent.getConversation',
        ];
        if (!allowed.includes(method)) throw new Error('Read-only corroboration only');
        const module = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!module) throw new Error('Canonical app transport missing');
        const { backendRequest } = await import(module.name);
        return backendRequest(method, params);
      },
      { method, params },
    );
  const resize = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('[data-slot=sidebar-gap]')).toHaveCount(width < 768 ? 0 : 1);
  };
  const capture = async (label, node) => {
    await page.evaluate(() => document.fonts.ready);
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
    await writeFile(info.outputPath(`${label}.png`), await stableLocatorScreenshot(page, node));
  };
  let workspaceId, agentId, workspace, history;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/workspaces`);
    const home = page.getByTestId('workspace-list');
    await expect(home).toBeVisible({ timeout: 30_000 });
    const initial = await rpc('workspace.list', {});
    expect(initial.workspaces).toHaveLength(0);
    const open = page.getByRole('button', { name: 'New workspace', exact: true });
    await expect(open).toBeEnabled();
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByTestId('workspace-local-create') });
    await expect(dialog).toBeVisible();
    const repo = dialog.getByLabel('Repository folder', { exact: true });
    const ref = dialog.getByLabel('Base branch or ref', { exact: true });
    await repo.fill(fixture.repository.daemonPath);
    await ref.fill(fixture.repository.baseRef);
    await capture('form-desktop', dialog);
    await resize(420);
    await capture('form-narrow', dialog);
    // The public folder picker reads the actual owned daemon directory.
    await dialog.getByRole('button', { name: 'Select folder', exact: true }).click();
    const picker = page
      .getByRole('dialog')
      .filter({ hasNot: page.getByTestId('workspace-local-create') });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Select "local-start"', exact: true }).click();
    await expect(picker).toHaveCount(0);
    expect(await repo.inputValue()).toBe(fixture.repository.daemonPath);
    await resize(1280);
    const create = dialog.getByRole('button', { name: 'Create workspace', exact: true });
    await expect(create).toBeEnabled();
    await create.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect
      .poll(
        () =>
          replies.filter(
            (r) => r.request.method === 'workspace.create' && r.response.result?.workspace?.id,
          ).length,
        { timeout: 130_000 },
      )
      .toBe(1);
    const created = replies.find(
      (r) => r.request.method === 'workspace.create' && r.response.result?.workspace?.id,
    );
    expect(requests.filter((r) => r.method === 'workspace.create')).toHaveLength(1);
    workspaceId = created.response.result.workspace.id;
    expect(created.request.params).toMatchObject({
      repositoryPath: fixture.repository.daemonPath,
      baseRef: fixture.repository.baseRef,
      setupScript: 'cd .',
    });
    expect(created.request.params.idempotencyKey).toBeTruthy();
    expect(created.request.params.skipIsolation).not.toBe(true);
    const requestIndex = requests.indexOf(created.request);
    const saved = replies
      .filter(
        (r) =>
          r.request.method === 'settings.update' &&
          r.response.result &&
          requests.indexOf(r.request) < requestIndex,
      )
      .some((r) =>
        r.request.params.changes.some(
          (c) =>
            c.path === 'workspaceInitializer.state' &&
            c.value.localCreation?.id === created.request.params.idempotencyKey,
        ),
      );
    expect(saved).toBe(true);
    await expect(page.getByTestId('workspace-overview')).toHaveAttribute(
      'data-workspace-id',
      workspaceId,
    );
    workspace = await rpc('workspace.get', { workspaceId });
    expect(workspace.workspace.id).toBe(workspaceId);
    expect(workspace.workspace.worktreePath).toMatch(/^\/owned\/workspaces\//);
    expect(workspace.workspace.worktreePath).not.toBe(fixture.repository.daemonPath);
    await page.reload();
    const agents = page.getByTestId('workspace-agents');
    await expect(agents).toBeVisible();
    const toggle = agents.getByRole('button', { name: 'Agents', exact: true });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const add = agents.getByRole('button', { name: 'Create new agent', exact: true });
    await expect(add).toBeEnabled();
    await add.click();
    await expect
      .poll(
        () =>
          replies.filter((r) => r.request.method === 'agent.create' && r.response.result?.agent?.id)
            .length,
        { timeout: 30_000 },
      )
      .toBe(1);
    const agent = replies.find(
      (r) => r.request.method === 'agent.create' && r.response.result?.agent?.id,
    );
    agentId = agent.response.result.agent.id;
    expect(agent.request.params).toMatchObject({
      workspaceId,
      provider: fixture.provider,
      model: fixture.model,
    });
    const conversation = page.getByTestId('workspace-conversation');
    await expect(conversation).toHaveAttribute('data-agent-id', agentId);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    const composer = page.getByTestId('conversation-composer');
    const token = `LOCAL_WORKSPACE_OK_${Date.now()}`;
    const text = composer.locator('textarea');
    await expect(text).toBeEnabled();
    await text.pressSequentially(
      `Reply with exactly ${token}. Do not use tools, read files, run commands, delegate, or change state.`,
    );
    await text.press('Enter');
    await expect(page.locator('[data-message-role=assistant]').last()).toContainText(token, {
      timeout: 90_000,
    });
    await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(pushes.some((p) => p.kind === 'delta' && JSON.stringify(p).includes(token))).toBe(true);
    history = await rpc('agent.getConversation', { workspaceId, agentId, limit: 50 });
    const user = history.messages.find(
      (m) => m.role === 'user' && JSON.stringify(m.contentBlocks).includes(token),
    );
    const assistant = history.messages.find(
      (m) => m.role === 'assistant' && JSON.stringify(m.contentBlocks).includes(token),
    );
    expect(assistant.seq).toBeGreaterThan(user.seq);
    await capture('conversation-desktop', conversation);
    await resize(420);
    await capture('conversation-narrow', conversation);
    await page.reload();
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect(page.locator(`[data-message-id="${assistant.id}"]`)).toContainText(token);
    const lease = replies
      .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
      .at(-1).response.result.subscriptionId;
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
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
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(home.locator(`[data-list-workspace="${workspaceId}"]`)).toBeVisible();
    expect((await rpc('workspace.list', {})).workspaces.map((w) => w.id)).toEqual([workspaceId]);
    expect(requests.filter((r) => r.method === 'agent.sendMessage')).toHaveLength(1);
    expect(
      requests.filter((r) =>
        /^(workspace\.(delete|archive)|agent\.(delete|retire)|file\.(write|delete))$/.test(
          r.method,
        ),
      ),
    ).toEqual([]);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.trusted)).toBe(true);
    expect(geometry.every((g) => g.scrollWidth <= g.viewport)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('workspace-creation-wire-and-geometry.json'),
      JSON.stringify(
        {
          fixture,
          workspaceId,
          agentId,
          workspace,
          history,
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

test('owned local creation retains drafts and retries a definite invalid base without duplicate success', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  if (
    !process.env.REACT_BASE_URL ||
    !process.env.ISOLATED_WORKSPACE_FIXTURE ||
    process.env.ISOLATED_CREATION_ALLOW_WRITE !== 'owned-test-daemon'
  )
    throw new Error('Owned isolated fixture and write opt-in required');
  const fixture = JSON.parse(await readFile(process.env.ISOLATED_WORKSPACE_FIXTURE, 'utf8'));
  expect(fixture.passed).toBe(true);
  expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(150_000);
  expect(fixture.repository.daemonPath).toMatch(/^\/owned\/repositories\//);
  const errors = await observeErrors(page),
    requests = [],
    replies = [],
    geometry = [];
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
      const request = pending.get(r.id);
      pending.delete(r.id);
      if (request) replies.push({ request, response: r });
    });
  });
  try {
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(`${process.env.REACT_BASE_URL}/workspaces`);
    await expect(page.getByTestId('workspace-list')).toBeVisible({ timeout: 30_000 });
    const open = page.getByRole('button', { name: 'New workspace', exact: true });
    await expect(open).toBeEnabled();
    await open.click();
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByTestId('workspace-local-create') });
    const repo = dialog.getByLabel('Repository folder', { exact: true });
    const ref = dialog.getByLabel('Base branch or ref', { exact: true });
    const create = dialog.getByRole('button', { name: 'Create workspace', exact: true });
    await repo.fill('/owned/repositories/missing');
    await ref.fill('main');
    await expect(create).toBeEnabled();
    await create.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(requests.filter((r) => r.method === 'workspace.create')).toHaveLength(0);
    await repo.fill(fixture.repository.daemonPath);
    await ref.fill('missing-native-base');
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'settings.update' &&
            r.response.result &&
            r.request.params.changes.some(
              (c) =>
                c.path === 'workspaceInitializer.state' &&
                c.value.compactFormState?.branch === 'missing-native-base',
            ),
        ),
      )
      .toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await expect(open).toBeEnabled();
    await open.click();
    await expect(repo).toHaveValue(fixture.repository.daemonPath);
    await expect(ref).toHaveValue('missing-native-base');
    await expect(create).toBeEnabled();
    await create.click();
    await expect
      .poll(() => replies.filter((r) => r.request.method === 'workspace.create').length, {
        timeout: 125_000,
      })
      .toBe(1);
    const rejected = replies.find((r) => r.request.method === 'workspace.create');
    expect(rejected.response.error.data.code).toBe('base-ref-unresolvable');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(create).toBeEnabled();
    geometry.push({ label: 'invalid-base-narrow', box: await dialog.boundingBox() });
    await writeFile(
      info.outputPath('invalid-base-narrow.png'),
      await stableLocatorScreenshot(page, dialog),
    );
    await ref.fill(fixture.repository.baseRef);
    await create.click();
    await expect
      .poll(
        () =>
          replies.filter(
            (r) => r.request.method === 'workspace.create' && r.response.result?.workspace?.id,
          ).length,
        { timeout: 125_000 },
      )
      .toBe(1);
    const accepted = replies.find(
      (r) => r.request.method === 'workspace.create' && r.response.result?.workspace?.id,
    );
    expect(requests.filter((r) => r.method === 'workspace.create')).toHaveLength(2);
    expect(accepted.request.params.idempotencyKey).not.toBe(rejected.request.params.idempotencyKey);
    await expect(page.getByTestId('workspace-overview')).toHaveAttribute(
      'data-workspace-id',
      accepted.response.result.workspace.id,
    );
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(
      page.locator(`[data-list-workspace="${accepted.response.result.workspace.id}"]`),
    ).toBeVisible();
    expect(
      requests.filter((r) =>
        /^(agent\.(create|sendMessage)|workspace\.(delete|archive)|file\.(write|delete))$/.test(
          r.method,
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('creation-retry-wire.json'),
      JSON.stringify({ fixture, requests, replies, geometry, errors }, null, 2),
    );
  }
});
