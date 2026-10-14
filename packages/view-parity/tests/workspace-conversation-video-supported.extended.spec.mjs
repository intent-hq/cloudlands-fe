import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';
import { waitForUnplayedNativeVideoControls } from '../lib/chat-video-native-readiness.mjs';

// A separate genuine AVC recording; original HEVC playback acceptance remains pending.
// Exact persisted message, registry bytes and native decoded dimensions are the oracle.
test('genuine AVC attachment supports native playback, focus and reader cleanup', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || workspaceId !== 'square-osprey') throw new Error('Recorded workspace required');
  expect(browser.version()).toBe('153.0.8010.12');
  const agentId = 'agent-161968ff-e599-40e0-9687-094e3919fa1c';
  const messageId = 'user-msg-423ad830-84c0-4fbe-b9bc-18db777f763f';
  const attachmentId = '2eba87be-0efb-472b-9ba9-8d16d96b8942';
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
    for (const type of ['loadedmetadata', 'loadeddata', 'error', 'play', 'playing', 'pause']) {
      document.addEventListener(
        type,
        (event) => {
          const node = event.target;
          if (!(node instanceof globalThis.HTMLVideoElement)) return;
          globalThis.observeConnectedVideo({
            type,
            trusted: event.isTrusted,
            src: node.currentSrc,
            attachmentId: node.closest('[data-attachment-id]')?.getAttribute('data-attachment-id'),
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
      expect(actual.contentBlocks[2]).toMatchObject({
        type: 'file',
        attachmentId,
        mimeType: 'video/mp4',
        size: 8109739,
      });
      const card = row.locator(`[data-attachment-id="${attachmentId}"]`);
      const trigger = card.getByTestId('chat-video-snapshot');
      const preview = trigger.locator('video');
      await expect(trigger).toBeVisible();
      await expect
        .poll(() =>
          preview.evaluate(
            (v) => v.readyState >= 2 && v.videoWidth === 718 && v.videoHeight === 1564,
          ),
        )
        .toBe(true);
      await expect(card.getByTestId('media-unavailable')).toHaveCount(0);
      await expect(card.getByRole('button')).toHaveCount(1);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const videoUrl = await preview.evaluate((v) => v.currentSrc);
      const object = await page.evaluate(
        (url) =>
          globalThis.videoObjectUrlObservations.find((e) => e.kind === 'create' && e.url === url),
        videoUrl,
      );
      expect(object).toMatchObject({ type: 'video/mp4', size: 8109739 });
      const loaded = events.find(
        (e) => e.type === 'loadeddata' && e.src === videoUrl && e.attachmentId === attachmentId,
      );
      expect(loaded).toMatchObject({
        trusted: true,
        width: 718,
        height: 1564,
        paused: true,
        time: 0,
        played: 0,
        error: null,
      });
      expect(loaded.duration).toBeCloseTo(21.3, 5);
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
        size: 8109739,
        exists: true,
      });
      expect(registry.path).toBe('.intent/attachments/ScreenRecording_10-13-2026 23-28-40_1.MP4');
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
      expect(hash).toBe('660e337f0ab399d03f51c1027853fe8df218fc0507cb04d54bc4c8c6f02774f9');
      const renderedHash = await page.evaluate(async (url) => {
        const data = await (await fetch(url)).arrayBuffer();
        return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data))]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
      }, object.url);
      expect(renderedHash).toBe(hash);
      await trigger.scrollIntoViewIfNeeded();
      const contained = async (locator) => {
        const rect = await locator.boundingBox();
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.y + rect.height).toBeLessThanOrEqual(850);
        return rect;
      };
      const capture = async (locator, label) =>
        stableLocatorScreenshot(page, locator, async ({ png, attempt }) => {
          if (png)
            await info.attach(`${label}-${width}-${attempt}`, {
              body: png,
              contentType: 'image/png',
            });
        });
      const retained = await trigger.elementHandle();
      const geometry = { row: await row.boundingBox(), preview: await contained(trigger) };
      await capture(trigger, 'decoded-preview');
      await trigger.click();
      const dialog = page.getByRole('dialog');
      const player = dialog.getByTestId('chat-video-player');
      await expect(dialog).toBeVisible();
      await expect
        .poll(() =>
          player.evaluate(
            (v) => v.readyState >= 2 && v.videoWidth === 718 && v.videoHeight === 1564,
          ),
        )
        .toBe(true);
      expect(
        await player.evaluate((v) => ({
          src: v.currentSrc,
          controls: v.controls,
          autoplay: v.autoplay,
          paused: v.paused,
          time: v.currentTime,
          played: v.played.length,
          error: v.error?.code ?? null,
        })),
      ).toEqual({
        src: videoUrl,
        controls: true,
        autoplay: false,
        paused: true,
        time: 0,
        played: 0,
        error: null,
      });
      await expect(dialog.getByRole('button')).toHaveCount(1);
      const close = dialog.getByRole('button', { name: 'Close video preview', exact: true });
      await expect(close).toBeFocused();
      await waitForUnplayedNativeVideoControls(page, player, info, `genuine-avc-${width}`);
      geometry.unplayed = await contained(player);
      expect(geometry.unplayed.height).toBeGreaterThan(300);
      expect(geometry.unplayed.width).toBeGreaterThan(100);
      expect(geometry.unplayed.width / geometry.unplayed.height).toBeCloseTo(718 / 1564, 2);
      await capture(dialog, 'unplayed-lightbox');
      // Native Chromium media keyboard input; never call play/pause or assign time.
      await player.press('Space');
      await expect
        .poll(() =>
          player.evaluate((v) => {
            const quality = v.getVideoPlaybackQuality();
            return (
              !v.paused &&
              v.currentTime >= 1 &&
              v.played.length > 0 &&
              quality.totalVideoFrames - quality.droppedVideoFrames >= 2
            );
          }),
        )
        .toBe(true);
      await expect
        .poll(() => events.some((e) => e.type === 'playing' && e.trusted && e.src === videoUrl))
        .toBe(true);
      await player.press('Space');
      await expect.poll(() => player.evaluate((v) => v.paused)).toBe(true);
      const playback = await player.evaluate((v) => ({
        paused: v.paused,
        time: v.currentTime,
        played: v.played.length,
        presentedFrames:
          v.getVideoPlaybackQuality().totalVideoFrames -
          v.getVideoPlaybackQuality().droppedVideoFrames,
        width: v.videoWidth,
        height: v.videoHeight,
        error: v.error?.code ?? null,
      }));
      expect(playback.time).toBeGreaterThanOrEqual(1);
      expect(playback.presentedFrames).toBeGreaterThanOrEqual(2);
      expect(playback.played).toBeGreaterThan(0);
      expect(playback.error).toBeNull();
      await expect
        .poll(() =>
          events.some((e) => e.type === 'pause' && e.trusted && e.src === videoUrl && e.time > 0),
        )
        .toBe(true);
      await capture(dialog, 'paused-after-native-play');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await trigger.evaluate((node, original) => node === original, retained)).toBe(true);
      await retained.dispose();
      await capture(trigger, 'closed-after-play');
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
        playback,
        leases,
        objects: await page.evaluate(() => globalThis.videoObjectUrlObservations),
      });
    }
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    // Native local media loads may be cancelled during preload or retirement.
    // Require the exact owned video blob, actual trusted decoded data, null
    // media error and CDP cancelled Media disposition; retain every observation.
    // Incidental HEVC rows stay unavailable and do not count as AVC acceptance.
    for (const failure of failures) {
      expect(failure.failure?.errorText).toBe('net::ERR_ABORTED');
      expect(
        evidence.some((item) =>
          item.objects.some(
            (object) =>
              object.kind === 'create' && object.type === 'video/mp4' && object.url === failure.url,
          ),
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.src === failure.url &&
            event.type === 'loadeddata' &&
            event.trusted &&
            ((event.width === 718 && event.height === 1564) ||
              (event.width === 0 && event.height === 0)) &&
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
    await info.attach('connected-avc-video-wire-and-geometry', {
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
