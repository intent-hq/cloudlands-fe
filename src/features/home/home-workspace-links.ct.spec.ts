import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../test/ct-test';
import Harness from './home-workspace-links-harness.svelte';

type Snapshot = {
  selectedWorkspaceId: string | null;
  openWorkspaceTabs: Record<string, boolean>;
  owner: Layout;
  target: Layout;
  external: { url: string }[];
  requests: { method: string; params: unknown }[];
};
type Layout = {
  focusedPanelId: string | null;
  panels: Record<
    string,
    {
      activeTabId: string | null;
      tabs: {
        id: string;
        type: string;
        filePath?: string;
        noteId?: string;
        browserUrl?: string;
        data?: { line?: number };
      }[];
    }
  >;
};
const artifactRoot = resolve(process.cwd(), '.demo-artifacts/workspace-chat-review');
const rerun =
  'corepack pnpm run test:ct -- src/features/home/home-workspace-links.ct.spec.ts --workers=1';
const limits = [
  'Real HomeWorkspaceDetail, HomeWorkspaceChat and ChatPanel; seeded Redux transcript; production workspaceNavigationTabSaga and panelLayoutSaga.',
  'CT $app/navigation.goto is a no-op. Selected workspace and produced panel tabs are asserted; actual SvelteKit route paint, navigation rejection and Electron browser loading are not verified.',
  'The marker-removed comparison reproduces the old missing-workspace-entry boundary using current code. It is not a screenshot of the historical source revision.',
];
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() =>
    (
      window as unknown as { __workspaceChatReview: { snapshot(): Snapshot } }
    ).__workspaceChatReview.snapshot(),
  );
}
function focused(layout: Layout) {
  const panel = layout.panels[layout.focusedPanelId ?? ''];
  return panel?.tabs.find((tab) => tab.id === panel.activeTabId);
}

function artifactFolder(info: TestInfo): string {
  const name = info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return resolve(artifactRoot, `${name}-retry-${info.retry}`);
}

test.afterEach(async ({ page }, info) => {
  const folder = artifactFolder(info);
  await mkdir(folder, { recursive: true });
  const routing = await snapshot(page).catch(() => null);
  const report = {
    test: info.title,
    status: info.status,
    expectedStatus: info.expectedStatus,
    retry: info.retry,
    capturedAt: new Date().toISOString(),
    rerun,
    limits,
    routing,
    errors: info.errors.map(({ message }) => message),
  };
  const json = JSON.stringify(report, null, 2);
  await writeFile(resolve(folder, 'routing.json'), json);
  await info.attach('routing.json', { body: json, contentType: 'application/json' });
  const image = await page.screenshot({ path: resolve(folder, 'screenshot.png'), fullPage: true });
  await info.attach('workspace-preview.png', { body: image, contentType: 'image/png' });
  const headerImage = await readFile(resolve(folder, 'header-before-close.png')).catch(() => null);
  await writeFile(
    resolve(folder, 'review.html'),
    `<!doctype html><meta charset="utf-8"><title>Workspace chat review</title><style>body{font:16px system-ui;max-width:1200px;margin:32px auto}img{max-width:100%}pre{white-space:pre-wrap}</style><h1>${info.title}</h1><p>${info.status}</p><img src="${headerImage ? 'header-before-close.png' : 'screenshot.png'}" alt="Workspace preview"><p><a href="routing.json">Routing evidence</a></p><pre>${json.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</pre>`,
  );
});

