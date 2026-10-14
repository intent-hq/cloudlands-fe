import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Existing messages from the already saved sender/history receipts. No tools run here.
for (const receipt of [
  {
    messageId: '01a12cc6-e50f-769c-9c58-8d4fce8784d8',
    seq: 3,
    index: 14,
    protocol: 'exec-5c66a05c-ae60-4c0f-aa3c-e9b353edaa0c',
    count: 7,
    agents: [
      {
        id: 'agent-2c670a4a-067d-464f-ac60-fd00efd63010',
        name: 'React migration coordinator',
        status: 'active',
      },
      {
        id: 'agent-a8e45dca-f362-4dcb-b046-9904982bb7bf',
        name: 'Establish the React renderer and toolchain',
        status: 'active',
      },
      {
        id: 'agent-aea11e3a-ea57-4d6a-9fe6-eace4a49a927',
        name: 'Port foundational design system components',
        status: 'active',
      },
      {
        id: 'agent-cb98ed4d-bb23-4e10-8248-045f4fcb9538',
        name: 'Port design system pages and sandbox shell',
        status: 'active',
      },
      {
        id: 'agent-c047b786-1d6a-48ec-acb9-549212c9e084',
        name: 'Build independent visual parity and functional harness',
        status: 'active',
      },
      {
        id: 'agent-b2e5fb77-925f-4f80-b406-d5e057704cec',
        name: 'Map complete view migration and agent waves',
        status: 'active',
      },
      {
        id: 'agent-7ceb169a-cd60-4af6-b003-2a8c2cf94d58',
        name: 'Port motion and interactive collection behavior',
        status: 'active',
      },
    ],
    group: 'Working',
  },
  {
    messageId: '01a1362f-3717-70a6-b926-c8bb6c07c480',
    seq: 4333,
    index: 11,
    protocol: 'exec-fcd015c3-2d48-4429-8584-9b0ef23e4d6a',
    count: 2,
    agents: [
      {
        id: 'agent-b480b675-2762-4094-a096-3021bbe3445a',
        name: 'Align workspace-list regression fixtures with canonical admission',
        status: 'active',
      },
      {
        id: 'agent-e32164f0-26d6-4272-9fe4-f7347546f49a',
        name: 'Share canonical agent list reads through the real renderer transport',
        status: 'active',
      },
    ],
    group: null,
  },
])
  test(`saved ${receipt.count}-agent tool result opens existing conversations and releases readers`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
    if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
    const agentId = 'agent-2c670a4a-067d-464f-ac60-fd00efd63010';
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
    const conversation = page.getByTestId('workspace-conversation');
    const article = conversation.locator(`[data-message-id="${receipt.messageId}"]`);
    const row = article.locator(`[data-tool-use-id="${receipt.messageId}:${receipt.index}"]`);
    const trigger = row.getByTestId('tool-call-disclosure');
    const openGroup = async () => {
      if (receipt.group) {
        const group = article.getByRole('button', { name: receipt.group, exact: true });
        await expect(group).toHaveAttribute('aria-expanded', 'false');
        await group.click();
      }
    };
    try {
      await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
      await page.setViewportSize({ width: 1100, height: 850 });
      await page.goto(
        `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${agentId}&message=${receipt.messageId}`,
      );
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      const history = await page.evaluate(
        async ({ workspaceId, agentId, seq }) => {
          const resource = performance
            .getEntriesByType('resource')
            .find((r) =>
              new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'),
            );
          if (!resource) throw new Error('Real transport not observed');
          return (await import(resource.name)).backendRequest('agent.getConversation', {
            workspaceId,
            agentId,
            limit: 5,
            aroundIndex: seq,
            projection: 'slim',
          });
        },
        { workspaceId, agentId, seq: receipt.seq },
      );
      const message = history.messages.find((m) => m.id === receipt.messageId);
      expect(message).toBeTruthy();
      const call = message.contentBlocks.find(
        (b) => b.id === `${receipt.messageId}:${receipt.index}`,
      );
      const result = message.contentBlocks.find(
        (b) => b.type === 'tool_result' && b.tool_use_id === call.toolCallId,
      );
      expect(call.toolCallId).toBe(receipt.protocol);
      expect(result.outputTruncated).not.toBe(true);
      expect(result.output.error).toBeNull();
      const text = result.output.result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const agents = receipt.agents;
      for (const [index, agent] of agents.entries()) {
        expect(text).toContain(agent.name);
        expect(text).toContain(agent.status);
        expect(text.indexOf(agent.id)).toBeGreaterThan(
          index ? text.indexOf(agents[index - 1].id) : -1,
        );
      }
      expect(agents).toHaveLength(receipt.count);
      const canonical = await page.evaluate(
        async ({ call, result }) => {
          const resource = performance
            .getEntriesByType('resource')
            .find((r) =>
              new URL(r.name).pathname.endsWith('/components/chat/tool-result-parser.ts'),
            );
          if (!resource) throw new Error('Canonical parser not observed');
          return (await import(resource.name)).parseToolResult(
            call.name,
            call.input,
            result.output,
          );
        },
        { call, result },
      );
      expect(canonical.type).toBe('agent-list');
      expect(canonical.agents).toEqual(
        agents.map((a) => ({ agentId: a.id, name: a.name, status: a.status })),
      );
      await openGroup();
      const oldOrNew = article
        .locator(`[data-tool-block-id="${call.id}"], [data-tool-use-id="${call.id}"]`)
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
      await expect(row).toHaveAttribute('data-tool-call-id', receipt.protocol);
      await expect(article.locator(`[data-tool-block-id="${result.id}"]`)).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const body = row.locator('[data-workspace-agent-list-body]');
      await expect(body).toBeVisible();
      await expect(body.locator('[data-tool-result-agent]')).toHaveCount(receipt.count);
      expect(
        await body.locator('[data-tool-result-agent]').evaluateAll((els) =>
          els.map((el) => ({
            id: el.getAttribute('data-tool-result-agent'),
            name: el.querySelector('[data-slot="list-row-title"]').textContent,
            status: el.querySelector('[data-tool-agent-status]')?.textContent,
          })),
        ),
      ).toEqual(agents.map((a) => ({ id: a.id, name: a.name, status: a.status })));
      await page.setViewportSize({ width: 420, height: 900 });
      await row.scrollIntoViewIfNeeded();
      const geometry = await row.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        scrollWidth: el.scrollWidth,
      }));
      probes.push({ label: 'expanded', geometry });
      expect(geometry.width).toBeLessThanOrEqual(420);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(Math.ceil(geometry.width) + 1);
      await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
        if (png)
          await info.attach(`agent-list-${attempt}`, { body: png, contentType: 'image/png' });
      });
      const destination = agents[1];
      const item = body.getByRole('listitem').nth(1);
      await item.focus();
      await page.keyboard.press('Enter');
      await expect(conversation).toHaveAttribute('data-agent-id', destination.id);
      await expect(conversation).toHaveAttribute('data-ready', 'true');
      expect(new URL(page.url()).searchParams.has('message')).toBe(false);
      await expect(body).toHaveCount(0);
      await expect
        .poll(() =>
          replies.some(
            (r) =>
              r.request.method === 'chat.subscribe' &&
              r.request.params.agentId === destination.id &&
              r.response.result?.subscriptionId,
          ),
        )
        .toBe(true);
      await page.goBack();
      await expect(conversation).toHaveAttribute('data-agent-id', agentId);
      await expect(conversation).toHaveAttribute('data-ready', 'true');
      await openGroup();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(body).toBeVisible();
      await expect(body.locator('[data-tool-result-agent]')).toHaveCount(receipt.count);
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      const subscriptions = replies
        .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
        .map((r) => r.response.result.subscriptionId);
      expect(subscriptions.length).toBeGreaterThanOrEqual(3);
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
      expect(requests.filter((r) => r.method === 'agent.getMessageBlock')).toEqual([]);
      expect(
        requests.filter(({ method }) =>
          /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await info.attach('agent-list-wire-and-geometry', {
        body: JSON.stringify({ receipt, requests, replies, probes, errors }),
        contentType: 'application/json',
      });
    }
  });
