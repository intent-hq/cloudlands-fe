import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const [rapidDeparture, onPageBack] of [
  [true, false],
  [false, false],
  [true, true],
]) {
  test(`genuine oversized JSON attachment opens a bounded read-only prefix and recovers on Back (${onPageBack ? 'on-page Back' : rapidDeparture ? 'rapid departure' : 'settled departure'})`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120_000);
    const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
    if (!base || workspaceId !== 'square-osprey') throw new Error('Recorded workspace required');
    expect(browser.version()).toBe('153.0.8010.12');
    const agentId = 'agent-161968ff-e599-40e0-9687-094e3919fa1c';
    const messageId = '436ce578-c9a1-4e31-9aa8-c1b6dceec903';
    const attachmentId = 'a3731544-3ddf-4f50-8b41-d22ced0b6c4f';
    const targetPath =
      '.intent/attachments/intentapp-dev-git-perf-mobile-scroll-carousel-sutterhill.vercel.app-recording.json';
    const errors = await observeErrors(page);
    const session = await page.context().newCDPSession(page);
    const mediaCancellations = [],
      networkStarts = [],
      networkRequests = new Map();
    session.on('Network.requestWillBeSent', (event) => {
      networkRequests.set(event.requestId, event.request.url);
      networkStarts.push({ url: event.request.url, wallTime: event.wallTime });
    });
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
        if (request) {
          // Retain the actual target prefix. Unrelated video bytes already have their
          // own maintained acceptance; record exact chunk hashes instead of making
          // this JSON report exceed the runtime string limit with repeated media.
          const response =
            request.method === 'file.readChunk' &&
            request.params.path !== targetPath &&
            typeof r.result?.content === 'string'
              ? {
                  ...r,
                  result: {
                    ...r.result,
                    content: undefined,
                    contentSha256: createHash('sha256')
                      .update(Buffer.from(r.result.content, 'base64'))
                      .digest('hex'),
                  },
                }
              : r;
          replies.push({ request, response });
        }
      });
    });
    await page.exposeFunction('observeConnectedVideo', (event) => events.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(5000);
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      globalThis.videoObjectUrlObservations = [];
      const videos = new Set();
      const pausedSources = new WeakMap();
      const pause = globalThis.HTMLMediaElement.prototype.pause;
      const load = globalThis.HTMLMediaElement.prototype.load;
      globalThis.HTMLMediaElement.prototype.pause = function (...args) {
        pausedSources.set(this, this.getAttribute('src') || this.currentSrc);
        return pause.apply(this, args);
      };
      globalThis.HTMLMediaElement.prototype.load = function (...args) {
        const result = load.apply(this, args);
        globalThis.videoObjectUrlObservations.push({
          kind: 'stop',
          url: pausedSources.get(this),
          src: this.getAttribute('src'),
          currentSrc: this.currentSrc,
          paused: this.paused,
          networkState: this.networkState,
          readyState: this.readyState,
        });
        return result;
      };
      const remember = (node) => {
        if (node instanceof globalThis.HTMLVideoElement) videos.add(new WeakRef(node));
        if (node instanceof globalThis.Element)
          for (const video of node.querySelectorAll('video')) videos.add(new WeakRef(video));
      };
      const collect = (records) => {
        for (const record of records)
          for (const node of [...record.addedNodes, ...record.removedNodes]) remember(node);
      };
      const observer = new globalThis.MutationObserver(collect);
      observer.observe(document, { childList: true, subtree: true });
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
        collect(observer.takeRecords());
        const consumers = [...new Set([...videos].map((ref) => ref.deref()).filter(Boolean))]
          .filter((video) => video.getAttribute('src') === url || video.currentSrc === url)
          .map((video) => ({
            src: video.getAttribute('src'),
            currentSrc: video.currentSrc,
            connected: video.isConnected,
            paused: video.paused,
            networkState: video.networkState,
            readyState: video.readyState,
          }));
        globalThis.videoObjectUrlObservations.push({
          kind: 'revoke',
          url,
          consumers,
          wallTime: (performance.timeOrigin + performance.now()) / 1000,
        });
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
              attachmentId: node
                .closest('[data-attachment-id]')
                ?.getAttribute('data-attachment-id'),
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
    const activations = [];
    await page.exposeFunction('observeAttachmentActivation', (event) => activations.push(event));
    const lease = () =>
      replies
        .filter(
          (r) =>
            r.request.method === 'chat.subscribe' &&
            r.request.params.agentId === agentId &&
            r.response.result?.subscriptionId,
        )
        .at(-1)?.response.result.subscriptionId;
    const released = async (id) => {
      expect(id).toBeTruthy();
      await expect
        .poll(() =>
          replies.some(
            (r) =>
              r.request.method === 'chat.unsubscribe' &&
              r.request.params.subscriptionId === id &&
              r.response.result?.success === true,
          ),
        )
        .toBe(true);
    };
    const entries = () =>
      page.evaluate(async (workspaceId) => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/src/store/index.ts'));
        if (!resource) throw new Error('Actual Store module not observed');
        const { store } = await import(resource.name);
        return store.state.files.byWorkspaceId[workspaceId]?.files.map ?? {};
      }, workspaceId);
    try {
      for (const width of [1100, 420]) {
        await page.setViewportSize({ width, height: 850 });
        await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}&message=${messageId}`);
        const conversation = page.getByTestId('workspace-conversation');
        await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
        const row = conversation.locator(`[data-message-id="${messageId}"]`);
        await expect(row).toBeFocused();
        const actual = await page.evaluate(
          async (params) => {
            const resource = performance
              .getEntriesByType('resource')
              .find((r) =>
                new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'),
              );
            if (!resource) throw new Error('Actual transport not observed');
            const { backendRequest } = await import(resource.name);
            const [conversation, { workspace }] = await Promise.all([
              backendRequest('agent.getConversation', {
                ...params,
                aroundMessageId: params.messageId,
                limit: 5,
                projection: 'slim',
              }),
              backendRequest('workspace.get', { workspaceId: params.workspaceId }),
            ]);
            return {
              message: conversation.messages.find((m) => m.id === params.messageId),
              workspace: { id: workspace.id, archived: workspace.archived },
            };
          },
          { workspaceId, agentId, messageId },
        );
        expect(actual.workspace).toEqual({ id: workspaceId, archived: false });
        expect(actual.message).toMatchObject({ id: messageId, seq: 8, role: 'user' });
        expect(actual.message.contentBlocks[2]).toMatchObject({
          type: 'file',
          attachmentId,
          mimeType: 'application/json',
          size: 129063439,
        });
        const chip = row
          .locator(`[data-attachment-id="${attachmentId}"]`)
          .getByTestId('chat-message-file-chip');
        await expect(row.getByTestId('media-unavailable')).toBeVisible({ timeout: 15000 });
        await chip.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        const before = { row: await row.boundingBox(), chip: await chip.boundingBox() };
        expect(before.chip.width).toBeLessThanOrEqual(before.row.width);
        expect(await chip.innerText()).toContain('application/json');
        await stableLocatorScreenshot(page, row, async ({ png, attempt }) => {
          if (png)
            await info.attach(`attachment-chip-${width}-${attempt}`, {
              body: png,
              contentType: 'image/png',
            });
        });
        await chip.evaluate((node) =>
          node.addEventListener(
            'click',
            (event) =>
              globalThis.observeAttachmentActivation({
                trusted: event.isTrusted,
                detail: event.detail,
              }),
            { once: true },
          ),
        );
        const oldLease = lease(),
          start = requests.length;
        if (width === 1100) {
          await chip.focus();
          await page.keyboard.press('Enter');
        } else await chip.click();
        const view = page.getByTestId('workspace-file');
        await expect(view).toHaveAttribute('data-file-path', targetPath);
        const prefix = view.getByTestId('workspace-file-prefix');
        await expect(prefix).toBeVisible({ timeout: 15000 });
        await expect(view.getByRole('heading')).toBeFocused();
        await released(oldLease);
        const registry = replies
          .filter(
            (r) =>
              r.request.method === 'file.getAttachmentInfo' &&
              r.request.params.attachmentId === attachmentId,
          )
          .at(-1)?.response.result;
        expect(registry).toMatchObject({
          attachmentId,
          path: targetPath,
          exists: true,
          mimeType: 'application/json',
          size: 129063439,
        });
        const reads = requests
          .slice(start)
          .filter((r) => r.method === 'file.readChunk' && r.params.path === targetPath);
        expect(reads).toHaveLength(1);
        expect(reads[0].params).toEqual({
          workspaceId,
          path: targetPath,
          offset: 0,
          length: 16384,
        });
        const wire = replies.find((r) => r.request === reads[0])?.response.result;
        expect(wire).toMatchObject({ bytesRead: 16384, size: 129063439 });
        const bytes = Buffer.from(wire.content, 'base64');
        expect(bytes.length).toBe(16384);
        const text = new globalThis.TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          bytes,
          { stream: true },
        );
        expect(await prefix.textContent()).toBe(text);
        expect(text.length).toBeLessThanOrEqual(16384);
        expect(text.startsWith('{"version":1,"recording":')).toBe(true);
        expect(await prefix.locator('*').count()).toBe(0);
        await expect(view.getByRole('status')).toContainText('Partial preview:');
        const cache = await entries();
        expect(Object.keys(cache)).toEqual([targetPath]);
        expect(cache[targetPath]).toMatchObject({
          kind: 'read-only-text',
          localContent: null,
          truncated: true,
          bytesRead: 16384,
          totalBytes: 129063439,
          originalContent: text,
        });
        const geometry = {
          view: await view.boundingBox(),
          prefix: await prefix.boundingBox(),
          scroll: await prefix.evaluate((n) => ({
            width: n.clientWidth,
            scrollWidth: n.scrollWidth,
            height: n.clientHeight,
            scrollHeight: n.scrollHeight,
          })),
        };
        expect(geometry.view.x).toBeGreaterThanOrEqual(0);
        expect(geometry.view.x + geometry.view.width).toBeLessThanOrEqual(width);
        expect(geometry.scroll.scrollWidth).toBeLessThanOrEqual(geometry.scroll.width + 1);
        expect(geometry.prefix.height).toBeLessThanOrEqual(384);
        await stableLocatorScreenshot(page, view, async ({ png, attempt }) => {
          if (png)
            await info.attach(`attachment-prefix-${width}-${attempt}`, {
              body: png,
              contentType: 'image/png',
            });
        });
        if (onPageBack) {
          const back = view.getByRole('link', { name: 'Back', exact: true });
          const backSearch = new URL(await back.getAttribute('href'), base).searchParams;
          expect(backSearch.get('agent')).toBe(agentId);
          expect(backSearch.get('message')).toBe(messageId);
          expect(backSearch.get('file')).toBeNull();
          if (width === 1100) {
            await back.focus();
            await page.keyboard.press('Enter');
          } else await back.click();
        } else await page.goBack();
        await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
        await expect(row).toBeFocused();
        await expect(row).toBeInViewport();
        expect(new URL(page.url()).searchParams.get('message')).toBe(messageId);
        await expect.poll(entries).toEqual({});
        if (!rapidDeparture)
          await expect(row.getByTestId('media-unavailable')).toBeVisible({ timeout: 15000 });
        const returned = { row: await row.boundingBox() };
        expect(Math.abs(returned.row.y - before.row.y)).toBeLessThanOrEqual(1);
        const nextLease = lease();
        await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
        await expect(conversation).toHaveCount(0);
        await released(nextLease);
        await expect
          .poll(() =>
            page.evaluate(() => {
              const observations = globalThis.videoObjectUrlObservations;
              return observations
                .filter((item) => item.kind === 'create')
                .every((item) =>
                  observations.some((other) => other.kind === 'revoke' && other.url === item.url),
                );
            }),
          )
          .toBe(true);
        evidence.push({
          width,
          actual,
          registry,
          before,
          geometry,
          returned,
          hash: createHash('sha256').update(bytes).digest('hex'),
          leases: [oldLease, nextLease],
          objects: await page.evaluate(() => globalThis.videoObjectUrlObservations),
        });
      }
      // URL release must follow native consumer retirement even when network timing
      // does not reproduce the historical ERR_FILE_NOT_FOUND on this run.
      for (const item of evidence) {
        expect(
          item.objects.some(
            (object) =>
              object.kind === 'create' && object.type === 'video/mp4' && object.size === 15213019,
          ),
        ).toBe(true);
        for (const object of item.objects.filter((object) => object.kind === 'revoke')) {
          expect(
            networkStarts.filter(
              (request) => request.url === object.url && request.wallTime > object.wallTime,
            ),
          ).toEqual([]);
          // Pinned Blink clears the native player synchronously in load(), but
          // can retain currentSrc as a historical string with no resource loaded.
          // Assert actual retirement, not that informational string's lifetime.
          for (const consumer of object.consumers)
            expect(consumer).toMatchObject({
              src: null,
              paused: true,
              networkState: 0,
              readyState: 0,
            });
        }
      }
      expect(activations).toEqual([
        { trusted: true, detail: 0 },
        { trusted: true, detail: 1 },
      ]);
      expect(
        requests.filter((r) => r.method === 'file.read' && r.params.path === targetPath),
      ).toEqual([]);
      expect(
        requests.filter(({ method }) =>
          /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
            method ?? '',
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      for (const failure of failures) {
        expect(failure.failure?.errorText).toBe('net::ERR_ABORTED');
        expect(
          evidence.some((item) =>
            item.objects.some(
              (object) =>
                object.kind === 'create' &&
                object.type === 'video/mp4' &&
                object.url === failure.url,
            ),
          ),
        ).toBe(true);
        expect(
          events.some(
            (event) =>
              event.src === failure.url &&
              event.type === 'loadeddata' &&
              event.trusted &&
              event.error === null,
          ) ||
            evidence.some((item) =>
              item.objects.some(
                (object) =>
                  object.kind === 'stop' &&
                  object.url === failure.url &&
                  object.src === null &&
                  object.paused &&
                  object.networkState === 3 &&
                  object.readyState === 0,
              ),
            ),
        ).toBe(true);
        expect(
          mediaCancellations.some(
            (event) =>
              event.url === failure.url && event.canceled === true && event.type === 'Media',
          ),
        ).toBe(true);
      }
      expect(events.filter((e) => e.type === 'error')).toEqual([]);
    } finally {
      await info.attach('connected-file-prefix-wire-and-geometry', {
        body: JSON.stringify({
          browser: browser.version(),
          requests,
          replies,
          events,
          evidence,
          activations,
          errors,
          failures,
          mediaCancellations,
          networkStarts,
        }),
        contentType: 'application/json',
      });
      await session.detach();
    }
  });
}
