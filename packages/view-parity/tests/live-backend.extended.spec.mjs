import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from '../lib/functional.mjs';
import {
  test as liveTest,
  assertDiskListing,
  githubOracle,
  screenshotEvidence,
} from '../lib/live-backend.mjs';

// Prerequisites: a committed isolated candidate served with INTENT_DEV_DAEMON_BRIDGE=1
// against a daemon on THIS filesystem, and PARITY_LIVE_BACKEND=1 on the runner.
// Optional forge read: PARITY_LIVE_GITHUB_URL (+ PARITY_LIVE_WORKSPACE_ID if needed),
// with configured daemon GitHub access and independently authenticated gh CLI.
const test = liveTest.extend({
  directoryRoot: async ({ browserName }, use, testInfo) => {
    const root = await mkdtemp(path.join(os.tmpdir(), `intent-live-${browserName}-picker-`));
    try {
      await Promise.all([
        mkdir(path.join(root, 'alpha', 'child'), { recursive: true }),
        mkdir(path.join(root, 'bravo')),
        mkdir(path.join(root, '.hidden')),
        writeFile(path.join(root, 'note.txt'), 'run-owned directory picker evidence\n'),
      ]);
      await use(root);
    } finally {
      // No user directory, configured path or daemon-returned path is ever removed.
      await rm(root, { recursive: true, force: true });
      expect(
        await stat(root).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      await testInfo.attach('temp-root-cleanup.json', {
        body: JSON.stringify({ root, removed: true }),
        contentType: 'application/json',
      });
    }
  },
});

async function openLive(page, slug, query = {}) {
  const url = new URL(`/sandbox/${slug}`, process.env.PARITY_CANDIDATE_URL);
  for (const [key, value] of Object.entries({
    example: 'live',
    theme: 'light',
    motion: 'reduced',
    ...query,
  }))
    url.searchParams.set(key, value);
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `Cannot load live route ${url}`).toBe(true);
  const example = page.locator(`[data-functional-example="live-${slug}"]`);
  await expect(example).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { store } = await import('/src/store/index.ts');
          return store.state.daemonHealth.health;
        }),
      { message: 'Start the candidate with the real same-origin daemon bridge', timeout: 15_000 },
    )
    .toBe('healthy');
  expect(await page.evaluate(() => window.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl)).toBe(
    '/intentd/ws',
  );
  return example;
}

