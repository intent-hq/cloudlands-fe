import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('isolated conversation model and effort control the next genuine reply', async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const {
    REACT_BASE_URL: base,
    ISOLATED_MODEL_FIXTURE: input,
    ISOLATED_MODEL_CHOICE: choice,
    ISOLATED_MODEL_LABEL: label,
    ISOLATED_MODEL_EFFORT: effort = 'medium',
  } = process.env;
  if (
    !base ||
    !input ||
    !choice ||
    !label ||
    process.env.ISOLATED_MODEL_ALLOW_SEND !== 'owned-benign-token'
  )
    throw new Error('Requires current owned daemon identity and an actual catalog model');
  const fixture = JSON.parse(await readFile(input, 'utf8'));
  expect(fixture.identityVerified).toBe(true);
  expect(Date.now()).toBeLessThan(Date.parse(fixture.expiresAt));
  expect(fixture.workspacePath).toMatch(/^\/owned\/workspaces\//);
  expect(new URL(base).hostname).toBe('127.0.0.1');
  expect(context.browser().version()).toBe('153.0.8010.12');
  const requests = [],
    replies = [],
    pushes = [],
    geometry = [],
    inputs = [];
  const errors = await observeErrors(page);
  await page.exposeBinding('__modelInput', (_, e) => inputs.push(e));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    for (const type of ['click', 'keydown', 'input'])
      window.addEventListener(
        type,
        (e) => window.__modelInput({ type, key: e.key, trusted: e.isTrusted }),
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
        if (!entry) throw new Error('Missing canonical transport');
        const { backendRequest } = await import(entry.name);
        return backendRequest(method, params);
      },
      { method, params },
    );
  const scope = { workspaceId: fixture.workspaceId, agentId: fixture.agentId };
  const host = page.getByTestId('conversation-model-controls');
  let before, after, conversation;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/workspaces/${fixture.workspaceId}?agent=${fixture.agentId}`);
    await page
      .getByTestId('conversation-composer')
      .locator('textarea:not([disabled])')
      .waitFor({ timeout: 30_000 });
    before = await rpc('agent.get', scope);
    expect(before.agent.model).not.toBe(choice);
    const catalog = await rpc('models.list', {
      workspaceId: fixture.workspaceId,
      providerId: 'codex',
    });
    expect(catalog.models.find((m) => m.id === choice)?.effortLevels).toContain(effort);
    await host.getByRole('button').first().click();
    await page.getByRole('option', { name: label, exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Switch model?', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(requests.filter((r) => r.method === 'agent.setModel')).toHaveLength(0);
    await host.getByRole('button').first().focus();
    await host.getByRole('button').first().press('Enter');
    await page.getByRole('option', { name: label, exact: true }).click();
    await confirm.getByRole('button', { name: 'Switch model', exact: true }).focus();
    await confirm.getByRole('button', { name: 'Switch model', exact: true }).press('Enter');
    await expect.poll(async () => (await rpc('agent.get', scope)).agent.model).toBe(choice);
    await expect(host).toContainText(label);
    await host.getByRole('button').first().click();
    await page.getByRole('combobox', { name: /Reasoning effort/ }).click();
    await page
      .getByRole('option', { name: effort[0].toUpperCase() + effort.slice(1), exact: true })
      .click();
    await expect
      .poll(async () => (await rpc('agent.get', scope)).agent.reasoningEffort)
      .toBe(effort);
    await page.keyboard.press('Escape');
    await host.getByRole('button').first().click();
    await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Providers', exact: true });
    await expect(settings).toContainText('Configure providers in the desktop app');
    await expect(settings).toContainText('OpenAI Codex');
    for (const width of [1280, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await settings.scrollIntoViewIfNeeded();
      geometry.push({ phase: 'settings', width, box: await settings.boundingBox() });
      await writeFile(
        info.outputPath(`settings-${width}.png`),
        await stableLocatorScreenshot(page, settings),
      );
    }
    await page.keyboard.press('Escape');
    const composer = page.getByTestId('conversation-composer');
    const token = `MODEL_CHOICE_NATIVE_${Date.now()}`;
    await composer
      .locator('textarea')
      .fill(
        `Reply with exactly ${token}. Do not use tools, read files, run commands, delegate, or change any state.`,
      );
    await composer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(
        async () => {
          conversation = await rpc('agent.getConversation', { ...scope, limit: 30 });
          return (
            JSON.stringify(conversation).includes(token) &&
            JSON.stringify(conversation).includes('assistant')
          );
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          const a = (await rpc('agent.get', scope)).agent;
          return !a.isResponding && !a.turnInFlight;
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    after = await rpc('agent.get', scope);
    conversation = await rpc('agent.getConversation', { ...scope, limit: 30 });
    expect(after.agent).toMatchObject({
      model: choice,
      reasoningEffort: effort,
      lastAgentResponse: token,
    });
    expect(requests.filter((r) => r.method === 'agent.sendMessage')).toHaveLength(1);
    expect(requests.filter((r) => r.method === 'agent.setModel')).toHaveLength(1);
    expect(requests.filter((r) => r.method === 'settings.update')).toHaveLength(0);
    await page.reload();
    await expect(host).toContainText(label, { timeout: 30_000 });
    expect((await rpc('agent.get', scope)).agent).toMatchObject({
      model: choice,
      reasoningEffort: effort,
    });
    for (const width of [1280, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await composer.scrollIntoViewIfNeeded();
      geometry.push({ phase: 'composer', width, box: await composer.boundingBox() });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await writeFile(
        info.outputPath(`composer-${width}.png`),
        await stableLocatorScreenshot(page, composer),
      );
    }
    await page.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(host).toHaveCount(0);
    await expect
      .poll(() => replies.some((r) => r.request.method === 'chat.unsubscribe' && r.response.result))
      .toBe(true);
    await page.goBack();
    await expect(host).toContainText(label, { timeout: 30_000 });
    expect((await rpc('agent.get', scope)).agent.reasoningEffort).toBe(effort);
    expect(inputs.every((e) => e.trusted)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('wire-and-geometry.json'),
      JSON.stringify(
        { fixture, before, after, conversation, requests, replies, pushes, geometry, inputs },
        null,
        2,
      ),
    );
    await writeFile(info.outputPath('browser-errors.json'), JSON.stringify(errors, null, 2));
  }
});
