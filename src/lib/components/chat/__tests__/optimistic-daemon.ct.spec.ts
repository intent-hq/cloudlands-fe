import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, test } from '../../../../test/ct-test';
import OptimisticDaemonHost from './OptimisticDaemonHost.svelte';
import { connect, createRelay, rpcClient, type DaemonFixture } from './optimistic-daemon-relay';

// The fixture service owns an isolated store and test bearer credentials. Never use a live daemon.
const connection = process.env.OPTIMISTIC_DAEMON_FIXTURE;
test.skip(!connection, 'Requires the explicitly provisioned isolated daemon fixture');
test.setTimeout(120_000);

test('optimistic real-daemon foreign split before ACK preserves new draft and authenticated authors', async ({
  mount,
  page,
}, info) => {
  const fixture = JSON.parse(readFileSync(connection!, 'utf8')) as DaemonFixture;
  const ownerSocket = await connect(fixture, fixture.ownerToken);
  const guestSocket = await connect(fixture, fixture.guestToken);
  const owner = rpcClient(ownerSocket),
    guest = rpcClient(guestSocket);
  const relay = await createRelay(fixture);
  try {
    const ownerMe = await owner('principal.me');
    const guestMe = await guest('principal.me');
    expect(guestMe.id).toBe(fixture.guestId);
    expect(ownerMe.id).not.toBe(guestMe.id);
    const { agent } = await owner('agent.create', {
      workspaceId: fixture.workspaceId,
      name: 'Optimistic functional',
      provider: 'mock',
      model: 'default',
    });
    const params = { agentId: agent.id, workspaceId: fixture.workspaceId };
    await owner('agent.sendMessage', {
      ...params,
      content: [
        'hold busy turn',
        ...Array.from({ length: 60 }, (_, i) => `History line ${i}`),
      ].join('\n\n'),
    });
    await expect
      .poll(async () => (await owner('agent.get', params)).agent.lastAgentResponse)
      .toContain('streaming-before-cancel');
    await owner('agent.queueMessage', {
      ...params,
      content: 'Confirmed A',
      messageId: `functional-a-${agent.id}`,
    });
    const component = await mount(OptimisticDaemonHost, {
      props: { wsUrl: relay.url, workspaceId: fixture.workspaceId, agentId: agent.id },
    });
    await expect(page.getByTestId('optimistic-daemon')).toBeVisible();
    const rows = component.getByTestId('queued-message-text');
    await expect(rows).toHaveText(['Confirmed A']);
    const heldRequest = relay.hold('agent.queueMessage', 'request');
    const heldAck = relay.hold('agent.queueMessage', 'response');
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await editor.pressSequentially('Pending B');
    await editor.press('Enter');
    await expect(rows).toHaveText(['Confirmed A\n\nPending B']);
    await expect.poll(() => heldRequest.pending.length).toBe(1);
    await editor.pressSequentially('Newer draft remains');
    const viewport = component.getByTestId('chat-transcript-scroll-viewport');
    await expect
      .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(100);
    // The user-message card has its own scrollable body; target the outer
    // transcript gutter so the wheel gesture reaches the viewport under test.
    await viewport.hover({ position: { x: 4, y: 4 } });
    await page.mouse.wheel(0, -10000);
    await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeLessThan(2);
    await expect(component.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('optimistic-daemon-pending.png') });
    await guest('agent.queueMessage', {
      ...params,
      content: 'Foreign barrier',
      messageId: `functional-foreign-${agent.id}`,
    });
    heldRequest.release();
    await expect.poll(() => heldAck.pending.length).toBe(1);
    await expect(rows).toHaveText([
      'Confirmed A',
      /Message from @functional-guest[\s\S]*Foreign barrier$/,
      'Pending B',
    ]);
    const canonical = (await owner('agent.getQueue', params)).queue;
    expect(canonical.map((row: any) => row.author.principalId)).toEqual([
      ownerMe.id,
      guestMe.id,
      ownerMe.id,
    ]);
    await expect(editor).toContainText('Newer draft remains');
    await expect(editor).toBeFocused();
    await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath('optimistic-daemon-split-before-ack.png') });
    heldAck.release();
    await expect(rows).toHaveText([
      'Confirmed A',
      /Message from @functional-guest[\s\S]*Foreign barrier$/,
      'Pending B',
    ]);
    await expect(editor).toContainText('Newer draft remains');
    await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeLessThan(2);
    await expect(
      guest('agent.editQueuedMessage', {
        ...params,
        messageId: `functional-a-${agent.id}`,
        content: 'forged replacement',
      }),
    ).rejects.toThrow();
    expect((await owner('agent.getQueue', params)).queue[0].content).toBe('Confirmed A');
    await component.unmount();
  } finally {
    await info.attach('real-daemon-rpc-log', {
      body: JSON.stringify({ calls: relay.calls, errors: relay.errors }, null, 2),
      contentType: 'application/json',
    });
    relay.close();
    ownerSocket.close();
    guestSocket.close();
  }
});

