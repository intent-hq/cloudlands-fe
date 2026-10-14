import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('genuine oversized JSON attachment opens a bounded read-only prefix and recovers on Back', async ({
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
      expect(reads[0].params).toEqual({ workspaceId, path: targetPath, offset: 0, length: 16384 });
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
      await page.goBack();
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
      await expect(row).toBeFocused();
      await expect(row).toBeInViewport();
      expect(new URL(page.url()).searchParams.get('message')).toBe(messageId);
      await expect.poll(entries).toEqual({});
      // This file journey exits from the settled genuine conversation. Early
      // teardown of its neighboring video remains a separately preserved failure.
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
            event.error === null,
        ),
      ).toBe(true);
      expect(
        mediaCancellations.some(
          (event) => event.url === failure.url && event.canceled === true && event.type === 'Media',
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
      }),
      contentType: 'application/json',
    });
    await session.detach();
  }
});
