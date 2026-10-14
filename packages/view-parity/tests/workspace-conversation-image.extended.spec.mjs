import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('genuine attachment PNGs retain daemon bytes and release their read-only viewer', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || workspaceId !== 'feedback-design') throw new Error('Recorded workspace required');
  const agentId = 'agent-81676f68-a86c-40df-ad67-212020fb2e47';
  const cases = [
    {
      messageId: '653e2ebb-48e9-4801-92d7-d31d65831837',
      attachmentId: '8ebdafc3-2fcc-4755-8ba7-8df2f456ea71',
      seq: 114,
      width: 1100,
    },
    {
      messageId: 'user-msg-23f5ca04-449a-4f8a-b639-3696d231fca3',
      attachmentId: '29ec51a9-d68a-489e-8c22-04d5b940fdd3',
      seq: 20,
      width: 420,
    },
  ];
  const errors = await observeErrors(page);
  const requests = [],
    replies = [],
    evidence = [],
    failures = [],
    activations = [];
  page.on('requestfailed', (request) =>
    failures.push({ url: request.url(), failure: request.failure() }),
  );
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
  await page.exposeFunction('observeImageActivation', (event) => activations.push(event));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    globalThis.imageObjectUrlObservations = [];
    URL.createObjectURL = (object) => {
      const url = create(object);
      globalThis.imageObjectUrlObservations.push({
        kind: 'create',
        url,
        type: object.type,
        size: object.size,
      });
      return url;
    };
    URL.revokeObjectURL = (url) => {
      globalThis.imageObjectUrlObservations.push({ kind: 'revoke', url });
      revoke(url);
    };
  });
  const conversation = page.getByTestId('workspace-conversation');
  try {
    for (const item of cases) {
      await page.setViewportSize({ width: item.width, height: 850 });
      await page.goto(
        `${base}/workspaces/${workspaceId}?agent=${agentId}&message=${item.messageId}`,
      );
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      const row = conversation.locator(`[data-message-id="${item.messageId}"]`);
      await expect(row).toBeFocused();
      const actual = await page.evaluate(
        async ({ workspaceId, agentId, messageId }) => {
          const resource = performance
            .getEntriesByType('resource')
            .find((r) =>
              new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'),
            );
          if (!resource) throw new Error('Canonical transport not observed');
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
        { workspaceId, agentId, messageId: item.messageId },
      );
      expect(actual).toMatchObject({ id: item.messageId, role: 'user', seq: item.seq });
      expect(actual.contentBlocks[1]).toMatchObject({
        type: 'image',
        attachmentId: item.attachmentId,
        mimeType: 'image/png',
      });
      const card = row.locator(`[data-attachment-id="${item.attachmentId}"]`);
      const image = card.locator('img');
      await expect(image).toHaveCount(1);
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0))
        .toBe(true);
      const decoded = await image.evaluate(async (node) => {
        const bytes = await (await fetch(node.currentSrc)).arrayBuffer();
        const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
        return {
          src: node.currentSrc,
          width: node.naturalWidth,
          height: node.naturalHeight,
          size: bytes.byteLength,
          hash,
        };
      });
      const registry = replies.find(
        ({ request, response }) =>
          request.method === 'file.getAttachmentInfo' &&
          request.params.workspaceId === workspaceId &&
          request.params.attachmentId === item.attachmentId &&
          response.result?.exists,
      )?.response.result;
      expect(registry).toMatchObject({
        attachmentId: item.attachmentId,
        mimeType: 'image/png',
        size: decoded.size,
        exists: true,
      });
      const chunks = replies.filter(
        ({ request, response }) =>
          request.method === 'file.readChunk' &&
          request.params.workspaceId === workspaceId &&
          request.params.path === registry.path &&
          response.result?.content,
      );
      const first = chunks.findIndex(({ request }) => request.params.offset === 0);
      let offset = 0;
      const bytes = [];
      for (const { request, response } of chunks.slice(first)) {
        expect(request.params.offset).toBe(offset);
        const data = Buffer.from(response.result.content, 'base64');
        expect(data.length).toBe(response.result.bytesRead);
        expect(response.result.size).toBe(registry.size);
        bytes.push(data);
        offset += data.length;
        if (offset === registry.size) break;
      }
      const wireBytes = Buffer.concat(bytes);
      expect(wireBytes.length).toBe(registry.size);
      expect(wireBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(decoded.hash).toBe(createHash('sha256').update(wireBytes).digest('hex'));
      expect([decoded.width, decoded.height]).toEqual([
        wireBytes.readUInt32BE(16),
        wireBytes.readUInt32BE(20),
      ]);
      await page.evaluate(() => document.fonts.ready);
      const geometry = {
        row: await row.boundingBox(),
        card: await card.boundingBox(),
        image: await image.boundingBox(),
      };
      await stableLocatorScreenshot(page, card, async ({ png, attempt }) => {
        if (png)
          await info.attach(`image-${item.width}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      });
      const opener = card.getByRole('button', {
        name: `View ${registry.fileName} full size`,
        exact: true,
      });
      await opener.evaluate((node) =>
        node.addEventListener(
          'click',
          (event) => globalThis.observeImageActivation({ trusted: event.isTrusted }),
          { once: true },
        ),
      );
      await opener.click();
      const full = page.locator('[data-media-lightbox-content]');
      await expect(full).toBeVisible();
      await expect(full).toHaveAttribute('src', decoded.src);
      await expect
        .poll(() => full.evaluate((node) => node.complete && node.naturalWidth))
        .toBe(decoded.width);
      const bounds = await full.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(item.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(850);
      await stableLocatorScreenshot(page, full, async ({ png, attempt }) => {
        if (png)
          await info.attach(`lightbox-${item.width}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      });
      await page.keyboard.press('Escape');
      await expect(full).toHaveCount(0);
      await expect(opener).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(full).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(full).toHaveCount(0);
      await expect(opener).toBeFocused();
      const leases = replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' &&
            request.params.agentId === agentId &&
            response.result?.subscriptionId,
        )
        .map(({ response }) => response.result.subscriptionId);
      await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
      await expect(conversation).toHaveCount(0);
      for (const lease of leases)
        await expect
          .poll(() =>
            replies.some(
              ({ request, response }) =>
                request.method === 'chat.unsubscribe' &&
                request.params.subscriptionId === lease &&
                response.result?.success === true,
            ),
          )
          .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(
            (url) =>
              globalThis.imageObjectUrlObservations.some(
                (e) => e.kind === 'revoke' && e.url === url,
              ),
            decoded.src,
          ),
        )
        .toBe(true);
      evidence.push({
        ...item,
        actual,
        registry,
        decoded,
        geometry,
        lightbox: bounds,
        objects: await page.evaluate(() => globalThis.imageObjectUrlObservations),
        leases,
      });
    }
    expect(activations).toEqual([{ trusted: true }, { trusted: true }]);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
  } finally {
    await info.attach('connected-image-wire-and-geometry', {
      body: JSON.stringify({
        browser: browser.version(),
        requests,
        replies,
        evidence,
        errors,
        failures,
        activations,
      }),
      contentType: 'application/json',
    });
  }
});