// A separate agent makes this case independent of the foreign-split retry unit.
test('optimistic real-daemon active edit retains appended suffix and queue controls call real RPCs', async ({
  mount,
  page,
}, info) => {
  const fixture = JSON.parse(readFileSync(connection!, 'utf8')) as DaemonFixture;
  const socket = await connect(fixture, fixture.ownerToken);
  const owner = rpcClient(socket);
  const relay = await createRelay(fixture);
  try {
    const { agent } = await owner('agent.create', {
      workspaceId: fixture.workspaceId,
      name: 'Edit suffix functional',
      provider: 'mock',
      model: 'default',
    });
    const params = { agentId: agent.id, workspaceId: fixture.workspaceId };
    await owner('agent.sendMessage', { ...params, content: 'hold busy turn' });
    await expect
      .poll(async () => (await owner('agent.get', params)).agent.lastAgentResponse)
      .toContain('streaming-before-cancel');
    await owner('agent.queueMessage', {
      ...params,
      content: 'Original edit',
      messageId: `functional-edit-${agent.id}`,
    });
    const component = await mount(OptimisticDaemonHost, {
      props: { wsUrl: relay.url, workspaceId: fixture.workspaceId, agentId: agent.id },
    });
    const rows = component.getByTestId('queued-message-row');
    await expect(component.getByTestId('queued-message-text')).toHaveText(['Original edit']);
    await rows.first().hover();
    await rows.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = rows.locator('textarea');
    await edit.fill('Edited prefix');
    await expect
      .poll(async () => (await owner('agent.getQueue', params)).queue[0].editing)
      .toBe(true);
    const held = relay.hold('agent.queueMessage', 'request');
    await page.evaluate(() => window.__optimisticDaemon!.submit('Concurrent suffix'));
    await expect.poll(() => held.pending.length).toBe(1);
    await edit.press('Enter');
    await expect(edit).toHaveValue('Edited prefix');
    expect(relay.calls.filter((call) => call.method === 'agent.editQueuedMessage')).toHaveLength(1);
    held.release();
    await expect
      .poll(async () => (await owner('agent.getQueue', params)).queue[0].content)
      .toBe('Original edit\n\nConcurrent suffix');
    await expect
      .poll(() =>
        page.evaluate(() => window.__optimisticDaemon!.display().queue[0].blocksMutations),
      )
      .toBe(false);
    await edit.press('Enter');
    await expect(component.getByTestId('queued-message-text')).toHaveText([
      'Edited prefix\n\nConcurrent suffix',
    ]);
    expect((await owner('agent.getQueue', params)).queue[0].content).toBe(
      'Edited prefix\n\nConcurrent suffix',
    );
    await page.screenshot({ path: info.outputPath('optimistic-daemon-edited-suffix.png') });
    await rows.first().hover();
    await rows.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(async () => (await owner('agent.getQueue', params)).queue.length).toBe(0);
    expect(
      relay.calls.some(
        (call) =>
          call.method === 'agent.removeQueuedMessage' &&
          call.params.messageId === `functional-edit-${agent.id}`,
      ),
    ).toBe(true);
    await owner('agent.queueMessage', {
      ...params,
      content: 'Clear this',
      messageId: `functional-clear-${agent.id}`,
    });
    await expect(component.getByTestId('queued-message-text')).toHaveText(['Clear this']);
    await component.getByRole('button', { name: 'Clear all queued messages' }).click();
    await expect.poll(async () => (await owner('agent.getQueue', params)).queue.length).toBe(0);
    expect(
      relay.calls.some(
        (call) =>
          call.method === 'agent.removeQueuedMessage' &&
          call.params.messageId === `functional-clear-${agent.id}`,
      ),
    ).toBe(true);
    await owner('agent.queueMessage', {
      ...params,
      content: 'Send this now',
      messageId: `functional-now-${agent.id}`,
    });
    await expect(component.getByTestId('queued-message-text')).toHaveText(['Send this now']);
    await component.getByTestId('queued-message-row').hover();
    await component.getByRole('button', { name: 'Send immediately', exact: true }).click();
    await expect
      .poll(async () => JSON.stringify(await owner('agent.getConversation', params)))
      .toContain('Send this now');
    expect(
      relay.calls.some(
        (call) =>
          call.method === 'agent.sendQueuedMessageNow' &&
          call.params.messageId === `functional-now-${agent.id}`,
      ),
    ).toBe(true);
    await component.unmount();
  } finally {
    await info.attach('real-daemon-rpc-log', {
      body: JSON.stringify({ calls: relay.calls, errors: relay.errors }, null, 2),
      contentType: 'application/json',
    });
    relay.close();
    socket.close();
  }
});

