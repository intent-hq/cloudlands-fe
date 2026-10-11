import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { expect } from '../lib/functional.mjs';
import {
  test as liveTest,
  assertDiskListing,
  assertMemorySample,
  assertDisplayedMemory,
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

async function openLive(page, slug, query = {}, exampleId = `live-${slug}`) {
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
  const example = page.locator(`[data-functional-example="${exampleId}"]`);
  await expect(example).toBeVisible({ timeout: 15_000 });
  // The production socket connects lazily on its first request. Check the real
  // daemon before expecting a connected health signal; never synthesize health.
  expect(
    await page.evaluate(async () => {
      const { backendRequest } = await import('/src/features/backend/backend-transport.ts');
      return (await backendRequest('system.status')).running;
    }),
  ).toBe(true);
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

async function assertMemoryPresentation(page, liveTrace, expandedAgentId) {
  let sample;
  // Polling can replace the sample while the assertion runs. Read the store and
  // DOM in one browser turn, then require that exact payload in the real trace.
  await expect(async () => {
    const rendered = await page.evaluate(async () => {
      const { store } = await import('/src/store/index.ts');
      const dialog = document.querySelector('[role="dialog"]');
      // Adjacent spans have visual separation but textContent joins command
      // suffix digits to the following memory value. Preserve text boundaries.
      const text = (node) => {
        if (!node) return '';
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const chunks = [];
        while (walker.nextNode()) chunks.push(walker.currentNode.textContent);
        return chunks.join(' ');
      };
      return {
        sample: store.state.daemonHealth.agentMemoryUsage,
        text: text(dialog),
        agents: [...(dialog?.querySelectorAll('button[aria-expanded]') || [])].map(text),
        lists: [...(dialog?.querySelectorAll('[role="list"]') || [])].map((list) => ({
          label: list.getAttribute('aria-label'),
          rows: [...list.querySelectorAll('[role="listitem"]')].map(text),
        })),
      };
    });
    const exchange = liveTrace.exchanges.find(
      (entry) =>
        entry.request.method === 'agent.memoryUsage' &&
        entry.response &&
        isDeepStrictEqual(entry.response.result, rendered.sample),
    );
    expect(exchange, 'Rendered state must come from an observed daemon response').toBeDefined();
    sample = assertMemorySample(exchange.response);
    const total = rendered.text.match(/Total\s+([^]*?)(?:Sampled|No agent|$)/)?.[1];
    expect(total).toBeDefined();
    assertDisplayedMemory(total, sample.totalBytes);
    expect(rendered.agents).toHaveLength(sample.agents.length);
    sample.agents.forEach((agent, index) => {
      const row = rendered.agents[index];
      for (const value of [agent.agentName, agent.workspaceId, agent.provider])
        expect(row).toContain(value);
      if (agent.model) expect(row).toContain(agent.model);
      expect(row).toContain(`${new Intl.NumberFormat('en-US').format(agent.processCount)} process`);
      assertDisplayedMemory(row, agent.memoryBytes);
    });
    if (expandedAgentId) {
      const agent = sample.agents.find((entry) => entry.agentId === expandedAgentId);
      expect(agent, 'Expanded live agent must still be present in this sample').toBeDefined();
      const list = rendered.lists.find(
        (entry) => entry.label === `Processes of ${agent.agentName}`,
      );
      expect(list).toBeDefined();
      expect(list.rows).toHaveLength(agent.processes.length);
      agent.processes.forEach((proc, index) => {
        const row = list.rows[index];
        for (const value of [`PID ${proc.pid}`, proc.name, proc.cmdline])
          expect(row).toContain(value);
        // The command itself can contain a quantity, so use the final displayed value.
        const memory = [...row.matchAll(/\d+(?:\.\d+)?\s+(?:MB|GB|TB)/g)].at(-1)?.[0];
        expect(memory).toBeDefined();
        assertDisplayedMemory(memory, proc.memoryBytes);
      });
    }
  }).toPass({ timeout: 15_000 });
  return sample;
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

  test('memory: real sample, refresh, polling, close cleanup and reopen', async ({
    page,
    liveTrace,
  }, testInfo) => {
    test.setTimeout(60_000);
    const example = await openLive(page, 'diagnostics-audit', {}, 'live-agent-memory');
    const method = 'agent.memoryUsage';
    const requests = () => liveTrace.exchanges.filter((entry) => entry.request.method === method);
    expect(requests()).toHaveLength(0);
    const open = example.getByRole('button', { name: 'Open live agent memory', exact: true });
    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    assertMemorySample(await liveTrace.response(method, undefined));
    const initial = await assertMemoryPresentation(page, liveTrace);
    if (initial.agents.length > 0) {
      await dialog.locator('button[aria-expanded]').first().click();
      await assertMemoryPresentation(page, liveTrace, initial.agents[0].agentId);
    } else {
      testInfo.annotations.push({
        type: 'unrun',
        description: 'Process rows unavailable: the actual daemon sample has no attributed agents.',
      });
    }
    await screenshotEvidence(page, testInfo, 'memory-live-sample.png');

    // There is no refresh button in the source dialog. Exercise the real manual
    // intent through its canonical action, without injecting state or transport.
    const beforeManual = liveTrace.exchanges.length;
    await page.evaluate(async (root) => {
      const { store } = await import('/src/store/index.ts');
      const { agentMemoryUsageRequested } = await import(
        `/@fs${root}/src/store/renderer/slices/daemon-health/daemon-health-slice.ts`
      );
      store.dispatch(agentMemoryUsageRequested());
    }, process.env.PARITY_CANDIDATE_ROOT);
    assertMemorySample(await liveTrace.response(method, undefined, beforeManual));
    await assertMemoryPresentation(page, liveTrace);
    const beforeAutomatic = liveTrace.exchanges.length;
    assertMemorySample(await liveTrace.response(method, undefined, beforeAutomatic));
    await assertMemoryPresentation(page, liveTrace);

    const closedWindows = [];
    const assertClosed = async () => {
      await expect(dialog).toHaveCount(0);
      await expect(example.getByLabel('Live memory open', { exact: true })).toHaveText('false');
      expect(
        await page.evaluate(async () => {
          const { store } = await import('/src/store/index.ts');
          return store.state.daemonHealth.agentMemoryUsage;
        }),
      ).toBeNull();
      const count = requests().length;
      // A real observation window longer than the canonical 5s poll interval;
      // no fake clock, intercepted request, or simulated late response.
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      expect(requests(), 'Closed memory dialog must stop polling').toHaveLength(count);
      closedWindows.push({
        observationMs: 5_500,
        requestsBefore: count,
        requestsAfter: requests().length,
      });
    };
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await assertClosed();
    const beforeReopen = liveTrace.exchanges.length;
    await open.click();
    assertMemorySample(await liveTrace.response(method, undefined, beforeReopen));
    await assertMemoryPresentation(page, liveTrace);
    await expect(example.getByLabel('Live memory open count')).toHaveText('2');
    await page.keyboard.press('Escape');
    await assertClosed();
    await expect(example.getByLabel('Live memory close count')).toHaveText('2');
    for (const entry of requests()) {
      expect(entry.request).toEqual({ jsonrpc: '2.0', id: expect.any(Number), method });
      expect(Object.hasOwn(entry.request, 'params')).toBe(false);
      assertMemorySample(entry.response);
    }
    await testInfo.attach('memory-lifecycle.json', {
      body: JSON.stringify(
        {
          initialSampledAt: initial.sampledAt,
          initialAgentCount: initial.agents.length,
          initialProcessCount: initial.agents.reduce((sum, agent) => sum + agent.processCount, 0),
          manualRefresh: 'canonical production action; source has no refresh button',
          automaticRefreshObserved: true,
          closedWindows,
          unrun: ['artificial error/stale responses', 'late in-flight cancellation race'],
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test.skip('GitLab admitted resource lifecycle', () => {
    // UNRUN: requires actual Electron resource capture and configured GitLab admission;
    // the browser transport cannot supply that capability.
  });
  test.skip('native Electron link actions and remote host placement', () => {
    // UNRUN: requires a displayed Electron client and an admitted remote host.
  });
});