test.afterAll(async () => {
  await mkdir(artifactRoot, { recursive: true });
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  type CaseResult = {
    test?: string;
    claim?: string;
    status: string;
    capturedAt?: string;
  };
  const reports = new Map<string, { folder: string; result: CaseResult }>();
  for (const entry of entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const report = await readFile(resolve(artifactRoot, entry.name, 'routing.json'), 'utf8').catch(
      () => null,
    );
    if (!report) continue;
    const result = JSON.parse(report) as CaseResult;
    const name = result.test ?? result.claim ?? entry.name;
    const previous = reports.get(name);
    if (!previous || (result.capturedAt ?? '') > (previous.result.capturedAt ?? '')) {
      reports.set(name, { folder: entry.name, result });
    }
  }
  const rows = [...reports.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, { folder, result }]) =>
        `<tr><td><a href="${encodeURIComponent(folder)}/review.html">${name}</a></td><td>${result.status}</td><td>${result.capturedAt ?? 'Live app check'}</td></tr>`,
    );
  await writeFile(
    resolve(artifactRoot, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Workspace chat review</title><style>body{font:16px system-ui;margin:32px}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}code{white-space:pre-wrap}</style><h1>Workspace preview chat review</h1><p>Each case links to its screenshot and real-store routing JSON. The original user screenshot is the header before evidence.</p><p>The independent live app check confirms clicking a Home chat note link changes the actual workspace route and displays the note.</p><p>${limits.join(' ')}</p><p>Repeat from packages/cloudlands-fe:</p><code>${rerun}</code><table><thead><tr><th>Case</th><th>Result</th><th>Captured</th></tr></thead><tbody>${rows.join('')}</tbody></table>`,
  );
});

const fileCases = [
  { name: 'short local file', href: 'intent://local/file/src/main.ts', path: 'src/main.ts' },
  {
    name: 'encoded space hash question colon with line fragment',
    href: 'intent://local/file/docs/Review%20%23%3F%3A17.md#L42',
    path: 'docs/Review #?:17.md',
    line: 42,
  },
  {
    name: 'relative encoded path with colon line suffix',
    href: './docs/Review%20%23%3F.md:17:3',
    path: 'docs/Review #?.md',
    line: 17,
  },
  {
    name: 'workspace absolute file becomes relative',
    href: '/workspaces/preview-owner/src/main.ts#L8',
    path: 'src/main.ts',
    line: 8,
  },
  {
    name: 'explicit cross-workspace file',
    href: 'intent://local/preview-other/file/src/other.ts#L9',
    path: 'src/other.ts',
    line: 9,
    cross: true,
  },
];
for (const entry of fileCases) {
  test(`preview chat opens ${entry.name} in selected workspace`, async ({ mount, page }) => {
    const component = await mount(Harness, { props: { href: entry.href } });
    expect((await snapshot(page)).selectedWorkspaceId).toBeNull();
    await component.getByRole('link', { name: 'Review destination', exact: true }).click();
    const target = entry.cross ? 'preview-other' : 'preview-owner';
    await expect.poll(async () => (await snapshot(page)).selectedWorkspaceId).toBe(target);
    await expect
      .poll(async () => focused((await snapshot(page))[entry.cross ? 'target' : 'owner'])?.filePath)
      .toBe(entry.path);
    const result = await snapshot(page);
    expect(result.openWorkspaceTabs[target]).toBe(true);
    expect(focused(result[entry.cross ? 'target' : 'owner'])?.data?.line).toBe(entry.line);
    expect(result.external).toEqual([]);
  });
}

for (const type of ['note', 'task']) {
  test(`preview chat keyboard ${type} link enters owner and opens note panel`, async ({
    mount,
    page,
  }) => {
    const component = await mount(Harness, {
      props: { href: `intent://local/${type}/review-note` },
    });
    await component.getByRole('link', { name: 'Review destination', exact: true }).press('Enter');
    await expect.poll(async () => (await snapshot(page)).selectedWorkspaceId).toBe('preview-owner');
    await expect
      .poll(async () => focused((await snapshot(page)).owner)?.noteId)
      .toBe('review-note');
    expect((await snapshot(page)).requests.some((request) => request.method === 'note.get')).toBe(
      true,
    );
  });
}

test('preview link uses its workspace panel instead of an enclosing Home panel', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness);
  await page
    .locator('[data-workspace-chat-review]')
    .evaluate((element) => element.setAttribute('data-panel-id', 'home-foreign-panel'));
  await component.getByRole('link', { name: 'Review destination', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).selectedWorkspaceId).toBe('preview-owner');
  await expect
    .poll(async () => focused((await snapshot(page)).owner)?.filePath)
    .toBe('src/main.ts');
  expect(Object.keys((await snapshot(page)).owner.panels)).toEqual(['source-preview-owner']);
});

for (const modifier of ['Meta', 'Control'] as const) {
  test(`preview chat ${modifier} file click enters owner and opens adjacent panel`, async ({
    mount,
    page,
  }) => {
    await page.evaluate(
      (platform) =>
        Object.defineProperty(navigator, 'platform', { value: platform, configurable: true }),
      modifier === 'Meta' ? 'MacIntel' : 'Linux x86_64',
    );
    const component = await mount(Harness);
    await component
      .getByRole('link', { name: 'Review destination', exact: true })
      .click({ modifiers: [modifier] });
    await expect.poll(async () => (await snapshot(page)).selectedWorkspaceId).toBe('preview-owner');
    await expect
      .poll(async () => focused((await snapshot(page)).owner)?.filePath)
      .toBe('src/main.ts');
    const { owner } = await snapshot(page);
    expect(Object.keys(owner.panels)).toHaveLength(2);
    expect(owner.panels['source-preview-owner'].activeTabId).toBe('chat-preview-owner');
  });
}

for (const href of ['https://example.com/review', 'https://github.com/acme/studio/pull/142']) {
  test(`preview chat opens ${href} in owner browser`, async ({ mount, page }) => {
    const component = await mount(Harness, { props: { href } });
    await component.getByRole('link', { name: 'Review destination', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).selectedWorkspaceId).toBe('preview-owner');
    await expect.poll(async () => focused((await snapshot(page)).owner)?.browserUrl).toBe(href);
    expect((await snapshot(page)).external).toEqual([]);
  });
}