test('optimistic real-daemon pre-ACK batch drain never resurrects rapid submissions', async ({
  mount,
  page,
}, info) => {
  const fixture = JSON.parse(readFileSync(connection!, 'utf8')) as DaemonFixture;
  const socket = await connect(fixture, fixture.ownerToken);
  const owner = rpcClient(socket);
  const relay = await createRelay(fixture);
  try {
    const { agent } = await owner('agent.create', {
      workspaceId: fixture.workspaceId,
      name: 'Pre ACK drain functional',
      provider: 'mock',
      model: 'default',
    });
    const params = { agentId: agent.id, workspaceId: fixture.workspaceId };
    await owner('agent.sendMessage', { ...params, content: 'hold busy turn' });
    await expect
      .poll(async () => (await owner('agent.get', params)).agent.lastAgentResponse)
      .toContain('streaming-before-cancel');
    const component = await mount(OptimisticDaemonHost, {
      props: { wsUrl: relay.url, workspaceId: fixture.workspaceId, agentId: agent.id },
    });
    await expect(page.getByTestId('optimistic-daemon')).toBeVisible();
    const held = relay.hold('agent.queueMessage', 'response');
    await page.evaluate(() => {
      window.__optimisticDaemon!.submit('Rapid identical');
      window.__optimisticDaemon!.submit('Rapid identical');
    });
    await expect.poll(() => held.pending.length).toBe(1);
    // The per-agent FIFO has not dispatched the second request; it is already visible.
    await expect(component.getByTestId('queued-message-text')).toHaveText([
      'Rapid identical\n\nRapid identical',
    ]);
    const first = (await owner('agent.getQueue', params)).queue[0];
    await owner('agent.sendQueuedMessagesNow', { ...params, messageIds: [first.id] });
    await expect
      .poll(async () => JSON.stringify(await owner('agent.getConversation', params)))
      .toContain(first.id);
    held.release();
    await expect
      .poll(
        () =>
          relay.calls.filter((call) =>
            ['agent.queueMessage', 'agent.sendMessage'].includes(call.method),
          ).length,
      )
      .toBe(2);
    await expect.poll(async () => (await owner('agent.getQueue', params)).queue.length).toBe(0);
    await expect(component.getByTestId('queued-message-row')).toHaveCount(0);
    const history = (await owner('agent.getConversation', params)).messages;
    const sentIds = relay.calls
      .filter((call) => ['agent.queueMessage', 'agent.sendMessage'].includes(call.method))
      .map((call) => call.params.messageId);
    expect(new Set(sentIds).size).toBe(2);
    for (const id of sentIds)
      expect(
        history.filter((row: any) => row.id === id || row.metadata?.submissionIds?.includes(id)),
      ).toHaveLength(1);
    await expect
      .poll(() => page.evaluate(() => window.__optimisticDaemon!.display().queue.length))
      .toBe(0);
    // Backend multiplicity alone does not prove that renderer dedup kept both sends.
    await expect(
      component.getByTestId('user-message-surface').filter({ hasText: 'Rapid identical' }),
    ).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('optimistic-daemon-drained-before-ack.png') });
    await component.unmount();
  } finally {
    await info.attach('real-daemon-rpc-log', {
      body: JSON.stringify({ calls: relay.calls, errors: relay.errors }, null, 2),
      contentType: 'application/json',
    });
    relay.close();
    socket.close();
  }
});

