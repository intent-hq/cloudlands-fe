import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Read-only evidence from the task-owned daemon. Product selection, persistence and Send use UI.
function ownedRpc(method, params) {
  return new Promise((resolve, reject) => {
    const socket = connect('/owned/data/intentd.sock');
    let buffer = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('Owned daemon timeout')));
    socket.on('error', reject);
    socket.on('connect', () =>
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n'),
    );
    socket.on('data', (bytes) => {
      buffer += bytes.toString();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.id !== 1) continue;
        socket.end();
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  });
}

for (const width of [1280, 420]) {
  test(`owned ordinary note context draft and provider read at ${width}`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180000);
    const base = process.env.REACT_BASE_URL,
      fixturesPath = process.env.ISOLATED_NOTE_CONTEXT_FIXTURES;
    if (!base || !fixturesPath || process.env.ISOLATED_NOTE_CONTEXT_SEND !== 'owned-test-daemon')
      throw new Error('Requires owned provider runtime and note context fixtures');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));
    const fixture = fixtures.find((f) => f.width === width),
      other = fixtures.find((f) => f.width !== width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(180000);
    const { workspaceId, agentId, notes } = fixture;
    const selected = notes[0],
      sibling = notes[1];
    const beforeNotes = await ownedRpc('note.list', { workspaceId });
    const git = (...args) =>
      execFileSync('git', ['-C', fixture.repositoryPath, ...args], { encoding: 'utf8' }).trim();
    const repo = () => ({
      head: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'),
      index: git('ls-files', '--stage'),
      status: git('status', '--porcelain=v1'),
    });
    const beforeRepo = repo();
    expect(git('remote')).toBe('');
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      pushes = [],
      inputs = [],
      geometry = [];
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const r = JSON.parse(String(payload));
        requests.push(r);
        pending.set(r.id, r);
      });
      socket.on('framereceived', ({ payload }) => {
        const response = JSON.parse(String(payload)),
          request = pending.get(response.id);
        if (request) {
          pending.delete(response.id);
          replies.push({ request, response });
        }
        if (response.method === 'subscription.push') pushes.push(response.params);
      });
    });
    await page.exposeFunction('recordNoteContextInput', (event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      window.addEventListener(
        'keydown',
        (event) => window.recordNoteContextInput({ trusted: event.isTrusted, key: event.key }),
        true,
      );
    });
    const composer = page.getByTestId('conversation-composer'),
      textarea = composer.locator('textarea');
    const picker = composer.getByRole('combobox', { name: 'Add note context', exact: true });
    const send = composer.getByRole('button', { name: 'Send', exact: true });
    const chip = composer.getByTestId('composer-attachments');
    const ready = async () => {
      await expect(page.getByTestId('workspace-conversation')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30000 },
      );
      await expect(textarea).toBeEnabled({ timeout: 15000 });
      await expect(picker).toBeEnabled();
    };
    const sends = () => requests.filter((r) => r.method === 'agent.sendMessage');
    const pick = async (keyboard) => {
      await picker.click();
      await picker.fill(selected.id);
      const option = page.getByRole('option').filter({ hasText: selected.id });
      await expect(option).toBeVisible();
      if (keyboard) await picker.press('Enter');
      else await option.click();
      await expect(chip).toContainText(selected.title);
    };
    const capture = async (name) => {
      await composer.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      geometry.push(
        await composer.evaluate((node) => ({
          rect: node.getBoundingClientRect().toJSON(),
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      );
      expect(geometry.at(-1).scrollWidth).toBeLessThanOrEqual(width);
      await writeFile(
        info.outputPath(`${name}.png`),
        await stableLocatorScreenshot(page, composer),
      );
    };
    let history;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}`);
      await ready();
      await picker.click();
      await picker.press('Escape');
      expect(sends()).toHaveLength(0);
      await pick(true);
      await chip.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(chip).not.toContainText(selected.title);
      expect(sends()).toHaveLength(0);
      await pick(false);
      const prompt =
        'Read only the explicitly selected note using ws.note.read. Reply with its verification marker and nothing else. Do not read any other note or modify anything.';
      expect(prompt).not.toContain(selected.marker);
      expect(prompt).not.toContain(sibling.marker);
      await textarea.click();
      await textarea.pressSequentially(prompt);
      await expect(
        page.getByRole('listbox', { name: 'Add note context', exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(() =>
          replies.some(
            ({ request, response }) =>
              request.method === 'drafts.set' &&
              request.params.text === prompt &&
              request.params.attachments?.some(
                (ref) => ref.noteId === selected.id && ref.workspaceId === workspaceId,
              ) &&
              response.result?.ok,
          ),
        )
        .toBe(true);
      // Drafts are scoped to the app client identity; verify restoration through its real bridge.
      await capture('selected-note-context');
      await page.reload();
      await ready();
      await expect(textarea).toHaveValue(prompt);
      await expect(chip).toContainText(selected.title);
      expect(sends()).toHaveLength(0);
      const restoredDraft = replies
        .filter(({ request, response }) => request.method === 'drafts.get' && response.result)
        .at(-1)?.response.result;
      expect(JSON.stringify(restoredDraft)).toContain(selected.id);
      expect(JSON.stringify(restoredDraft)).not.toContain(selected.marker);
      await page.goto(`${base}/workspaces/${other.workspaceId}?agent=${other.agentId}`);
      await ready();
      await expect(chip).not.toContainText(selected.title);
      await page.goBack();
      await ready();
      await expect(textarea).toHaveValue(prompt);
      await expect(chip).toContainText(selected.title);
      await page.evaluate(async () => {
        const module = performance
          .getEntriesByType('resource')
          .find((entry) => new URL(entry.name).pathname.endsWith('/backend-transport-factory.ts'));
        if (!module) throw new Error('Owned transport module missing');
        const { resolveBackendTransport } = await import(module.name);
        const socket = resolveBackendTransport().socket;
        if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
          throw new Error('Owned socket not open');
        await new Promise((resolve) => {
          socket.addEventListener('close', resolve, { once: true });
          socket.close();
        });
      });
      await context.setOffline(true);
      await expect(page.getByTestId('workspace-conversation')).toHaveCount(0);
      await context.setOffline(false);
      await ready();
      await expect(textarea).toHaveValue(prompt);
      await expect(chip).toContainText(selected.title);
      expect(sends()).toHaveLength(0);
      await expect(send).toBeEnabled();
      await send.click();
      await expect.poll(() => sends().length).toBe(1);
      const wire = sends()[0].params;
      expect(wire.workspaceId).toBe(workspaceId);
      expect(wire.agentId).toBe(agentId);
      expect(wire.noteIds).toEqual([selected.id]);
      expect(wire.contextReferences).toEqual([
        { type: 'note', noteId: selected.id, metadata: { workspaceId } },
      ]);
      expect(wire.content).toContain('ws.note.read');
      expect(wire.content).toContain(selected.id);
      expect(wire.content).not.toContain(selected.marker);
      expect(wire.content).not.toContain(sibling.marker);
      await expect(page.locator('[data-message-role=assistant]').last()).toContainText(
        selected.marker,
        { timeout: 100000 },
      );
      await expect(send).toBeVisible({ timeout: 30000 });
      await expect(textarea).toHaveValue('');
      await expect(chip).not.toContainText(selected.title);
      history = await ownedRpc('agent.getConversation', { workspaceId, agentId });
      const persisted = JSON.stringify(history);
      expect(persisted).toContain(selected.marker);
      expect(persisted).not.toContain(sibling.marker);
      // Provider tool receipt, beyond the assistant's answer, must identify the selected note read.
      const blocks = history.messages.flatMap((message) => message.contentBlocks ?? []);
      const reads = blocks.filter((block) => block.type === 'tool_use');
      expect(reads).toHaveLength(1);
      expect(reads[0].name).toBe('workspace_api');
      expect(reads[0].input.code).toContain('ws.note.read(');
      expect(reads[0].input.code).toContain(selected.id);
      expect(reads[0].input.code).not.toContain(sibling.id);
      const receipt = blocks.find(
        (block) => block.type === 'tool_result' && block.tool_use_id === reads[0].toolCallId,
      );
      expect(receipt?.is_error).toBe(false);
      expect(JSON.stringify(receipt)).toContain(selected.marker);
      expect(
        history.messages.find((message) => message.role === 'user').metadata.contextReferences,
      ).toEqual(wire.contextReferences);
      await capture('provider-note-result');
      const answer = page.locator('[data-message-role=assistant]').last();
      await answer.scrollIntoViewIfNeeded();
      await writeFile(
        info.outputPath('provider-note-answer.png'),
        await stableLocatorScreenshot(page, answer),
      );
      await page.reload();
      await ready();
      await expect(page.locator('[data-message-role=assistant]').last()).toContainText(
        selected.marker,
      );
      expect(sends()).toHaveLength(1);
      expect(await ownedRpc('note.list', { workspaceId })).toEqual(beforeNotes);
      expect(repo()).toEqual(beforeRepo);
      for (const [path, hash] of Object.entries(fixture.files))
        expect(
          createHash('sha256')
            .update(await readFile(`${fixture.repositoryPath}/${path}`))
            .digest('hex'),
        ).toBe(hash);
      expect(
        requests.filter((r) =>
          [
            'note.create',
            'note.setContent',
            'file.write',
            'git.agentCommit',
            'agent.queueMessage',
          ].includes(r.method),
        ),
      ).toEqual([]);
      const lease = replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' && response.result?.subscriptionId,
        )
        .at(-1)?.response.result.subscriptionId;
      expect(lease).toBeTruthy();
      await page
        .getByTestId('workspace-overview')
        .getByRole('link', { name: 'Workspaces', exact: true })
        .click();
      await expect(page.getByTestId('workspace-conversation')).toHaveCount(0);
      await expect
        .poll(() =>
          replies.some(
            ({ request, response }) =>
              request.method === 'chat.unsubscribe' &&
              request.params.subscriptionId === lease &&
              response.result?.success,
          ),
        )
        .toBe(true);
      expect(inputs.some((e) => e.trusted && e.key === 'Enter')).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            fixture,
            requests,
            replies,
            pushes,
            inputs,
            geometry,
            history,
            errors,
            beforeRepo,
            afterRepo: repo(),
          },
          null,
          2,
        ),
      );
      await page.goto('about:blank');
    }
  });
}