test('preview auth URL uses external browser without entering owner', async ({ mount, page }) => {
  const href = 'https://github.com/login/oauth/authorize?client_id=review';
  const component = await mount(Harness, { props: { href } });
  await component.getByRole('link', { name: 'Review destination', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).external).toEqual([{ url: href }]);
  expect((await snapshot(page)).selectedWorkspaceId).toBeNull();
  expect(focused((await snapshot(page)).owner)?.type).toBe('agent');
});

test('ordinary workspace chat keeps plain web links external', async ({ mount, page }) => {
  const href = 'https://example.com/review';
  const component = await mount(Harness, { props: { href, ordinaryChat: true } });
  await component.getByRole('link', { name: 'Review destination', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).external).toEqual([{ url: href }]);
  expect((await snapshot(page)).selectedWorkspaceId).toBeNull();
});

test('marker-removed comparison opens a hidden file panel while Home stays selected', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness);
  await component
    .locator('[data-home-workspace-chat]')
    .evaluate((element) => element.removeAttribute('data-workspace-link-target'));
  await component.getByRole('link', { name: 'Review destination', exact: true }).click();
  await expect
    .poll(async () => focused((await snapshot(page)).owner)?.filePath)
    .toBe('src/main.ts');
  expect((await snapshot(page)).selectedWorkspaceId).toBeNull();
});

for (const href of [
  'intent://local/file/../secret.txt',
  'intent://local/file/%2e%2e/secret.txt',
  'intent://local/file//etc/passwd',
  'intent://local/file/docs/%ZZ.md',
  '../secret.txt',
  'docs/%00.txt',
]) {
  test(`preview rejects bad path ${href}`, async ({ mount, page }) => {
    const component = await mount(Harness, { props: { href } });
    const before = await snapshot(page);
    await component.getByRole('link', { name: 'Review destination', exact: true }).click();
    // Wait for the actual asynchronous click handler's imports and store updates to settle.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    const after = await snapshot(page);
    expect(after.owner).toEqual(before.owner);
    expect(after.target).toEqual(before.target);
    expect(after.external).toEqual([]);
    expect(after.selectedWorkspaceId).toBeNull();
  });
}

for (const nodeOwned of [true, false]) {
  test(`preview blocks node-owned file path ${nodeOwned ? 'on render' : 'updated before click'}`, async ({
    mount,
    page,
  }) => {
    const component = await mount(Harness, { props: { nodeOwned } });
    if (!nodeOwned)
      await page.evaluate(() =>
        (
          window as unknown as { __workspaceChatReview: { blockAgentPath(): void } }
        ).__workspaceChatReview.blockAgentPath(),
      );
    await component.getByRole('link', { name: 'Review destination', exact: true }).click();
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    expect(focused((await snapshot(page)).owner)?.type).toBe('agent');
    expect((await snapshot(page)).external).toEqual([]);
    expect((await snapshot(page)).selectedWorkspaceId).toBeNull();
  });
}

const headerCases = [
  {
    name: 'reported title in narrow preview with repository',
    title: 'Investigate missing attention question',
    width: 320,
    repository: true,
  },
  {
    name: 'long spaced title with repository',
    title:
      'Keep the selected workspace visible when repository names and branch names become very long',
    width: 640,
    repository: true,
  },
  {
    name: 'narrow unbroken title with repository',
    title: 'UnbrokenWorkspaceTitle'.repeat(12),
    width: 320,
    repository: true,
  },
  {
    name: 'enlarged narrow title without repository',
    title: 'Review workspace links and reserve space for the close action',
    width: 320,
    repository: false,
    enlarged: true,
  },
];
for (const entry of headerCases) {
  test(`header ${entry.name} reserves clickable close space`, async ({ mount, page }, info) => {
    const component = await mount(Harness, { props: entry });
    const header = component.locator('[data-home-detail] header');
    const title = header.getByRole('button', { name: 'Open workspace', exact: true });
    const close = header.getByRole('button', { name: 'Back to list', exact: true });
    await expect(title).toBeVisible();
    await expect(close).toBeVisible();
    const titleBox = (await title.boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x + 1);
    if (entry.repository) {
      const repoBox = (await header.locator('[data-home-detail-repository]').boundingBox())!;
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(repoBox.x + 1);
      expect(repoBox.x + repoBox.width).toBeLessThanOrEqual(closeBox.x + 1);
    }
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const folder = artifactFolder(info);
    await mkdir(folder, { recursive: true });
    await page
      .locator('[data-workspace-chat-review]')
      .screenshot({ path: resolve(folder, 'header-before-close.png') });
    await close.click();
    await expect(component.locator('[data-preview-closed]')).toBeVisible();
  });
}
