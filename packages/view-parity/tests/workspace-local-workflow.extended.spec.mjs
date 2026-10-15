import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const width of [1280, 420]) {
  test(`owned local creation to file edit and commit at ${width}`, async ({ page }, info) => {
    test.setTimeout(210000);
    const base = process.env.REACT_BASE_URL;
    const fixturePath = process.env.ISOLATED_LOCAL_WORKFLOW_FIXTURES;
    if (!base || !fixturePath || process.env.ISOLATED_LOCAL_WORKFLOW_WRITES !== 'owned-test-daemon')
      throw new Error('Explicit owned local workflow fixtures required');
    expect(new URL(base).hostname).toBe('127.0.0.1');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')).find((f) => f.width === width);
    expect(Date.parse(fixture.expiresAt) - Date.now()).toBeGreaterThan(210000);
    expect(fixture.repositoryPath).toMatch(/^\/owned\/repositories\/local-workflow-/);
    expect(fixture.peer.pid).toBeGreaterThan(0);
    const gitAt = (root, ...args) =>
      execFileSync('git', ['-c', `safe.directory=${root}`, '-C', root, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      });
    expect(gitAt(fixture.repositoryPath, 'remote')).toBe('');
    expect(gitAt(fixture.repositoryPath, 'rev-parse', 'HEAD').trim()).toBe(fixture.baseSha);
    const sourceIndex = gitAt(fixture.repositoryPath, 'ls-files', '--stage');
    const sourceBytes = await readFile(`${fixture.repositoryPath}/${fixture.file}`);
    const errors = await observeErrors(page);
    const requests = [],
      replies = [],
      events = [],
      geometry = [],
      proof = {};
    await page.exposeBinding('__localWorkflowEvidence', (_source, event) => events.push(event));
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(10000);
      for (const type of ['click', 'keydown', 'input'])
        window.addEventListener(
          type,
          (event) => {
            if (event.target instanceof Element)
              window.__localWorkflowEvidence({ type, key: event.key, trusted: event.isTrusted });
          },
          true,
        );
    });
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const pending = new Map();
      socket.on('framesent', ({ payload }) => {
        const request = JSON.parse(String(payload));
        requests.push(request);
        pending.set(request.id, request);
      });
      socket.on('framereceived', ({ payload }) => {
        const response = JSON.parse(String(payload)),
          request = pending.get(response.id);
        if (request) {
          pending.delete(response.id);
          replies.push({ request, response });
        }
      });
    });
    const activate = async (locator) => {
      await expect(locator).toBeEnabled();
      if (width === 1280) {
        await locator.focus();
        await expect(locator).toBeFocused();
        await page.keyboard.press('Enter');
      } else await locator.click();
    };
    const capture = async (label, target) => {
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const box = await target.boundingBox();
      geometry.push({
        label,
        box,
        width,
        scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
      });
      const attempts = [];
      const viewport = box.height > 900;
      const locator = viewport
        ? {
            evaluate: (...args) => target.evaluate(...args),
            screenshot: (options) => page.screenshot(options),
          }
        : target;
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
    const overview = page.getByTestId('workspace-overview');
    const browser = page.getByTestId('workspace-file-browser');
    const file = page.getByTestId('workspace-file');
    const editor = page.getByRole('textbox', { name: 'Workspace text editor' });
    const save = page.getByTestId('workspace-file-save');
    const changes = page.getByTestId('workspace-git-status');
    const diff = page.getByTestId('workspace-diff');
    const diffBody = page.getByTestId('workspace-diff-content');
    const commit = page.getByTestId('workspace-git-commit');
    const history = page.getByTestId('workspace-commit-history');
    const changedRow = (staged) => changes.locator(`a[data-git-row="${staged}:${fixture.file}"]`);
    let workspaceId, root, hash;
    const readEditor = () =>
      page.evaluate(async () => {
        const module = performance
          .getEntriesByType('resource')
          .find((entry) =>
            new URL(entry.name).pathname.endsWith('/src/lib/utils/monaco-workers.ts'),
          );
        if (!module) throw new Error('Monaco provenance missing');
        const { monaco } = await import(module.name);
        return {
          models: monaco.editor.getModels().map((model) => model.getValue(undefined, true)),
          editors: monaco.editor
            .getEditors()
            .map((view) => ({ selection: view.getSelection(), position: view.getPosition() })),
        };
      });
    const readOwners = () =>
      page.evaluate(async () => {
        const module = performance
          .getEntriesByType('resource')
          .find((entry) => new URL(entry.name).pathname.endsWith('/src/store/index.ts'));
        if (!module) throw new Error('App Store provenance missing');
        const { store } = await import(module.name);
        return {
          files: store.state.files,
          explorer: store.state.fileExplorer,
          git: store.state.git,
          gitWrite: store.state.gitWrite,
          changes: store.state.changes,
        };
      });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces`);
      await expect(page.getByTestId('workspace-list')).toBeVisible({ timeout: 30000 });
      await activate(page.getByRole('button', { name: 'New workspace', exact: true }));
      const form = page
        .getByRole('dialog')
        .filter({ has: page.getByTestId('workspace-local-create') });
      await form.getByLabel('Repository folder', { exact: true }).fill(fixture.repositoryPath);
      await form.getByLabel('Base branch or ref', { exact: true }).fill(fixture.baseRef);
      await capture('create-workspace', form);
      await activate(form.getByRole('button', { name: 'Create workspace', exact: true }));
      await expect
        .poll(
          () =>
            replies.filter(
              (r) => r.request.method === 'workspace.create' && r.response.result?.workspace?.id,
            ).length,
          { timeout: 130000 },
        )
        .toBe(1);
      const created = replies.find(
        (r) => r.request.method === 'workspace.create' && r.response.result?.workspace?.id,
      );
      workspaceId = created.response.result.workspace.id;
      await expect(overview).toHaveAttribute('data-workspace-id', workspaceId, { timeout: 30000 });
      await expect(overview.getByRole('heading', { level: 1 })).toHaveText('Untitled');
      if (width === 1280)
        await expect(page.locator(`[data-navigation-workspace="${workspaceId}"]`)).toContainText(
          'Untitled',
        );
      const workspace = created.response.result.workspace;
      root = workspace.worktreePath;
      expect(root).toMatch(/^\/owned\/workspaces\/[^.][^\n]+$/);
      expect(root.split('/')).not.toContain('..');
      expect(root).not.toBe(fixture.repositoryPath);
      const git = (...args) => gitAt(root, ...args);
      expect(git('rev-parse', 'HEAD').trim()).toBe(fixture.baseSha);
      expect(git('remote')).toBe('');
      const initialIndex = git('ls-files', '--stage');
      const unrelated = await readFile(`${root}/unrelated.txt`);
      expect(await readFile(`${root}/${fixture.file}`)).toEqual(sourceBytes);
      const treeRow = (relative) =>
        browser.locator(`[data-explorer-path=${JSON.stringify(`${root}/${relative}`)}]`);
      for (const path of ['notes', 'notes/nested']) {
        await expect(treeRow(path)).toBeVisible({ timeout: 30000 });
        await activate(treeRow(path));
        await expect(treeRow(path)).toHaveAttribute('aria-expanded', 'true');
      }
      await activate(treeRow(fixture.file));
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(save).toBeDisabled();
      await page.getByTestId('workspace-text-editor').click({ position: { x: 120, y: 35 } });
      await expect(editor).toBeFocused();
      await page.keyboard.press('Control+End');
      const edit = `Saved locally at width ${width}`;
      await page.keyboard.type(edit);
      await page.keyboard.press('Enter');
      await expect(save).toBeEnabled();
      const editorBeforeStay = await readEditor();
      await activate(file.getByRole('link', { name: 'Back', exact: true }));
      const guard = page.getByRole('dialog');
      await expect(guard).toBeVisible();
      await capture('unsaved-stay', guard);
      await activate(guard.getByRole('button', { name: 'Stay', exact: true }));
      await expect(editor).toBeFocused();
      expect(new URL(page.url()).searchParams.get('file')).toBe(fixture.file);
      expect(await readEditor()).toEqual(editorBeforeStay);
      expect(await readFile(`${root}/${fixture.file}`)).toEqual(sourceBytes);
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(0);
      await activate(save);
      await expect(page.getByTestId('workspace-file-content')).toHaveAttribute(
        'data-file-dirty',
        'false',
        { timeout: 15000 },
      );
      const expected = Buffer.from(`${fixture.initialContent}${edit}\r\n`);
      expect(await readFile(`${root}/${fixture.file}`)).toEqual(expected);
      expect(git('ls-files', '--stage')).toBe(initialIndex);
      await file.getByRole('heading', { name: fixture.file, exact: true }).focus();
      await capture('saved-editor', file);
      await activate(file.getByRole('link', { name: 'Back', exact: true }));
      await expect(treeRow(fixture.file)).toBeFocused();
      await activate(changes.getByRole('button', { name: 'Refresh git status', exact: true }));
      await expect(changedRow(false)).toBeVisible({ timeout: 15000 });
      await activate(changedRow(false));
      await expect(diffBody).toContainText(edit);
      await expect(diffBody).toContainText('Edit this existing file.');
      await capture('review-diff', diff);
      await activate(
        diff.locator(`[data-git-write="stage"][data-git-write-path="${fixture.file}"]`),
      );
      await expect.poll(() => git('show', `:${fixture.file}`)).toBe(expected.toString());
      expect(await readFile(`${root}/${fixture.file}`)).toEqual(expected);
      expect(git('diff', '--cached', '--name-only').trim()).toBe(fixture.file);
      await activate(diff.getByRole('link', { name: 'Back', exact: true }));
      await expect(changedRow(true)).toBeFocused();
      await expect(changedRow(false)).toHaveCount(0);
      const stagedIndex = git('ls-files', '--stage');
      const message = `Owned local workflow ${width}`;
      await commit.getByLabel('Commit Message', { exact: true }).fill(message);
      await expect(commit.getByLabel('Commit Message', { exact: true })).toHaveValue(message);
      await activate(commit.locator('[data-git-commit]'));
      await expect(commit.getByText('Commit confirmed', { exact: true })).toBeVisible({
        timeout: 30000,
      });
      hash = await commit.locator('[data-commit-hash]').textContent();
      expect(hash).toMatch(/^[a-f0-9]{40}$/);
      expect(git('rev-parse', 'HEAD').trim()).toBe(hash);
      const expectedTree = git('rev-parse', 'HEAD^{tree}').trim();
      expect(expectedTree).toMatch(/^[a-f0-9]{40}$/);
      expect(git('rev-parse', 'HEAD^').trim()).toBe(fixture.baseSha);
      expect(git('ls-files', '--stage')).toBe(stagedIndex);
      expect(git('diff', '--cached', 'HEAD')).toBe('');
      expect(git('log', '-1', '--format=%B').trim()).toBe(message);
      expect(git('diff-tree', '--no-commit-id', '--name-only', '-r', hash).trim()).toBe(
        fixture.file,
      );
      expect(git('show', `${hash}:${fixture.file}`)).toBe(expected.toString());
      expect(git('status', '--porcelain')).toBe('');
      expect(await readFile(`${root}/unrelated.txt`)).toEqual(unrelated);
      await capture('commit-confirmed', changes);
      await activate(history.getByRole('button', { name: 'Refresh', exact: true }));
      const entry = history.locator(`[data-history-entry="${hash}"]`);
      await expect(entry).toBeVisible({ timeout: 15000 });
      await activate(entry.getByRole('button'));
      await expect(entry.locator('[data-history-sha]')).toHaveText(hash);
      await activate(entry.locator(`[data-history-file="${fixture.file}"]`));
      await expect(diff).toHaveAttribute('data-diff-commit', hash);
      await expect(diffBody).toContainText(edit);
      await expect(diff.locator('[data-git-write]')).toHaveCount(0);
      await capture('history-file', diff);
      await activate(diff.getByRole('link', { name: 'Back', exact: true }));
      await expect(entry.locator(`[data-history-file="${fixture.file}"]`)).toBeFocused();
      await page.reload();
      await expect(treeRow('notes')).toBeVisible({ timeout: 30000 });
      for (const path of ['notes', 'notes/nested']) await activate(treeRow(path));
      await activate(treeRow(fixture.file));
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(save).toBeDisabled();
      await expect(page.getByTestId('workspace-file-content')).toHaveAttribute(
        'data-file-dirty',
        'false',
      );
      expect((await readEditor()).models).toEqual([expected.toString()]);
      expect(await readFile(`${root}/${fixture.file}`)).toEqual(expected);
      await activate(file.getByRole('link', { name: 'Back', exact: true }));
      await activate(overview.getByRole('link', { name: 'Workspaces', exact: true }));
      await expect(page.getByTestId('workspace-list')).toBeVisible();
      await expect(page.locator(`[data-list-workspace="${workspaceId}"]`)).toContainText(
        'Untitled',
      );
      await expect
        .poll(async () => (await readOwners()).explorer.byWorkspaceId[workspaceId])
        .toBeUndefined();
      await expect
        .poll(
          async () => (await readOwners()).git.byWorkspaceId[workspaceId]?.reads.ids.length ?? 0,
        )
        .toBe(0);
      expect((await readEditor()).models).toEqual([]);
      expect(requests.filter((r) => r.method === 'workspace.create')).toHaveLength(1);
      expect(requests.filter((r) => r.method === 'file.write')).toHaveLength(1);
      expect(requests.filter((r) => r.method === 'git.stage')).toHaveLength(1);
      expect(requests.filter((r) => r.method === 'git.agentCommit')).toHaveLength(1);
      expect(
        requests.filter((r) =>
          /^(agent\.(create|sendMessage)|git\.(push|reset|discard|amend|unstage)|file\.(delete|rename|create))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      expect(gitAt(fixture.repositoryPath, 'ls-files', '--stage')).toBe(sourceIndex);
      expect(await readFile(`${fixture.repositoryPath}/${fixture.file}`)).toEqual(sourceBytes);
      expect(gitAt(fixture.repositoryPath, 'rev-parse', 'HEAD').trim()).toBe(fixture.baseSha);
      expect(events.some((event) => event.type === 'input' && event.trusted)).toBe(true);
      expect(events.some((event) => event.type === 'keydown' && event.trusted)).toBe(true);
      expect(geometry.every((g) => g.scrollWidth <= width)).toBe(true);
      expect(errors).toEqual([]);
      Object.assign(proof, {
        hash,
        tree: expectedTree,
        message,
        originalIndex: initialIndex,
        finalIndex: git('ls-files', '--stage'),
        bytes: expected.toString('base64'),
        clean: git('status', '--porcelain'),
        unrelated: unrelated.toString('base64'),
        sourceBase: fixture.baseSha,
      });
    } finally {
      await writeFile(
        info.outputPath('local-workflow-evidence.json'),
        JSON.stringify(
          {
            width,
            fixture,
            workspaceId,
            root,
            hash,
            proof,
            requests,
            replies,
            events,
            geometry,
            errors,
            owners: await readOwners().catch((error) => ({ error: String(error) })),
          },
          null,
          2,
        ),
      );
    }
  });
}
