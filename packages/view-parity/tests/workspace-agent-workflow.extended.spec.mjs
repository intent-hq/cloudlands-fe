import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Compute the prospective tree from the index without writing Git objects or cache entries.
function treeFromIndex(index) {
  const root = new Map();
  for (const row of index.trim().split('\n')) {
    const [entry, path] = row.split('\t');
    const [mode, hash, stage] = entry.split(' ');
    if (stage !== '0') throw new Error('Unmerged fixture index');
    const parts = path.split('/');
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      if (!directory.has(part)) directory.set(part, new Map());
      directory = directory.get(part);
    }
    directory.set(parts.at(-1), { mode, hash });
  }
  const treeHash = (directory) => {
    const entries = [...directory]
      .map(([name, value]) => ({
        name,
        mode: value instanceof Map ? '40000' : value.mode,
        hash: value instanceof Map ? treeHash(value) : value.hash,
        sortName: name + (value instanceof Map ? '/' : ''),
      }))
      .sort((a, b) => Buffer.compare(Buffer.from(a.sortName), Buffer.from(b.sortName)));
    const body = Buffer.concat(
      entries.map(({ name, mode, hash }) =>
        Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(hash, 'hex')]),
      ),
    );
    return createHash('sha1')
      .update(Buffer.from(`tree ${body.length}\0`))
      .update(body)
      .digest('hex');
  };
  return treeHash(root);
}

