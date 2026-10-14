import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// This genuine recording has an HEVC video track and AAC audio. The pinned Linux
// browser decodes audio only. This tests the explicit unavailable disposition;
// it does not substitute a different asset or claim video playback acceptance.
test('genuine HEVC attachment retains exact bytes and an honest unavailable preview', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || workspaceId !== 'cool-sheep') throw new Error('Recorded workspace required');
  expect(browser.version()).toBe('153.0.8010.12');
  const agentId = 'agent-18b5c947-dab7-4120-9309-9afdfc25092c';
  const messageId = '6B259012-410D-4664-901B-C7266B2E3E1C';
  const attachmentId = 'e82cf108-8103-49cb-b65c-f6d413a33d9c';
  const errors = await observeErrors(page);
  const session = await page.context().newCDPSession(page);
  const mediaCancellations = [],
    networkRequests = new Map();
  session.on('Network.requestWillBeSent', (event) =>
    networkRequests.set(event.requestId, event.request.url),
  );
  session.on('Network.loadingFailed', (event) =>
    mediaCancellations.push({ ...event, url: networkRequests.get(event.requestId) }),
  );
  await session.send('Network.enable');
  const requests = [],
    replies = [],
    failures = [],
    events = [],
    evidence = [];
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
      const r = JSON.parse(String(payload)),
        request = pending.get(r.id);
      pending.delete(r.id);
      if (request) replies.push({ request, response: r });
    });
  });
  await page.exposeFunction('observeConnectedVideo', (event) => events.push(event));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    globalThis.videoObjectUrlObservations = [];
    URL.createObjectURL = (object) => {
      const url = create(object);
      globalThis.videoObjectUrlObservations.push({
        kind: 'create',
        url,
        type: object.type,
        size: object.size,
      });
      return url;
    };
    URL.revokeObjectURL = (url) => {
      globalThis.videoObjectUrlObservations.push({ kind: 'revoke', url });
      revoke(url);
    };
    for (const type of ['loadedmetadata', 'loadeddata', 'error', 'play', 'pause']) {
      document.addEventListener(
        type,
        (event) => {
          const node = event.target;
          if (!(node instanceof globalThis.HTMLVideoElement)) return;
          globalThis.observeConnectedVideo({
            type,
            trusted: event.isTrusted,
            src: node.currentSrc,
            width: node.videoWidth,
            height: node.videoHeight,
            duration: node.duration,
            ready: node.readyState,
            paused: node.paused,
            time: node.currentTime,
            played: node.played.length,
            error: node.error?.code ?? null,
          });
        },
        true,
      );
    }
  });
  try {
    for (const width of [1100, 420]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}&message=${messageId}`);
      const conversation = page.getByTestId('workspace-conversation');
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      const row = conversation.locator(`[data-message-id="${messageId}"]`);
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
        { workspaceId, agentId, messageId },
      );
      expect(actual).toMatchObject({ id: messageId, role: 'user', seq: 0 });
      expect(actual.contentBlocks[1]).toMatchObject({
        type: 'file',
        attachmentId,
        mimeType: 'video/mp4',
        size: 5111617,
      });
      const card = row.locator(`[data-attachment-id="${attachmentId}"]`);
      const fallback = card.getByTestId('media-unavailable');
      await expect(fallback).toBeVisible();
      await expect(fallback).toHaveAttribute('data-reason', 'load-failed');
      await expect(fallback).toContainText(actual.contentBlocks[1].fileName);
      await expect(card.locator('video')).toHaveCount(0);
      await expect(card.getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          document.createElement('video').canPlayType('video/mp4; codecs="hvc1"'),
        ),
      ).toBe('');
      const object = await page.evaluate(() =>
        globalThis.videoObjectUrlObservations.find(
          (e) => e.kind === 'create' && e.type === 'video/mp4',
        ),
      );
      expect(object).toMatchObject({ type: 'video/mp4', size: 5111617 });
      const loaded = events.find((e) => e.type === 'loadeddata' && e.src === object.url);
      expect(loaded).toMatchObject({
        trusted: true,
        width: 0,
        height: 0,
        paused: true,
        time: 0,
        played: 0,
        error: null,
      });
      expect(loaded.duration).toBeCloseTo(5.151667, 5);
      const registry = replies.find(
        ({ request, response }) =>
          request.method === 'file.getAttachmentInfo' &&
          request.params.workspaceId === workspaceId &&
          request.params.attachmentId === attachmentId &&
          response.result?.exists,
      )?.response.result;
      expect(registry).toMatchObject({
        attachmentId,
        mimeType: 'video/mp4',
        size: 5111617,
        exists: true,
      });
      expect(registry.path).toMatch(/^\.intent\/attachments\/[^/]+\.mp4$/);
      const chunks = replies.filter(
        ({ request, response }) =>
          request.method === 'file.readChunk' &&
          request.params.workspaceId === workspaceId &&
          request.params.path === registry.path &&
          response.result?.content,
      );
      let offset = 0;
      const parts = [];
      for (const { request, response } of chunks.slice(
        chunks.findIndex(({ request }) => request.params.offset === 0),
      )) {
        expect(request.params.offset).toBe(offset);
        expect(request.params.length).toBeLessThanOrEqual(1048576);
        const bytes = Buffer.from(response.result.content, 'base64');
        expect(bytes.length).toBe(response.result.bytesRead);
        expect(response.result.size).toBe(registry.size);
        parts.push(bytes);
        offset += bytes.length;
        if (offset === registry.size) break;
      }
      const bytes = Buffer.concat(parts);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(bytes.length).toBe(registry.size);
      expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
      expect(hash).toBe('79d0adc8883fead18e4c1c278b0afe1e0d6ec8e755451cf04be6d636cfc33c85');
      const renderedHash = await page.evaluate(async (url) => {
        const data = await (await fetch(url)).arrayBuffer();
        return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data))]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
      }, object.url);
      expect(renderedHash).toBe(hash);
      await fallback.scrollIntoViewIfNeeded();
      const bounds = await fallback.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      const geometry = { row: await row.boundingBox(), fallback: bounds };
      await stableLocatorScreenshot(page, card, async ({ png, attempt }) => {
        if (png)
          await info.attach(`unavailable-${width}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      });
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
              globalThis.videoObjectUrlObservations.some(
                (e) => e.kind === 'revoke' && e.url === url,
              ),
            object.url,
          ),
        )
        .toBe(true);
      evidence.push({
        width,
        actual,
        registry,
        hash,
        loaded,
        geometry,
        leases,
        objects: await page.evaluate(() => globalThis.videoObjectUrlObservations),
      });
    }
    expect(events.filter((e) => e.type === 'error' || e.type === 'play')).toEqual([]);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    // Chromium may cancel a local blob media load after accepting only its audio
    // track. Keep that exact, positively observed disposition separate from a
    // network/daemon failure; no other URL, media error, or cancellation is allowed.
    for (const failure of failures) {
      expect(failure.failure?.errorText).toBe('net::ERR_ABORTED');
      expect(
        evidence.some((item) =>
          item.objects.some((object) => object.kind === 'create' && object.url === failure.url),
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.src === failure.url &&
            event.type === 'loadeddata' &&
            event.trusted &&
            event.width === 0 &&
            event.height === 0 &&
            event.error === null,
        ),
      ).toBe(true);
      expect(
        mediaCancellations.some(
          (event) => event.url === failure.url && event.canceled === true && event.type === 'Media',
        ),
      ).toBe(true);
    }
  } finally {
    await info.attach('connected-video-wire-and-geometry', {
      body: JSON.stringify({
        browser: browser.version(),
        requests,
        replies,
        events,
        evidence,
        errors,
        failures,
        mediaCancellations,
      }),
      contentType: 'application/json',
    });
    await session.detach();
  }
});
