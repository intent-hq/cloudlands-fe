import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Existing messages from the already saved sender/history receipts. No tools run here.
for (const receipt of [
  {
    messageId: '01a12cc6-e50f-769c-9c58-8d4fce8784d8',
    index: 41,
    seq: 3,
    group: 'Working',
    protocol: 'exec-d0e0c7a5-3611-4f05-88b1-8a3323646a71',
    content:
      '[6]{id,status,title}:\n  "c2eb0164-3e21-4125-b839-72f1223539af","in-progress",Establish the React renderer and toolchain\n  "a4919ae0-9678-4330-9642-bb9ef8f69689","in-progress",Port foundational design system components\n  "2a61ab61-676b-4cc1-9dd8-346459b326b6","in-progress",Port design system pages and sandbox shell\n  "e4b92560-43b5-4410-a5f0-0eabb9b84fb5","in-progress",Build independent visual parity and functional harness\n  "9bcbbfd0-2f97-4de9-a118-0423d03786e9","in-progress",Map complete view migration and agent waves\n  "cdbc72cb-d2e1-4f69-aeaa-5ac8417ca345","in-progress",Port motion and interactive collection behavior',
  },
  {
    messageId: '01a1362f-3717-70a6-b926-c8bb6c07c480',
    index: 13,
    seq: 4333,
    group: null,
    protocol: 'exec-56c43cc8-b12d-4ff7-84c2-c0b64472e9a1',
    content:
      'turnInFlight: true\ntext[1]: "I\u2019m still paused. I\u2019ll cancel the remaining completion watches so queued updates don\u2019t keep waking this agent.\\n"',
  },
])
  test(`saved read-result ${receipt.index} keeps canonical content and releases readers`, async ({
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
      expect(text).toBe(receipt.content);
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
      expect(canonical).toEqual({ type: 'note-view', content: receipt.content });
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
      const body = row.locator('[data-workspace-read-content]');
      await expect(body).toBeVisible();
      const normalized = (s) => s.replace(/\s+/g, ' ').trim();
      await expect
        .poll(async () => normalized(await body.textContent()))
        .toBe(normalized(receipt.content));
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
          await info.attach(`read-content-${attempt}`, { body: png, contentType: 'image/png' });
      });
      await trigger.click();
      await expect(body).toHaveCount(0);
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(body).toBeVisible();
      await expect
        .poll(async () => normalized(await body.textContent()))
        .toBe(normalized(receipt.content));
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      await page.goBack();
      await expect(conversation).toHaveAttribute('data-agent-id', agentId);
      await expect(conversation).toHaveAttribute('data-ready', 'true');
      await openGroup();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(body).toBeVisible();
      await expect
        .poll(async () => normalized(await body.textContent()))
        .toBe(normalized(receipt.content));
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      const subscriptions = replies
        .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
        .map((r) => r.response.result.subscriptionId);
      expect(subscriptions.length).toBeGreaterThanOrEqual(2);
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
      await info.attach('read-content-wire-and-geometry', {
        body: JSON.stringify({ receipt, requests, replies, probes, errors }),
        contentType: 'application/json',
      });
    }
  });
