import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('persisted workspace confirmations pair by protocol identity and disclose without execution', async ({
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
  const messageId = '01a12cc4-430a-75d2-aa67-72cebc057ba8';
  const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${agentId}&message=${messageId}`;
  const conversation = page.getByTestId('workspace-conversation');
  const read = (method, params) =>
    page.evaluate(
      async ({ method, params }) => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!resource) throw new Error('Real transport not observed');
        return (await import(resource.name)).backendRequest(method, params);
      },
      { method, params },
    );
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.goto(url);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    const history = await read('agent.getConversation', {
      workspaceId,
      agentId,
      limit: 5,
      aroundIndex: 0,
      projection: 'slim',
    });
    const message = history.messages.find((m) => m.id === messageId);
    expect(message).toBeTruthy();
    const article = conversation.locator(`[data-message-id="${messageId}"]`);
    const reasoning = article.getByRole('button', { name: 'Reasoning', exact: true });
    await reasoning.click();
    await expect(reasoning).toHaveAttribute('aria-expanded', 'true');
    const oldOrNew = article
      .locator(`[data-tool-block-id="${messageId}:2"], [data-tool-use-id="${messageId}:2"]`)
      .first();
    await oldOrNew.scrollIntoViewIfNeeded();
    probes.push({
      label: 'initial',
      geometry: await oldOrNew.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        text: el.textContent,
      })),
    });
    await info.attach('initial-presentation', {
      body: await oldOrNew.screenshot(),
      contentType: 'image/png',
    });
    for (const index of [2, 26]) {
      const call = message.contentBlocks.find((b) => b.id === `${messageId}:${index}`);
      const result = message.contentBlocks.find(
        (b) => b.type === 'tool_result' && b.tool_use_id === call.toolCallId,
      );
      expect(call.name).toBe('workspace_api');
      expect(result).toBeTruthy();
      const row = article.locator(`[data-tool-use-id="${call.id}"]`);
      await expect(row).toHaveAttribute('data-tool-call-id', call.toolCallId);
      const trigger = row.getByTestId('tool-call-disclosure');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(article.locator(`[data-tool-block-id="${result.id}"]`)).toHaveCount(0);
      const before = requests.filter((r) => r.method === 'agent.getMessageBlock').length;
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const body = row.locator('[data-workspace-confirmation-body]');
      await expect(body).toBeVisible();
      await expect(body).toHaveAttribute(
        'data-hydration',
        result.outputTruncated ? 'loaded' : 'complete',
      );
      const reads = replies
        .filter((r) => r.request.method === 'agent.getMessageBlock')
        .slice(before);
      expect(reads).toHaveLength(result.outputTruncated ? 1 : 0);
      const full = result.outputTruncated ? reads[0].response.result.block : result;
      if (result.outputTruncated) {
        expect(reads[0].request.params).toEqual({
          workspaceId,
          agentId,
          messageId,
          blockId: result.id,
        });
        expect((await read('agent.getMessageBlock', reads[0].request.params)).block).toEqual(full);
      }
      const source = await page.evaluate(
        async ({ call, full }) => {
          const resources = performance.getEntriesByType('resource');
          const moduleUrl = (name) => {
            const resource = resources.find((r) =>
              new URL(r.name).pathname.endsWith(`/components/chat/${name}.ts`),
            );
            if (!resource) throw new Error(`Canonical source module not observed: ${name}`);
            return resource.name;
          };
          const { parseToolResult } = await import(moduleUrl('tool-result-parser'));
          const { sanitizeToolPayload } = await import(moduleUrl('tool-display-model'));
          const parsed = parseToolResult(call.name, call.input, full.output);
          return {
            type: parsed.type,
            content: parsed.content ?? null,
            raw: JSON.stringify(sanitizeToolPayload(full.output), null, 2),
          };
        },
        { call, full },
      );
      expect(source.type).toBe('confirmation');
      // The real provider envelope is corroborated independently of the parser.
      // Text must be visible; a raw-envelope fallback is not equivalent.
      expect(Object.keys(full.output).sort()).toEqual(['error', 'result']);
      expect(full.output.error).toBeNull();
      expect(Object.keys(full.output.result).sort()).toEqual([
        '_meta',
        'content',
        'structuredContent',
      ]);
      const providerText = full.output.result.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
      expect(providerText.length).toBeGreaterThan(0);
      expect(source.content).toBe(providerText);
      if (source.content)
        await expect(body.locator('[data-tool-confirmation-text]')).toHaveText(source.content);
      else
        await expect(body.locator('[data-tool-detail-section="output"] pre')).toHaveText(
          source.raw,
        );
      await expect(trigger).toHaveAccessibleName(call.input.summary);
      const count = requests.filter((r) => r.method === 'agent.getMessageBlock').length;
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(body).toBeVisible();
      expect(requests.filter((r) => r.method === 'agent.getMessageBlock')).toHaveLength(count);
      await page.setViewportSize({ width: 420, height: 900 });
      await row.scrollIntoViewIfNeeded();
      probes.push({
        label: `expanded-${index}`,
        geometry: await row.evaluate((el) => ({
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
          scrollWidth: el.scrollWidth,
          viewport: globalThis.innerWidth,
        })),
      });
      const probe = probes.at(-1).geometry;
      expect(probe.width).toBeLessThanOrEqual(420);
      expect(probe.scrollWidth).toBeLessThanOrEqual(Math.ceil(probe.width) + 1);
      await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
        if (png)
          await info.attach(`confirmation-${index}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      });
      await trigger.click();
      await page.setViewportSize({ width: 1100, height: 850 });
    }
    // Another family and its result remain independently available.
    await expect(article.locator(`[data-tool-block-id="${messageId}:19"]`)).toHaveCount(1);
    await expect(article.locator(`[data-tool-block-id="${messageId}:20"]`)).toHaveCount(1);
    await expect(article.locator(`[data-tool-block-id="${messageId}:4"]`)).toHaveCount(1);
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    const subscriptions = replies
      .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
      .map((r) => r.response.result.subscriptionId);
    await expect
      .poll(() =>
        subscriptions.every((id) =>
          replies.some(
            (r) =>
              r.request.method === 'chat.unsubscribe' &&
              r.request.params.subscriptionId === id &&
              r.response.result?.success === true,
          ),
        ),
      )
      .toBe(true);
    const readsBeforeReturn = requests.filter((r) => r.method === 'agent.getMessageBlock').length;
    await page.goBack();
    await expect(conversation).toHaveAttribute('data-ready', 'true');
    await expect(reasoning).toHaveAttribute('aria-expanded', 'false');
    await reasoning.click();
    await expect(
      article.locator(`[data-tool-use-id="${messageId}:2"]`).getByTestId('tool-call-disclosure'),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(requests.filter((r) => r.method === 'agent.getMessageBlock')).toHaveLength(
      readsBeforeReturn,
    );
    const returnedSubscription = replies
      .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
      .at(-1).response.result.subscriptionId;
    expect(subscriptions).not.toContain(returnedSubscription);
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'chat.unsubscribe' &&
            r.request.params.subscriptionId === returnedSubscription &&
            r.response.result?.success === true,
        ),
      )
      .toBe(true);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('confirmation-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});