test('optimistic real-daemon attachment preparation and chat-to-queue fallback preserve the new draft', async ({
  mount,
  page,
}, info) => {
  const fixture = JSON.parse(readFileSync(connection!, 'utf8')) as DaemonFixture;
  const socket = await connect(fixture, fixture.ownerToken);
  const owner = rpcClient(socket);
  const relay = await createRelay(fixture);
  try {
    const { agent } = await owner('agent.create', {
      workspaceId: fixture.workspaceId,
      name: 'Attachment fallback functional',
      provider: 'mock',
      model: 'default',
    });
    const params = { agentId: agent.id, workspaceId: fixture.workspaceId };
    const component = await mount(OptimisticDaemonHost, {
      props: { wsUrl: relay.url, workspaceId: fixture.workspaceId, agentId: agent.id },
    });
    await expect(page.getByTestId('optimistic-daemon')).toBeVisible();
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    // The browser believes the agent idle while a different client starts a real turn.
    const events = relay.hold('events.event', 'event');
    const pushes = relay.hold('subscription.push', 'event');
    await owner('agent.sendMessage', { ...params, content: 'hold busy turn' });
    await expect
      .poll(async () => (await owner('agent.get', params)).agent.lastAgentResponse)
      .toContain('streaming-before-cancel');
    const placement = relay.hold('file.placeAttachment', 'request');
    const request = relay.hold('agent.sendMessage', 'request');
    await component.locator('input[type="file"]').setInputFiles({
      name: 'functional.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAK0lEQVR4nGPYe96Apohh1IJRC0YtGLVg1IJRC0YtGLVg1IJRC0YtGCoWAAC3PfBb6lfdeAAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await editor.pressSequentially('Attachment fallback');
    await editor.press('Enter');
    await expect.poll(() => placement.pending.length).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__optimisticDaemon!.display().conversation.map((row) => row.content),
        ),
      )
      .toEqual(['Attachment fallback']);
    expect(relay.calls.filter((call) => call.method === 'agent.sendMessage')).toHaveLength(0);
    const preview = component.getByTestId('user-message-surface').locator('img');
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(32);
    await editor.pressSequentially('Keep this newer draft');
    await page.screenshot({ path: info.outputPath('optimistic-daemon-preparation.png') });
    placement.release();
    await expect.poll(() => request.pending.length).toBe(1);
    const sent = relay.calls.find((call) => call.method === 'agent.sendMessage')!.params;
    expect(sent.imageBlocks[0].attachmentId).toEqual(expect.any(String));
    expect(sent.imageBlocks[0].data).toBeUndefined();
    request.release();
    await expect(component.getByTestId('queued-message-text')).toHaveText(['Attachment fallback']);
    await expect
      .poll(() => page.evaluate(() => window.__optimisticDaemon!.display().conversation.length))
      .toBe(0);
    await expect(editor).toContainText('Keep this newer draft');
    const canonical = (await owner('agent.getQueue', params)).queue;
    expect(canonical).toHaveLength(1);
    expect(canonical[0].submissionIds).toContain(sent.messageId);
    expect(canonical[0].imageBlocks[0].attachmentId).toBe(sent.imageBlocks[0].attachmentId);
    events.release();
    pushes.release();
    await expect(component.getByTestId('queued-message-text')).toHaveText(['Attachment fallback']);
    await expect(editor).toBeFocused();
    await component.unmount();
  } finally {
    await info.attach('real-daemon-rpc-log', {
      body: JSON.stringify({ calls: relay.calls, errors: relay.errors }, null, 2),
      contentType: 'application/json',
    });
    relay.close();
    socket.close();
  }
});

