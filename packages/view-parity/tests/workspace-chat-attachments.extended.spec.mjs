import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Mutates only the independently attested isolated daemon, through native public controls.
test('isolated chooser attachments register, restore, remove and send genuine image/file blocks', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const {
    REACT_BASE_URL: base,
    ISOLATED_CHAT_FIXTURE: fixturePath,
    ISOLATED_CHAT_SOCKET_PROOF: proofPath,
    ISOLATED_ATTACHMENT_FILES: filesRoot,
  } = process.env;
  if (
    !base ||
    !fixturePath ||
    !proofPath ||
    !filesRoot ||
    process.env.ISOLATED_CHAT_ALLOW_SEND !== 'owned-test-daemon'
  )
    throw new Error('Owned isolated daemon, peer proof and authored file fixtures required');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  expect(proof.passed).toBe(true);
  expect(proof.peerPid).toBe(fixture.daemon.pid);
  expect(proof.socket).toBe(fixture.hostSocket);
  expect(fixture.workspacePath).toMatch(/^\/owned\/workspaces\//);
  expect(new URL(base).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const { workspaceId, agentId } = fixture;
  const files = ['safe-shapes.png', 'safe-note.txt'];
  const errors = await observeErrors(page),
    requests = [],
    replies = [],
    pushes = [],
    inputs = [],
    registry = [],
    geometry = [];
  await page.exposeBinding('__attachmentInputEvidence', (_source, event) => inputs.push(event));
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    for (const type of ['click', 'keydown', 'input', 'change'])
      window.addEventListener(
        type,
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-testid=conversation-composer]')
          )
            window.__attachmentInputEvidence({
              type,
              trusted: event.isTrusted,
              key: event.key,
              inputType:
                event.target instanceof window.HTMLInputElement ? event.target.type : undefined,
              files:
                event.target instanceof window.HTMLInputElement
                  ? Array.from(event.target.files ?? []).map((file) => ({
                      name: file.name,
                      size: file.size,
                      type: file.type,
                    }))
                  : undefined,
            });
        },
        true,
      );
  });
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
      if (r.method === 'subscription.push') pushes.push(r.params);
      const request = pending.get(r.id);
      pending.delete(r.id);
      if (request) replies.push({ request, response: r });
    });
  });
  const rpc = (method, params) =>
    page.evaluate(
      async ({ method, params }) => {
        const module = performance
          .getEntriesByType('resource')
          .find((e) => new URL(e.name).pathname.endsWith('/features/backend/backend-transport.ts'));
        if (!module) throw new Error('Canonical React backend transport missing');
        const { backendRequest } = await import(module.name);
        return backendRequest(method, params);
      },
      { method, params },
    );
  const composer = page.getByTestId('conversation-composer'),
    textarea = composer.locator('textarea');
  const chips = composer.getByTestId('composer-attachments');
  const ready = async () => {
    await expect(page.getByTestId('workspace-conversation')).toHaveAttribute('data-ready', 'true', {
      timeout: 30000,
    });
    await expect(textarea).toBeEnabled({ timeout: 15000 });
    await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
      timeout: 30000,
    });
  };
  const choose = async (names) => {
    const chooser = page.waitForEvent('filechooser');
    await composer.getByRole('button', { name: 'Attach files', exact: true }).click();
    await (await chooser).setFiles(names.map((name) => path.join(filesRoot, name)));
  };
  const placed = () =>
    replies.filter(
      (r) => r.request.method === 'file.placeAttachment' && r.response.result?.attachmentId,
    );
  const sendCount = () => requests.filter((r) => r.method === 'agent.sendMessage').length;
  let history, user, assistant;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}`);
    await ready();
    const actual = await rpc('agent.get', { workspaceId, agentId });
    expect(actual.agent.workspaceId).toBe(workspaceId);
    expect(actual.agent.provider).toBe(fixture.provider);
    expect(await chips.locator('[data-placement-status]').count()).toBe(0);
    // A real chunked-size local file keeps selection work observable while the
    // user removes it. No response, readiness, state or File handle is injected.
    const cancelledName = 'cancel-selection.txt';
    const cancelledBytes = await readFile(path.join(filesRoot, cancelledName));
    expect(cancelledBytes.length).toBe(26 * 1024 * 1024);
    await choose([cancelledName]);
    await expect(chips.locator('[data-placement-status=placing]')).toHaveCount(1);
    const beforeRemoval = requests.length;
    await chips.getByRole('button', { name: 'Remove attachment', exact: true }).click();
    await expect(chips).not.toContainText(cancelledName);
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            requests.slice(beforeRemoval).includes(r.request) &&
            r.request.method === 'drafts.set' &&
            (r.request.params.attachments ?? []).length === 0 &&
            r.response.result?.ok,
        ),
      )
      .toBe(true);
    const clearedDraft = await rpc('drafts.get', { workspaceId, agentId });
    expect(clearedDraft?.attachments ?? []).toEqual([]);
    expect(sendCount()).toBe(0);
    const token = `ATTACHMENTS_${Date.now()}`;
    const prompt = `These are safe test attachments. Reply exactly ${token}. Do not use tools, run commands, read other files, delegate, or change any state.`;
    await textarea.fill(prompt);
    await choose(files);
    await expect.poll(() => placed().length).toBe(2);
    await expect(chips.locator('[data-placement-status=placed]')).toHaveCount(2);
    for (const r of placed()) {
      const result = r.response.result,
        bytes = await readFile(path.join(filesRoot, r.request.params.fileName));
      expect(r.request.params.workspaceId).toBe(workspaceId);
      expect(r.request.params.idempotencyKey).toBeTruthy();
      expect(Buffer.from(r.request.params.data, 'base64')).toEqual(bytes);
      const meta = await rpc('file.getAttachmentInfo', {
        workspaceId,
        attachmentId: result.attachmentId,
      });
      expect(meta).toMatchObject({
        attachmentId: result.attachmentId,
        fileName: result.fileName,
        size: bytes.length,
        exists: true,
      });
      expect(meta.path).toMatch(/^\.intent\/attachments\//);
      const read = await rpc('file.readChunk', {
        workspaceId,
        path: meta.path,
        offset: 0,
        length: 1024,
      });
      expect(read.bytesRead).toBe(bytes.length);
      expect(Buffer.from(read.content, 'base64')).toEqual(bytes);
      registry.push({
        ...meta,
        originalFileName: r.request.params.fileName,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'drafts.set' &&
            r.request.params.attachments?.length === 2 &&
            r.request.params.attachments.every((a) => a.attachmentId) &&
            r.response.result?.ok,
        ),
      )
      .toBe(true);
    await page.reload();
    await ready();
    await expect(chips.locator('[data-placement-status]')).toHaveCount(0); // Restored references need no upload lifecycle.
    await expect(chips).toContainText(
      registry.find((item) => item.originalFileName === files[0]).fileName,
    );
    await expect(chips).toContainText(
      registry.find((item) => item.originalFileName === files[1]).fileName,
    );
    await expect(textarea).toHaveValue(prompt);
    expect(placed()).toHaveLength(2);
    expect(sendCount()).toBe(0);
    // Public remove updates the persisted draft without deleting the registered file.
    await chips.getByRole('button', { name: 'Remove attachment', exact: true }).last().click();
    await expect(chips).not.toContainText(
      registry.find((item) => item.originalFileName === files[1]).fileName,
    );
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'drafts.set' &&
            r.request.params.text === prompt &&
            r.request.params.attachments?.length === 1 &&
            r.response.result?.ok,
        ),
      )
      .toBe(true);
    await page.reload();
    await ready();
    await expect(chips).not.toContainText(
      registry.find((item) => item.originalFileName === files[1]).fileName,
    );
    await expect(chips).toContainText(
      registry.find((item) => item.originalFileName === files[0]).fileName,
    );
    await choose([files[1]]);
    await expect.poll(() => placed().length).toBe(3);
    await expect(chips.locator('[data-placement-status=placed]')).toHaveCount(1);
    const submittedIds = [
      registry.find((item) => item.originalFileName === files[0]).attachmentId,
      placed().at(-1).response.result.attachmentId,
    ];
    for (const width of [1280, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await composer.scrollIntoViewIfNeeded();
      const rect = await composer.boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      geometry.push({ width, rect });
      await writeFile(
        info.outputPath(`composer-${width}.png`),
        await stableLocatorScreenshot(page, composer),
      );
    }
    await textarea.press('Enter');
    await expect.poll(sendCount).toBe(1);
    const request = requests.find((r) => r.method === 'agent.sendMessage');
    expect(request.params.imageBlocks).toEqual([
      { type: 'image', attachmentId: submittedIds[0], mimeType: 'image/png' },
    ]);
    expect(request.params.fileBlocks).toEqual([
      {
        type: 'file',
        attachmentId: submittedIds[1],
        fileName: placed().at(-1).response.result.fileName,
        mimeType: 'text/plain',
        size: (await readFile(path.join(filesRoot, files[1]))).length,
      },
    ]);
    await expect(page.locator('[data-message-role=assistant]').last()).toContainText(token, {
      timeout: 90000,
    });
    expect(pushes.some((p) => p.kind === 'delta' && JSON.stringify(p).includes(token))).toBe(true);
    await expect(textarea).toHaveValue('');
    await expect(chips).not.toContainText(
      registry.find((item) => item.originalFileName === files[0]).fileName,
    );
    history = await rpc('agent.getConversation', { workspaceId, agentId, limit: 50 });
    user = history.messages.find(
      (m) => m.role === 'user' && JSON.stringify(m.contentBlocks).includes(token),
    );
    assistant = history.messages.find(
      (m) => m.role === 'assistant' && JSON.stringify(m.contentBlocks).includes(token),
    );
    expect(user?.id).toBeTruthy();
    expect(assistant?.seq).toBeGreaterThan(user.seq);
    for (const id of submittedIds)
      expect(user.contentBlocks.some((b) => b.attachmentId === id)).toBe(true);
    await page.reload();
    await ready();
    const row = page.locator(`[data-message-id="${user.id}"]`);
    const image = row.locator('img');
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((i) => ({
        width: i.naturalWidth,
        height: i.naturalHeight,
        complete: i.complete,
      })),
    ).toEqual({ width: 96, height: 64, complete: true });
    await expect(row).toContainText(placed().at(-1).response.result.fileName);
    expect(sendCount()).toBe(1);
    await row.scrollIntoViewIfNeeded();
    await writeFile(
      info.outputPath('persisted-attachments.png'),
      await stableLocatorScreenshot(page, row),
    );
    const lastLease = replies
      .filter((r) => r.request.method === 'chat.subscribe' && r.response.result?.subscriptionId)
      .at(-1).response.result.subscriptionId;
    await page
      .getByTestId('workspace-overview')
      .getByRole('link', { name: 'Workspaces', exact: true })
      .click();
    await expect(page.getByTestId('workspace-conversation')).toHaveCount(0);
    await expect
      .poll(() =>
        replies.some(
          (r) =>
            r.request.method === 'chat.unsubscribe' &&
            r.request.params.subscriptionId === lastLease &&
            r.response.result?.success,
        ),
      )
      .toBe(true);
    expect(inputs.some((e) => e.type === 'change' && e.files?.length === 2 && e.trusted)).toBe(
      true,
    );
    // The public paperclip invokes input.click(); visible activation and chooser
    // input/change remain trusted. Preserve the internal click in the receipt.
    expect(inputs.every((e) => e.trusted || (e.type === 'click' && e.inputType === 'file'))).toBe(
      true,
    );
    expect(
      requests.filter((r) =>
        ['file.write', 'file.delete', 'workspace.create', 'agent.create'].includes(r.method),
      ),
    ).toEqual([]);
    expect(
      history.messages.some((message) =>
        JSON.stringify(message.contentBlocks).includes(cancelledName),
      ),
    ).toBe(false);
    expect(
      requests.filter(
        (r) => r.method === 'file.placeAttachment' && r.params.fileName === cancelledName,
      ),
    ).toEqual([]);
    const cancelledUpload = replies.find(
      (r) =>
        r.request.method === 'file.attachmentUpload.begin' &&
        r.request.params.fileName === cancelledName,
    )?.response.result;
    if (cancelledUpload?.uploadId) {
      expect(
        requests.some(
          (r) =>
            r.method === 'file.attachmentUpload.abort' &&
            r.params.uploadId === cancelledUpload.uploadId,
        ),
      ).toBe(true);
      expect(
        requests.some(
          (r) =>
            r.method === 'file.attachmentUpload.commit' &&
            r.params.uploadId === cancelledUpload.uploadId,
        ),
      ).toBe(false);
    }
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('attachments-wire-and-geometry.json'),
      JSON.stringify(
        {
          fixture,
          proof,
          requests,
          replies,
          pushes,
          inputs,
          registry,
          geometry,
          history,
          user,
          assistant,
          errors,
        },
        null,
        2,
      ),
    );
  }
});
