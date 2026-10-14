import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('real message links seek the canonical row and retire on return', async ({ page }, info) => {
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
  const conversation = page.getByTestId('workspace-conversation');
  const transcript = conversation.getByTestId('conversation-messages');
  const rows = () =>
    transcript
      .locator('[data-message-id]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.messageId));
  const read = (params) =>
    page.evaluate(async (params) => {
      const resource = performance
        .getEntriesByType('resource')
        .find((r) => new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'));
      if (!resource) throw new Error('Real transport not observed');
      const { backendRequest } = await import(resource.name);
      return backendRequest('agent.getConversation', params);
    }, params);
  const probe = async (label) => {
    const value = await transcript.evaluate((container) => ({
      scrollTop: container.scrollTop,
      height: container.clientHeight,
      rows: [...container.querySelectorAll('[data-message-id]')].map((row) => ({
        id: row.dataset.messageId,
        top: row.getBoundingClientRect().top - container.getBoundingClientRect().top,
        height: row.getBoundingClientRect().height,
        focused: row === document.activeElement,
      })),
    }));
    probes.push({ label, ...value });
  };
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    const agentId = 'agent-2c670a4a-067d-464f-ac60-fd00efd63010';
    const url = `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${encodeURIComponent(agentId)}`;
    await page.goto(url);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(page.getByTestId('conversation-load-older')).toBeEnabled();
    const tail = await rows();
    expect(tail.length).toBeGreaterThan(0);
    const older = await read({
      workspaceId,
      agentId,
      limit: 5,
      aroundIndex: 0,
      projection: 'slim',
    });
    const target = older.messages.find((message) => !tail.includes(message.id));
    expect(target, 'A genuine older message outside the resident tail is required').toBeTruthy();
    await probe('before-message-navigation');
    await info.attach('before-message-navigation', {
      body: await conversation.screenshot(),
      contentType: 'image/png',
    });
    await page.goto(`${url}&message=${encodeURIComponent(target.id)}`);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    const targetRow = transcript.locator(`[data-message-id="${target.id}"]`);
    await expect(targetRow).toBeFocused();
    await expect(targetRow).toBeInViewport();
    const seek = replies.find(
      ({ request }) =>
        request.method === 'agent.getConversation' && request.params.aroundMessageId === target.id,
    );
    expect(seek).toBeTruthy();
    expect(seek.response.error).toBeUndefined();
    expect(seek.request.params).toMatchObject({
      workspaceId,
      agentId,
      limit: 5,
      projection: 'slim',
    });
    const independent = await read(seek.request.params);
    expect(independent.messages).toEqual(seek.response.result.messages);
    const actual = await rows();
    for (const id of tail) expect(actual).toContain(id);
    const expectedPageIds = independent.messages.map((message) => message.id);
    expect(actual.filter((id) => expectedPageIds.includes(id))).toEqual(expectedPageIds);
    const text = target.contentBlocks
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    expect(text?.trim(), 'The genuine target must contain readable text').toBeTruthy();
    await expect(targetRow).toContainText(text.trim().split('\n')[0]);
    await probe('after-message-navigation');
    await stableLocatorScreenshot(page, conversation, async ({ png, attempt }) => {
      if (png)
        await info.attach(`message-target-${attempt}`, { body: png, contentType: 'image/png' });
    });
    const subscription = replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === agentId &&
          response.result?.subscriptionId,
      )
      .at(-1).response.result.subscriptionId;
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('message')).toBe(false);
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === subscription &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
    await page.setViewportSize({ width: 420, height: 850 });
    await page.goto(`${url}&message=${encodeURIComponent(tail.at(-1))}`);
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(transcript.locator(`[data-message-id="${tail.at(-1)}"]`)).toBeFocused();
    await expect(transcript.locator(`[data-message-id="${tail.at(-1)}"]`)).toBeInViewport();
    await probe('resident-mobile-target');
    const mobileSubscription = replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === agentId &&
          response.result?.subscriptionId,
      )
      .at(-1).response.result.subscriptionId;
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === mobileSubscription &&
            response.result?.success === true,
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
    await info.attach('message-target-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors }),
      contentType: 'application/json',
    });
  }
});