test('optimistic real-daemon lost ACK stays uncertain without resend and recovers from authenticated evidence', async ({
  mount,
  page,
}, info) => {
  const fixture = JSON.parse(readFileSync(connection!, 'utf8')) as DaemonFixture;
  const socket = await connect(fixture, fixture.ownerToken);
  const owner = rpcClient(socket);
  const relay = await createRelay(fixture);
  try {
    const { agent } = await owner('agent.create', {
      workspaceId: fixture.workspaceId,
      name: 'Lost ACK functional',
      provider: 'mock',
      model: 'default',
    });
    const params = { agentId: agent.id, workspaceId: fixture.workspaceId };
    await owner('agent.sendMessage', { ...params, content: 'hold busy turn' });
    await expect
      .poll(async () => (await owner('agent.get', params)).agent.lastAgentResponse)
      .toContain('streaming-before-cancel');
    const component = await mount(OptimisticDaemonHost, {
      props: { wsUrl: relay.url, workspaceId: fixture.workspaceId, agentId: agent.id },
    });
    await expect(page.getByTestId('optimistic-daemon')).toBeVisible();
    // Do not withhold the initial history load: it is an admission prerequisite,
    // distinct from the post-send evidence this scenario intentionally loses.
    await expect(component.getByTestId('user-message-surface')).toContainText('hold busy turn');
    const events = relay.hold('events.event', 'event');
    const pushes = relay.hold('subscription.push', 'event');
    const history = relay.hold('agent.getConversation', 'response');
    const queue = relay.hold('agent.getQueue', 'response');
    const ack = relay.hold('agent.queueMessage', 'response');
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await editor.pressSequentially('Accepted with lost ACK');
    await editor.press('Enter');
    await expect.poll(() => ack.pending.length).toBe(1);
    await editor.pressSequentially('Draft after lost ACK');
    const canonical = (await owner('agent.getQueue', params)).queue;
    expect(canonical).toHaveLength(1);
    // Let the real browser transport's own request timeout expire. No injected error response.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.__optimisticDaemon!.display().queue[0]?.contributions[0]?.status,
          ),
        { timeout: 45000 },
      )
      .toBe('uncertain');
    expect(relay.calls.filter((call) => call.method === 'agent.queueMessage')).toHaveLength(1);
    await expect(editor).toContainText('Draft after lost ACK');
    await page.screenshot({ path: info.outputPath('optimistic-daemon-lost-ack.png') });
    events.release();
    pushes.release();
    history.release();
    queue.release();
    await page.evaluate(() => window.__optimisticDaemon!.refresh());
    await expect
      .poll(() =>
        page.evaluate(() => window.__optimisticDaemon!.display().queue[0]?.contributions.length),
      )
      .toBe(0);
    await expect(component.getByTestId('queued-message-text')).toHaveText([
      'Accepted with lost ACK',
    ]);
    expect(relay.calls.filter((call) => call.method === 'agent.queueMessage')).toHaveLength(1);
    expect((await owner('agent.getQueue', params)).queue.map((row: any) => row.id)).toEqual(
      canonical.map((row: any) => row.id),
    );
    await component.unmount();
  } finally {
    await info.attach('real-daemon-rpc-log', {
      body: JSON.stringify({ calls: relay.calls, errors: relay.errors }, null, 2),
      contentType: 'application/json',
    });
    relay.close();
    socket.close();
  }
});

