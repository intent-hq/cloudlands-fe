import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('genuine registered JPEG retains exact daemon bytes and read-only viewing at both widths', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || workspaceId !== 'steep-gazelle') throw new Error('Recorded workspace required');
  const agentId = 'agent-cae39a6e-7291-4128-92df-0112dab4922c';
  const cases = [
    {
      messageId: '930596BC-E105-495E-B6F0-5E0965AACBAD',
      attachmentId: '801ddb67-9c3f-432f-a14c-309544c2d465',
      seq: 33,
      width: 1100,
    },
    {
      messageId: '930596BC-E105-495E-B6F0-5E0965AACBAD',
      attachmentId: '801ddb67-9c3f-432f-a14c-309544c2d465',
      seq: 33,
      width: 420,
    },
  ];
  expect(browser.version()).toBe('153.0.8010.12');
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
        mimeType: 'image/jpeg',
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
          type: (await fetch(node.currentSrc)).headers.get('content-type'),
          src: node.currentSrc,
          width: node.naturalWidth,
          height: node.naturalHeight,
          size: bytes.byteLength,
          hash,
        };
      });
      expect(decoded.type).toBe('image/jpeg');
      const registry = replies.find(
        ({ request, response }) =>
          request.method === 'file.getAttachmentInfo' &&
          request.params.workspaceId === workspaceId &&
          request.params.attachmentId === item.attachmentId &&
          response.result?.exists,
      )?.response.result;
      expect(registry).toMatchObject({
        attachmentId: item.attachmentId,
        mimeType: 'image/jpeg',
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
      expect(wireBytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');
      expect(decoded.size).toBe(7738);
      expect(decoded.hash).toBe('6cd85785a948a44437a8bfb9d548f4689cab6674aba51e1489ac1027fe0886a3');
      expect(registry.path).toBe('.intent/attachments/image-1791386016621-1.jpg');
      expect(decoded.hash).toBe(createHash('sha256').update(wireBytes).digest('hex'));
      expect([decoded.width, decoded.height]).toEqual(jpegDimensions(wireBytes));
      await page.evaluate(() => document.fonts.ready);
      const geometry = {
        row: await row.boundingBox(),
        card: await card.boundingBox(),
        image: await image.boundingBox(),
        opener: await image.locator('..').boundingBox(),
      };
      // Canonical sent-user composition: ChatMessage.svelte uses w-10 h-10;
      // the img owns its border inside the borderless 40px button.
      expect(geometry.opener.width).toBe(40);
      expect(geometry.opener.height).toBe(40);
      expect(geometry.image.width).toBe(40);
      expect(geometry.image.height).toBe(40);
      expect(
        await image.evaluate((node) => ({
          fit: getComputedStyle(node).objectFit,
          imageBorder: getComputedStyle(node).borderTopWidth,
          buttonBorder: getComputedStyle(node.parentElement).borderTopWidth,
        })),
      ).toEqual({ fit: 'cover', imageBorder: '1px', buttonBorder: '0px' });
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
    await info.attach('connected-jpeg-wire-and-geometry', {
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

// Read the actual JPEG frame marker rather than trusting DOM decode dimensions.
function jpegDimensions(bytes) {
  for (let offset = 2; offset + 9 <= bytes.length;) {
    expect(bytes[offset]).toBe(0xff);
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    expect(length).toBeGreaterThanOrEqual(2);
    expect(offset + 2 + length).toBeLessThanOrEqual(bytes.length);
    if ([0xc0, 0xc1, 0xc2].includes(marker))
      return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    offset += 2 + length;
  }
  throw new Error('Expected JPEG frame header missing');
}