// Socket calls only corroborate persisted state. Send, Stage and Commit use real UI input.
function ownedRead(method, params) {
  if (!['agent.getConversation', 'note.list'].includes(method))
    throw new Error('Only owned evidence reads are allowed');
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
  test(`owned provider edit to reviewed local commit at ${width}`, async ({ page }, info) => {
    test.setTimeout(240000);
    const base = process.env.REACT_BASE_URL;
    const fixturesPath = process.env.ISOLATED_AGENT_WORKFLOW_FIXTURES;
    if (
      !base ||
      !fixturesPath ||
      process.env.ISOLATED_AGENT_WORKFLOW_WRITES !== 'owned-test-daemon'
    )
      throw new Error('Requires an owned provider runtime and disposable coding fixtures');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixture = JSON.parse(await readFile(fixturesPath, 'utf8')).find((f) => f.width === width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(240000);
    const { workspaceId, agentId, repositoryPath: root } = fixture;
    expect(root).toMatch(/^\/owned\/workspaces\//);
    expect(fixture.originalRepositoryPath).toMatch(/^\/owned\/repositories\/agent-workflow-/);
    expect(root).not.toBe(fixture.originalRepositoryPath);
    const gitAt = (directory, ...args) =>
      execFileSync('git', ['-c', `safe.directory=${directory}`, '-C', directory, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      });
    const git = (...args) => gitAt(root, ...args);
    const original = (...args) => gitAt(fixture.originalRepositoryPath, ...args);
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    expect(git('remote')).toBe('');
    expect(git('status', '--porcelain')).toBe('');
    expect(original('diff', '--cached', '--name-only').trim()).toBe('unrelated-staged.txt');
    const initialIndex = git('ls-files', '--stage');
    const initialTree = git('rev-parse', 'HEAD^{tree}').trim();
    expect(treeFromIndex(initialIndex)).toBe(initialTree);
    const notesBefore = await ownedRead('note.list', { workspaceId });
    expect(await readFile(`${root}/${fixture.path}`, 'utf8')).toBe(fixture.initial);
    const errors = await observeErrors(page);
    const requests = [],
      replies = [],
      inputs = [],
      geometry = [],
      proof = {};
    let conversation;
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
        if (request) {
          pending.delete(response.id);
          replies.push({ request, response });
        }
      });
    });
    await page.exposeBinding('__agentWorkflowInput', (_source, event) => inputs.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      for (const type of ['keydown', 'input', 'click'])
        window.addEventListener(
          type,
          (event) => {
            window.__agentWorkflowInput({ type, key: event.key, trusted: event.isTrusted });
          },
          true,
        );
    });
    const activate = async (locator) => {
      await expect(locator).toBeEnabled();
      if (width === 1280) {
        await locator.focus();
        await locator.press('Enter');
      } else await locator.click();
    };
    const capture = async (label, target) => {
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const box = await target.boundingBox();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
      geometry.push({ label, box, width, scrollWidth });
      const viewport = box.height > 900;
      const locator = viewport
        ? {
            evaluate: (...args) => target.evaluate(...args),
            screenshot: (options) => page.screenshot(options),
          }
        : target;
      const attempts = [];
      await writeFile(
        info.outputPath(`${label}.png`),
        await stableLocatorScreenshot(page, locator, ({ png: _png, ...attempt }) =>
          attempts.push(attempt),
        ),
      );
      await writeFile(
        info.outputPath(`${label}-stability.json`),
        JSON.stringify({ viewport, attempts }, null, 2),
      );
    };
    const composer = page.getByTestId('conversation-composer');
    const textarea = composer.locator('textarea');
    const send = composer.getByRole('button', { name: 'Send', exact: true });
    const overview = page.getByTestId('workspace-overview');
    const changes = page.getByTestId('workspace-git-status');
    const diff = page.getByTestId('workspace-diff');
    const diffBody = page.getByTestId('workspace-diff-content');
    const commit = page.getByTestId('workspace-git-commit');
    const history = page.getByTestId('workspace-commit-history');
    const changedRow = (staged) => changes.locator(`a[data-git-row="${staged}:${fixture.path}"]`);
    const method = (name) => requests.filter((r) => r.method === name);
    const readModels = () =>
      page.evaluate(async () => {
        const module = performance
          .getEntriesByType('resource')
          .find((entry) =>
            new URL(entry.name).pathname.endsWith('/src/lib/utils/monaco-workers.ts'),
          );
        if (!module) throw new Error('Monaco provenance missing');
        const { monaco } = await import(module.name);
        return monaco.editor.getModels().map((model) => model.getValue(undefined, true));
      });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}`);
      await expect(page.getByTestId('workspace-conversation')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30000 },
      );
      await expect(textarea).toBeEnabled();
      await activate(composer.getByRole('button', { name: 'Add repository file', exact: true }));
      const picker = page.getByRole('dialog', { name: 'Add repository file' });
      await activate(picker.getByRole('button', { name: 'Search files...', exact: true }));
      await picker.getByRole('searchbox').pressSequentially('greeting.ts');
      await activate(picker.getByRole('button', { name: fixture.path, exact: true }));
      await expect(composer.getByTestId('composer-attachments')).toContainText(fixture.path);
      const prompt =
        'Read the selected src/greeting.ts file, then change only the greeting string from "Hello" to "Hello, world!". Preserve every other byte, including the comment and final newline. Use the file read and patch tools; do not run shell commands, tests, Git commands, or network requests. Do not touch any other file or note, stage, or commit. After the edit, reply with the verification marker from the file.';
      expect(prompt).not.toContain(fixture.marker);
      await textarea.click();
      await textarea.pressSequentially(prompt);
      await capture('agent-edit-request', composer);
      await activate(send);
      await expect.poll(() => method('agent.sendMessage').length).toBe(1);
      const wire = method('agent.sendMessage')[0].params;
      expect(wire.contextReferences).toEqual([
        {
          type: 'file',
          filePath: fixture.path,
          metadata: { workspaceId, rootPath: root },
        },
      ]);
      expect(wire.fileBlocks ?? []).toEqual([]);
      expect(wire.content).not.toContain(fixture.marker);
      // No test-side write can satisfy this assertion: only the provider owns the edit.
      await expect
        .poll(() => readFile(`${root}/${fixture.path}`, 'utf8'), { timeout: 150000 })
        .toBe(fixture.expected);
      await expect(page.locator('[data-message-role=assistant]').last()).toContainText(
        fixture.marker,
        { timeout: 30000 },
      );
      await expect(send).toBeVisible({ timeout: 30000 });
      await expect(textarea).toHaveValue('');
      conversation = await ownedRead('agent.getConversation', { workspaceId, agentId });
      const blocks = conversation.messages.flatMap((message) => message.contentBlocks ?? []);
      const tools = blocks.filter((block) => block.type === 'tool_use');
      expect(tools.length).toBeGreaterThanOrEqual(2);
      const readsSelectedFile = (tool) => {
        if (tool.input?._acpTitle === `Read file '${root}/${fixture.path}'`) return true;
        if (tool.name !== 'workspace_api' || typeof tool.input?.code !== 'string') return false;
        const paths = [
          ...tool.input.code.matchAll(/\bws\.file\.read\(\s*(['"])(.*?)\1\s*\)/gs),
        ].map((match) => match[2]);
        const calls = [...tool.input.code.matchAll(/\bws\.([\w.]+)\s*\(/g)].map(
          (match) => match[1],
        );
        return (
          paths.length > 0 &&
          paths.every((path) => path === fixture.path) &&
          calls.length === paths.length &&
          calls.every((call) => call === 'file.read')
        );
      };
      const fileRead = tools.find(readsSelectedFile);
      expect(fileRead).toBeTruthy();
      const readReceipt = blocks.find(
        (block) => block.type === 'tool_result' && block.tool_use_id === fileRead.toolCallId,
      );
      expect(readReceipt?.is_error).toBe(false);
      if (fileRead.name === 'workspace_api')
        expect(JSON.stringify(readReceipt.output)).toContain(fixture.marker);
      else expect(readReceipt.output).toEqual({ exit_code: 0 });
      for (const tool of tools) {
        expect(tool.metadata.status).toBe('completed');
        const receipt = blocks.find(
          (block) => block.type === 'tool_result' && block.tool_use_id === tool.toolCallId,
        );
        if (receipt) expect(receipt.is_error).toBe(false);
        // The provider adapter records completed edits without a separate tool_result.
        // Exact disk/index/diff checks below corroborate that completion.
        expect(
          readsSelectedFile(tool) ||
            (tool.metadata.toolKind === 'file' && /edit|patch|write/i.test(tool.name)),
        ).toBe(true);
      }
      expect(tools.some((tool) => /edit|patch|write/i.test(JSON.stringify(tool)))).toBe(true);
      expect(conversation.messages.filter((message) => message.role === 'user')).toHaveLength(1);
      expect(
        conversation.messages.find((message) => message.role === 'user').metadata.contextReferences,
      ).toEqual(wire.contextReferences);
      expect(git('ls-files', '--stage')).toBe(initialIndex);
      expect(git('diff', '--name-only').trim()).toBe(fixture.path);
      expect(git('diff', '--cached')).toBe('');
      expect(git('rev-parse', 'HEAD').trim()).toBe(fixture.baseSha);
      await capture(
        'provider-completed-edit',
        page.locator('[data-message-role=assistant]').last(),
      );
      proof.providerDiff = git('diff', '--', fixture.path);
      proof.providerTools = tools;
      // External/provider writes use the delivered explicit Refresh action.
      await activate(
        page
          .getByTestId('workspace-conversation')
          .getByRole('link', { name: 'Back to Workspace', exact: true }),
      );
      await activate(changes.locator('[data-changes-refresh]'));
      await expect(changedRow(false)).toBeVisible({ timeout: 15000 });
      await activate(changedRow(false));
      await expect(diffBody).toContainText('Hello, world!');
      await expect(diffBody).toContainText('Hello');
      await capture('review-provider-diff', diff);
      await activate(
        diff.locator(`[data-git-write="stage"][data-git-write-path="${fixture.path}"]`),
      );
      await expect.poll(() => git('show', `:${fixture.path}`)).toBe(fixture.expected);
      expect(git('diff', '--cached', '--name-only').trim()).toBe(fixture.path);
      expect(git('diff')).toBe('');
      proof.stagedDiff = git('diff', '--cached', '--', fixture.path);
      expect(proof.stagedDiff).toBe(proof.providerDiff);
      const stagedIndex = git('ls-files', '--stage');
      const expectedTree = treeFromIndex(stagedIndex);
      await activate(diff.getByRole('link', { name: 'Back', exact: true }));
      await expect(changedRow(true)).toBeFocused();
      await expect(changedRow(false)).toHaveCount(0);
      const message = `Reviewed agent greeting edit ${width}`;
      await commit.getByLabel('Commit Message', { exact: true }).pressSequentially(message);
      await expect(commit.getByLabel('Commit Message', { exact: true })).toHaveValue(message);
      await capture('review-current-index', changes);
      await activate(commit.locator('[data-git-commit]'));
      await expect(commit.getByText('Commit confirmed', { exact: true })).toBeVisible({
        timeout: 30000,
      });
      const sha = await commit.locator('[data-commit-hash]').textContent();
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(git('rev-parse', 'HEAD').trim()).toBe(sha);
      expect(git('rev-parse', 'HEAD^{tree}').trim()).toBe(expectedTree);
      expect(git('rev-parse', 'HEAD^').trim()).toBe(fixture.baseSha);
      expect(git('rev-list', '--count', `${fixture.baseSha}..HEAD`).trim()).toBe('1');
      expect(git('diff-tree', '--no-commit-id', '--name-only', '-r', sha).trim()).toBe(
        fixture.path,
      );
      expect(git('show', `${sha}:${fixture.path}`)).toBe(fixture.expected);
      expect(git('log', '-1', '--format=%B').trim()).toBe(message);
      expect(git('ls-files', '--stage')).toBe(stagedIndex);
      expect(git('status', '--porcelain')).toBe('');
      expect(expectedTree).not.toBe(initialTree);
      Object.assign(proof, { sha, expectedTree, message, stagedIndex });
      await capture('commit-confirmed', changes);
      await activate(history.getByRole('button', { name: 'Refresh', exact: true }));
      const entry = history.locator(`[data-history-entry="${sha}"]`);
      await expect(entry).toBeVisible({ timeout: 15000 });
      await activate(entry.getByRole('button'));
      await activate(entry.locator(`[data-history-file="${fixture.path}"]`));
      await expect(diff).toHaveAttribute('data-diff-commit', sha);
      await expect(diffBody).toContainText('Hello, world!');
      await expect(diff.locator('[data-git-write]')).toHaveCount(0);
      await capture('committed-file-history', diff);
      await activate(diff.getByRole('link', { name: 'Back', exact: true }));
      await expect(entry.locator(`[data-history-file="${fixture.path}"]`)).toBeFocused();
      await page.reload();
      const browser = page.getByTestId('workspace-file-browser');
      const treeRow = (path) =>
        browser.locator(`[data-explorer-path=${JSON.stringify(`${root}/${path}`)}]`);
      await expect(treeRow('src')).toBeVisible({ timeout: 30000 });
      await activate(treeRow('src'));
      await activate(treeRow(fixture.path));
      await expect(page.getByRole('textbox', { name: 'Workspace text editor' })).toBeVisible({
        timeout: 30000,
      });
      await expect(page.getByTestId('workspace-file-save')).toBeDisabled();
      expect(await readModels()).toEqual([fixture.expected]);
      await capture('reopened-agent-edit', page.getByTestId('workspace-file'));
      await activate(
        page.getByTestId('workspace-file').getByRole('link', { name: 'Back', exact: true }),
      );
      await expect(treeRow(fixture.path)).toBeFocused();
      expect(await readFile(`${root}/sentinel.txt`, 'utf8')).toBe(fixture.sentinel);
      expect(await ownedRead('note.list', { workspaceId })).toEqual(notesBefore);
      expect(original('rev-parse', 'HEAD').trim()).toBe(fixture.baseSha);
      expect(original('ls-files', '--stage').trim()).toBe(fixture.originalIndex);
      expect(original('status', '--porcelain=v1').trim()).toBe(fixture.originalStatus);
      expect(await readFile(`${fixture.originalRepositoryPath}/${fixture.path}`, 'utf8')).toBe(
        fixture.initial,
      );
      for (const [path, hash] of Object.entries(fixture.originalFiles))
        expect(digest(await readFile(`${fixture.originalRepositoryPath}/${path}`))).toBe(hash);
      const lease = replies
        .filter(
          ({ request, response }) =>
            request.method === 'chat.subscribe' && response.result?.subscriptionId,
        )
        .at(-1)?.response.result.subscriptionId;
      expect(lease).toBeTruthy();
      await activate(overview.getByRole('link', { name: 'Workspaces', exact: true }));
      await expect(page.getByTestId('workspace-list')).toBeVisible();
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
      expect(await readModels()).toEqual([]);
      expect(method('agent.sendMessage')).toHaveLength(1);
      expect(method('git.stage')).toHaveLength(1);
      expect(method('git.agentCommit')).toHaveLength(1);
      expect(
        requests.filter((r) =>
          /^(file\.write|note\.(create|setContent)|agent\.queueMessage|git\.(push|reset|discard|amend|unstage))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(inputs.some((event) => event.type === 'keydown' && event.trusted)).toBe(true);
      expect(inputs.some((event) => event.type === 'input' && event.trusted)).toBe(true);
      expect(errors).toEqual([]);
      proof.finalIndex = git('ls-files', '--stage');
    } finally {
      await writeFile(
        info.outputPath('agent-workflow-evidence.json'),
        JSON.stringify(
          {
            fixture,
            proof,
            requests,
            replies,
            inputs,
            geometry,
            conversation,
            errors,
            finalStatus: git('status', '--porcelain'),
            finalBytes: await readFile(`${root}/${fixture.path}`, 'utf8'),
          },
          null,
          2,
        ),
      );
      await page.goto('about:blank');
    }
  });
}