test('optimistic real-daemon Send all restores head and tail after controlled partial persistence failure', async ({
  mount,
  page,
}, info) => {
  const fixture = JSON.parse(readFileSync(connection!, 'utf8')) as DaemonFixture;
  expect(fixture.base).toMatch(/^\/tmp\/intent-optimistic-/);
  const socket = await connect(fixture, fixture.ownerToken);
  const guestSocket = await connect(fixture, fixture.guestToken);
  const owner = rpcClient(socket),
    guest = rpcClient(guestSocket);
  const relay = await createRelay(fixture);
  const fault = (tail?: string) =>
    execFileSync('python3', [
      '-c',
      `import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute('DROP TRIGGER IF EXISTS functional_tail_failure')
 if len(sys.argv)>2:
  value=db.execute('SELECT quote(?)',(sys.argv[2],)).fetchone()[0]
  db.execute("CREATE TRIGGER functional_tail_failure BEFORE INSERT ON agent_message WHEN json_extract(NEW.metadata, '$.queueInfo.queuedMessageId')="+value+" BEGIN SELECT RAISE(FAIL, 'controlled functional tail persistence failure'); END")`,
      `${fixture.base}/intentd.db`,
      ...(tail ? [tail] : []),
    ]);
  try {
    const { agent } = await owner('agent.create', {
      workspaceId: fixture.workspaceId,
      name: 'Partial persistence functional',
      provider: 'mock',
      model: 'default',
    });
    const params = { agentId: agent.id, workspaceId: fixture.workspaceId };
    await owner('agent.sendMessage', { ...params, content: 'hold busy turn' });
    await expect
      .poll(async () => (await owner('agent.get', params)).agent.lastAgentResponse)
      .toContain('streaming-before-cancel');
    await owner('agent.queueMessage', {
      ...params,
      content: 'Persisted head',
      messageId: `functional-persisted-head-${agent.id}`,
    });
    await guest('agent.queueMessage', {
      ...params,
      content: 'Unpersisted tail',
      messageId: `functional-unpersisted-tail-${agent.id}`,
    });
    const before = (await owner('agent.getQueue', params)).queue;
    const component = await mount(OptimisticDaemonHost, {
      props: { wsUrl: relay.url, workspaceId: fixture.workspaceId, agentId: agent.id },
    });
    await expect(component.getByTestId('queued-message-text')).toHaveText([
      'Persisted head',
      /Message from @functional-guest[\s\S]*Unpersisted tail$/,
    ]);
    fault(`functional-unpersisted-tail-${agent.id}`);
    await component.getByRole('button', { name: 'Send all ready messages now' }).click();
    await expect
      .poll(
        () => relay.calls.filter((call) => call.method === 'agent.sendQueuedMessagesNow').length,
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (await owner('agent.getConversation', params)).messages.filter((row: any) =>
            row.metadata?.submissionIds?.includes(`functional-persisted-head-${agent.id}`),
          ).length,
      )
      .toBe(1);
    const history = (await owner('agent.getConversation', params)).messages;
    expect(
      history.filter((row: any) =>
        row.metadata?.submissionIds?.includes(`functional-unpersisted-tail-${agent.id}`),
      ),
    ).toHaveLength(0);
    // Keep the storage fault armed through all daemon retry attempts. A live
    // getQueue can still show entries while the first batch request is running.
    await expect
      .poll(
        () => relay.replies.find((reply) => reply.method === 'agent.sendQueuedMessagesNow')?.result,
      )
      .toMatchObject({ success: true, queued: true });
    await expect.poll(async () => (await owner('agent.getQueue', params)).queue.length).toBe(2);
    const restored = (await owner('agent.getQueue', params)).queue;
    expect(
      restored.map((row: any) => [row.id, row.turnId, row.submissionIds, row.author.principalId]),
    ).toEqual(
      before.map((row: any) => [row.id, row.turnId, row.submissionIds, row.author.principalId]),
    );
    await expect(component.getByTestId('queued-message-text')).toHaveText([
      'Persisted head',
      /Message from @functional-guest[\s\S]*Unpersisted tail$/,
    ]);
    await page.screenshot({ path: info.outputPath('optimistic-daemon-partial-restoration.png') });
    fault();
    await page.evaluate(() => window.__optimisticDaemon!.refresh());
    await component.getByRole('button', { name: 'Send all ready messages now' }).click();
    await expect.poll(async () => (await owner('agent.getQueue', params)).queue.length).toBe(0);
    const delivered = (await owner('agent.getConversation', params)).messages;
    for (const id of [
      `functional-persisted-head-${agent.id}`,
      `functional-unpersisted-tail-${agent.id}`,
    ])
      expect(
        delivered.filter((row: any) => row.metadata?.submissionIds?.includes(id)),
      ).toHaveLength(1);
    await component.unmount();
  } finally {
    fault();
    await info.attach('real-daemon-rpc-log', {
      body: JSON.stringify({ calls: relay.calls, errors: relay.errors }, null, 2),
      contentType: 'application/json',
    });
    relay.close();
    socket.close();
    guestSocket.close();
  }
});