test('a genuine conversation note link retires the reader and recovers its target on Back', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const { REACT_BASE_URL: base, REACT_WORKSPACE_ID: workspaceId } = process.env;
  if (!base || !workspaceId) throw new Error('Set the real daemon workspace environment');
  const agentId = 'agent-1c311418-f301-4710-815e-417c1a33aded';
  // Persisted in the original connected-conversation receipt, not authored by this test.
  const messageId = '01a138cd-56cc-72ec-a457-07c059ad8e39';
  const noteId = 'b6915304-ddf3-48e6-9702-6da383b54b46';
  const href = `intent://local/${workspaceId}/note/${noteId}`;
  const errors = await observeErrors(page);
  const requests = [],
    replies = [],
    probes = [];
  const observeWire = (target) =>
    target.on('websocket', (socket) => {
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
  observeWire(page);
  const popupObservations = [];
  const observePopup = (popup) => {
    observeWire(popup);
    popupObservations.push(observeErrors(popup));
  };
  page.context().on('page', observePopup);
  const conversation = page.getByTestId('workspace-conversation');
  const row = conversation.locator(`[data-message-id="${messageId}"]`);
  const link = row.getByRole('link', { name: 'Recovery details', exact: true });
  const note = page.getByTestId('workspace-note');
  const lease = () =>
    replies
      .filter(
        ({ request, response }) =>
          request.method === 'chat.subscribe' &&
          request.params.agentId === agentId &&
          response.result?.subscriptionId,
      )
      .at(-1)?.response.result.subscriptionId;
  const released = async (subscriptionId) => {
    expect(subscriptionId).toBeTruthy();
    await expect
      .poll(() =>
        replies.some(
          ({ request, response }) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === subscriptionId &&
            response.result?.success === true,
        ),
      )
      .toBe(true);
  };
  const noteViews = () =>
    page.evaluate(async (id) => {
      const resource = performance
        .getEntriesByType('resource')
        .find((r) => new URL(r.name).pathname.endsWith('/src/store/index.ts'));
      if (!resource) throw new Error('Real Store module was not observed');
      const { store } = await import(resource.name);
      return store.state.workspaceNotes.byWorkspaceId[id]?.contentViews.ids ?? [];
    }, workspaceId);
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.goto(
      `${base}/workspaces/${encodeURIComponent(workspaceId)}?agent=${agentId}&message=${messageId}`,
    );
    await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect(row).toBeFocused();
    const actual = await page.evaluate(
      async ({ workspaceId, agentId, messageId }) => {
        const resource = performance
          .getEntriesByType('resource')
          .find((r) => new URL(r.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!resource) throw new Error('Real transport was not observed');
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
    expect(actual.role).toBe('assistant');
    expect(
      actual.contentBlocks.some(
        (b) => b.type === 'text' && b.text.includes(`[Recovery details](${href})`),
      ),
    ).toBe(true);
    await expect(link).toHaveAttribute('href', href);
    await page.evaluate(() => document.fonts.ready);
    const subscriptions = [];
    for (const [width, activation] of [
      [1100, 'keyboard'],
      [420, 'pointer'],
    ]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(row).toBeFocused();
      await link.locator('..').scrollIntoViewIfNeeded();
      probes.push({ width, activation, link: await link.boundingBox() });
      await stableLocatorScreenshot(page, link.locator('..'), async ({ png, attempt }) => {
        if (png)
          await info.attach(`conversation-note-link-${width}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      });
      const subscriptionId = lease();
      expect(subscriptionId).toBeTruthy();
      expect(subscriptions).not.toContain(subscriptionId);
      subscriptions.push(subscriptionId);
      if (activation === 'keyboard') {
        await link.focus();
        await page.keyboard.press('Enter');
      } else await link.click();
      await expect(note).toHaveAttribute('data-note-id', noteId);
      await expect(conversation).toHaveCount(0);
      await released(subscriptionId);
      const search = new URL(page.url()).searchParams;
      expect(search.get('note')).toBe(noteId);
      expect(search.has('agent')).toBe(false);
      expect(search.has('message')).toBe(false);
      const received = replies
        .filter(
          ({ request, response }) =>
            request.method === 'note.get' &&
            request.params.noteId === noteId &&
            request.params.workspaceId === workspaceId &&
            response.result?.note,
        )
        .at(-1);
      expect(received).toBeTruthy();
      await expect(note.locator('header').getByRole('heading', { level: 2 })).toHaveText(
        received.response.result.note.title,
      );
      await note.locator('header').getByRole('button', { name: 'Source', exact: true }).click();
      expect(await note.getByTestId('note-content').textContent()).toBe(
        received.response.result.note.content,
      );
      await expect.poll(async () => (await noteViews()).length).toBe(1);
      await stableLocatorScreenshot(page, note.locator('header'), async ({ png, attempt }) => {
        if (png)
          await info.attach(`conversation-note-destination-${width}-${attempt}`, {
            body: png,
            contentType: 'image/png',
          });
      });
      await page.goBack();
      await expect(conversation).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      await expect(row).toBeFocused();
      await expect(row).toBeInViewport();
      await expect(link).toHaveAttribute('href', href);
      await expect(note).toHaveCount(0);
      await expect.poll(noteViews).toEqual([]);
      expect(new URL(page.url()).searchParams.get('message')).toBe(messageId);
    }
    const lastSubscription = lease();
    expect(subscriptions).not.toContain(lastSubscription);
    const external = row.getByRole('link', { name: 'Open the workspace preview', exact: true });
    const externalHref = 'http://daemon.localhost:5411/workspaces/system-design';
    expect(
      actual.contentBlocks.some(
        (block) =>
          block.type === 'text' &&
          block.text.includes(`[Open the workspace preview](${externalHref})`),
      ),
    ).toBe(true);
    await expect(external).toHaveAttribute('href', externalHref);
    const sourceUrl = page.url();
    const workspaceReads = () =>
      replies.filter(
        ({ request, response }) =>
          request.method === 'workspace.list' && response.result?.workspaces,
      );
    const beforePopupReads = workspaceReads().length;
    const popupPromise = page.waitForEvent('popup');
    await external.click();
    const popup = await popupPromise;
    try {
      await expect(popup).toHaveURL(externalHref);
      await expect(popup.getByTestId('workspace-overview')).toHaveAttribute(
        'data-workspace-id',
        workspaceId,
        { timeout: 60_000 },
      );
      await expect.poll(() => workspaceReads().length).toBeGreaterThan(beforePopupReads);
      const actualWorkspace = workspaceReads()
        .at(-1)
        .response.result.workspaces.find((workspace) => workspace.id === workspaceId);
      expect(actualWorkspace).toBeTruthy();
      await expect(
        popup.getByTestId('workspace-overview').getByRole('heading', { level: 1 }),
      ).toHaveText(actualWorkspace.title);
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      expect(page.url()).toBe(sourceUrl);
      await expect(conversation).toHaveAttribute('data-ready', 'true');
      await expect(row).toBeVisible();
      expect(lease()).toBe(lastSubscription);
      expect(
        requests.some(
          (request) =>
            request.method === 'chat.unsubscribe' &&
            request.params.subscriptionId === lastSubscription,
        ),
      ).toBe(false);
      await info.attach('genuine-external-workspace', {
        body: await popup.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await popup.close();
    }
    await expect(link).toHaveAttribute('href', href);
    expect(lease()).toBe(lastSubscription);
    await conversation.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await released(lastSubscription);
    for (const subscriptionId of new Set(
      replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' && response.result?.subscriptionId,
        )
        .map(({ response }) => response.result.subscriptionId),
    )) {
      await released(subscriptionId);
    }
    expect(page.context().pages()).toHaveLength(1);
    expect(
      requests.filter(({ method }) =>
        /\.(set.*|update.*|write|create|delete|rename|mkdir|stage|unstage|commit|push|pull|markSeen|sendMessage|execute|join|leave)$/.test(
          method ?? '',
        ),
      ),
    ).toEqual([]);
    expect(popupObservations).toHaveLength(1);
    expect((await Promise.all(popupObservations)).flat()).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    page.context().off('page', observePopup);
    const popupErrors = (await Promise.all(popupObservations)).flat();
    await info.attach('conversation-note-link-wire-and-geometry', {
      body: JSON.stringify({ requests, replies, probes, errors, popupErrors }),
      contentType: 'application/json',
    });
  }
});