async function openPicker(page, example) {
  await example.getByRole('button', { name: 'Open live directory picker', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('live backend', () => {
  test.skip(
    process.env.PARITY_LIVE_BACKEND !== '1',
    "Requires PARITY_LIVE_BACKEND=1 and a real loopback daemon bridge on the runner's filesystem.",
  );

  test('directory: real disk listing, filtering, selection, navigation and reset', async ({
    page,
    liveTrace,
    directoryRoot,
  }, testInfo) => {
    const example = await openLive(page, 'directory-picker', { initialPath: directoryRoot });
    const dialog = await openPicker(page, example);
    await assertDiskListing(
      await liveTrace.response('host.listDirectory', { path: directoryRoot }),
      directoryRoot,
    );
    await expect(dialog.getByRole('option')).toHaveText(['.hidden', 'alpha', 'bravo']);
    await expect(dialog.getByRole('option', { name: 'note.txt', exact: true })).toHaveCount(0);
    const filter = dialog.getByRole('searchbox', { name: 'Filter folder contents' });
    await filter.fill('ALP');
    await expect(dialog.getByRole('option')).toHaveText(['alpha']);
    await filter.press('Escape');
    await expect(filter).toHaveValue('');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('option', { name: 'alpha', exact: true }).click();
    await expect(dialog.getByRole('option', { name: 'alpha', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await dialog.getByRole('button', { name: /^Select / }).click();
    await expect(example.getByLabel('Selected live path')).toHaveText(
      path.join(directoryRoot, 'alpha'),
    );
    await expect(example.getByLabel('Live selection count')).toHaveText('1');
    await expect(dialog).toHaveCount(0);

    await openPicker(page, example);
    await dialog.getByRole('option', { name: 'alpha', exact: true }).dblclick();
    const child = path.join(directoryRoot, 'alpha');
    await assertDiskListing(await liveTrace.response('host.listDirectory', { path: child }), child);
    await expect(dialog.getByRole('option')).toHaveText(['child']);
    await dialog.getByRole('button', { name: 'Go up one level', exact: true }).click();
    await expect(dialog.getByRole('option')).toHaveText(['.hidden', 'alpha', 'bravo']);
    await filter.fill('bravo');
    await dialog.getByRole('listbox').focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(example.getByLabel('Live picker close count')).toHaveText('1');
    await openPicker(page, example);
    await expect(filter).toHaveValue('');
    await expect(dialog.getByRole('option')).toHaveText(['.hidden', 'alpha', 'bravo']);
    await screenshotEvidence(page, testInfo, 'directory-reopened.png');
  });

  test('directory: typed missing path retries, creation reaches disk, and edit Escape cancels', async ({
    page,
    liveTrace,
    directoryRoot,
  }, testInfo) => {
    const example = await openLive(page, 'directory-picker', { initialPath: directoryRoot });
    const dialog = await openPicker(page, example);
    await expect(dialog.getByRole('option', { name: 'alpha', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Enter a folder path', exact: true }).click();
    const input = dialog.getByRole('textbox', { name: 'Path', exact: true });
    const missing = path.join(directoryRoot, 'not-created');
    await input.fill(missing);
    await input.press('Enter');
    const failed = await liveTrace.response('host.listDirectory', { path: missing });
    expect(failed.error).toMatchObject({ code: -32603, message: expect.any(String) });
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await screenshotEvidence(page, testInfo, 'directory-missing-path.png');
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(input).toBeFocused();
    const alpha = path.join(directoryRoot, 'alpha');
    await input.fill(alpha);
    await input.press('Enter');
    await assertDiskListing(await liveTrace.response('host.listDirectory', { path: alpha }), alpha);
    await expect(dialog.getByRole('option')).toHaveText(['child']);
    await dialog.getByRole('button', { name: 'New Folder', exact: true }).click();
    const folderName = dialog.getByRole('textbox', { name: 'New folder name', exact: true });
    await folderName.fill('cancelled-draft');
    await folderName.press('Escape');
    await expect(folderName).toHaveCount(0);
    expect(
      await stat(path.join(alpha, 'cancelled-draft')).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await dialog.getByRole('button', { name: 'New Folder', exact: true }).click();
    await folderName.fill('created-through-ui');
    await folderName.press('Enter');
    const created = path.join(alpha, 'created-through-ui');
    const creation = await liveTrace.response('host.createDirectory', { path: created });
    expect(creation).toEqual({ jsonrpc: '2.0', id: creation.id, result: { path: created } });
    expect((await stat(created)).isDirectory()).toBe(true);
    await assertDiskListing(
      await liveTrace.response('host.listDirectory', { path: created }),
      created,
    );
    await expect(
      dialog.getByRole('button', { name: 'Enter a folder path', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Enter a folder path', exact: true }).click();
    const mark = liveTrace.exchanges.length;
    await input.fill(missing);
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Select / })).toBeEnabled();
    expect(liveTrace.exchanges.slice(mark)).toEqual([]);
    await screenshotEvidence(page, testInfo, 'directory-created.png');
  });

  test('directory: missing initial path falls back to host home and file mode selects actual bytes', async ({
    page,
    liveTrace,
    directoryRoot,
  }) => {
    const missing = path.join(directoryRoot, 'missing-initial');
    const example = await openLive(page, 'directory-picker', { initialPath: missing });
    const dialog = await openPicker(page, example);
    expect((await liveTrace.response('host.listDirectory', { path: missing })).error.code).toBe(
      -32603,
    );
    const home = await liveTrace.response('host.listDirectory', {});
    expect(home.error).toBeUndefined();
    expect(home.result.path).toBe(os.homedir());
    expect(home.result.home).toBe(os.homedir());
    await expect(
      dialog.getByRole('button', { name: 'Enter a folder path', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close folder picker', exact: true }).click();
    await example.getByLabel('Initial directory path').fill(directoryRoot);
    await example.getByRole('switch', { name: 'Select files' }).click();
    await openPicker(page, example);
    await expect(dialog.getByRole('button', { name: 'Select file', exact: true })).toBeDisabled();
    await dialog.getByRole('option', { name: 'note.txt', exact: true }).click();
    await dialog.getByRole('button', { name: 'Select file', exact: true }).click();
    const selected = await example.getByLabel('Selected live path').textContent();
    expect(selected).toBe(path.join(directoryRoot, 'note.txt'));
    expect(await readFile(selected, 'utf8')).toBe('run-owned directory picker evidence\n');
    await expect(dialog).toHaveCount(0);
  });

  test('tooltip: real plain/mailto hover, href replacement, detachment and host cleanup', async ({
    page,
    liveTrace,
  }, testInfo) => {
    const example = await openLive(page, 'link-tooltip', {
      url: 'https://example.com/live-preview',
      alternateUrl: 'mailto:preview@example.com',
    });
    const primary = example.getByRole('link', { name: 'Preview supplied link' });
    const alternate = example.getByRole('link', { name: 'Preview alternate link' });
    const tooltip = page.getByRole('tooltip');
    await primary.hover();
    await expect(tooltip).toContainText('example.com/live-preview');
    await alternate.hover();
    await expect(tooltip).toContainText('preview@example.com');
    await expect(tooltip).not.toContainText('live-preview');
    await screenshotEvidence(page, testInfo, 'mailto-hover.png');

    // Keyboard activation leaves the pointer over the anchor: observer cleanup,
    // rather than incidental mouseout, must retire the visible tooltip.
    await example.getByLabel('Forge URL', { exact: true }).fill('https://example.org/replacement');
    await example.getByRole('button', { name: 'Apply link context' }).focus();
    await primary.hover();
    await expect(tooltip).toContainText('example.com/live-preview');
    await page.keyboard.press('Space');
    await expect(primary).toHaveAttribute('href', 'https://example.org/replacement');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(0, 0);
    await primary.hover();
    await expect(tooltip).toContainText('example.org/replacement');
    await example.getByRole('button', { name: 'Remove link anchors' }).focus();
    await page.keyboard.press('Space');
    await expect(primary).toHaveCount(0);
    await expect(tooltip).toHaveCount(0);
    await example.getByRole('button', { name: 'Restore link anchors' }).click();
    await example.getByRole('button', { name: 'Unmount tooltip host' }).focus();
    await primary.hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Space');
    await expect(example.getByLabel('Tooltip host mounted')).toHaveText('false');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(0, 0);
    await primary.hover();
    await expect(tooltip.waitFor({ state: 'visible', timeout: 1_000 })).rejects.toThrow(/Timeout/);
    await example.getByRole('button', { name: 'Mount tooltip host' }).click();
    await alternate.hover();
    await expect(tooltip).toContainText('preview@example.com');
    expect(liveTrace.exchanges, 'Plain links must not request forge previews').toEqual([]);
  });

  test('tooltip: configured GitHub preview matches independent gh API and retires on replacement', async ({
    page,
    liveTrace,
  }, testInfo) => {
    test.skip(
      !process.env.PARITY_LIVE_GITHUB_URL,
      'Requires PARITY_LIVE_GITHUB_URL, configured daemon GitHub access and authenticated gh CLI.',
    );
    const url = process.env.PARITY_LIVE_GITHUB_URL;
    const oracle = await githubOracle(url);
    const workspaceId = process.env.PARITY_LIVE_WORKSPACE_ID;
    const example = await openLive(page, 'link-tooltip', {
      url,
      alternateUrl: 'https://example.org/after-forge',
      ...(workspaceId ? { workspaceId } : {}),
    });
    await example.getByRole('link', { name: 'Preview supplied link' }).hover();
    const method = oracle.kind === 'pull' ? 'github.pulls.get' : 'github.issues.get';
    const response = await liveTrace.response(method, {
      ...(workspaceId ? { workspaceId } : {}),
      owner: oracle.owner,
      repo: oracle.repo,
      number: oracle.number,
    });
    expect(response.error).toBeUndefined();
    const details = response.result[oracle.kind === 'pull' ? 'pull' : 'issue'];
    expect(details).toMatchObject({
      number: oracle.data.number,
      title: oracle.data.title,
      state: oracle.data.state,
      htmlUrl: oracle.data.html_url,
      createdAt: oracle.data.created_at,
      updatedAt: oracle.data.updated_at,
      user: { login: oracle.data.user.login },
    });
    if (oracle.kind === 'pull')
      expect(details).toMatchObject({
        merged: oracle.data.merged,
        draft: oracle.data.draft,
        headRef: oracle.data.head.ref,
        baseRef: oracle.data.base.ref,
      });
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText(oracle.data.title);
    await expect(tooltip).toContainText(oracle.data.user.login);
    await screenshotEvidence(page, testInfo, 'github-live-preview.png');
    await testInfo.attach('github-independent-oracle.json', {
      body: JSON.stringify(oracle, null, 2),
      contentType: 'application/json',
    });
    await example.getByRole('link', { name: 'Preview alternate link' }).hover();
    await expect(tooltip).toContainText('example.org/after-forge');
    await expect(tooltip).not.toContainText(oracle.data.title);
    await example.getByRole('button', { name: 'Unmount tooltip host' }).focus();
    await page.keyboard.press('Space');
    await expect(tooltip).toHaveCount(0);
  });

  test.skip('GitLab admitted resource lifecycle', () => {
    // UNRUN: requires actual Electron resource capture and configured GitLab admission;
    // the browser transport cannot supply that capability.
  });
  test.skip('native Electron link actions and remote host placement', () => {
    // UNRUN: requires a displayed Electron client and an admitted remote host.
  });
});
