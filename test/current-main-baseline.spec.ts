import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';
import { approvedRowIds, baselineRows, target } from './current-main-baseline.matrix';
import {
  createEvidenceRows,
  createSemanticEvidence,
  mountedDefinitions,
  mountedScenes,
  mountedStates,
  semanticTestFiles,
  type EvidenceRow,
  type MountedScene,
  type MountedState,
  type SemanticEvidence,
} from './current-main-baseline.evidence';

const artifacts = resolve('test-results/current-main-baseline');
let server: ViteDevServer;
let baseUrl = '';
let semanticEvidence: SemanticEvidence[] = [];
let evidenceRows: EvidenceRow[] = [];
let passedAssertionIds = new Set<string>();

type VitestJsonReport = {
  success: boolean;
  testResults: Array<{
    name: string;
    assertionResults: Array<{
      status: string;
      ancestorTitles: string[];
      title: string;
    }>;
  }>;
};

const semanticOnlyRowIds = [
  'CHAT-05',
  'CHAT-07',
  'CHAT-40',
  'WORKSPACE-02',
  'WORKSPACE-27',
  'WORKSPACE-50',
  'WORKSPACE-56',
  'REMAINING-04',
  'REMAINING-08',
  'REMAINING-12',
  'REMAINING-13',
  'REMAINING-14',
  'REMAINING-21',
] as const;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  mkdirSync(artifacts, { recursive: true });
  const reportPath = resolve(artifacts, 'semantic-results.raw.json');
  execFileSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      ...semanticTestFiles,
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as VitestJsonReport;
  if (!report.success) throw new Error('Semantic baseline assertions failed');
  const assertionsByFile = new Map<string, string[]>();
  for (const result of report.testResults) {
    const file = relative(process.cwd(), result.name).replaceAll('\\', '/');
    const assertionIds = result.assertionResults
      .filter(({ status }) => status === 'passed')
      .map(({ ancestorTitles, title }) => `${file}::${[...ancestorTitles, title].join(' > ')}`);
    assertionsByFile.set(file, assertionIds);
    for (const assertionId of assertionIds) passedAssertionIds.add(assertionId);
  }
  semanticEvidence = createSemanticEvidence(assertionsByFile);
  evidenceRows = createEvidenceRows(semanticEvidence);
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [svelte({ configFile: resolve('svelte.config.js') })],
    resolve: {
      alias: [
        { find: '$lib', replacement: resolve('src/lib') },
        { find: '$store', replacement: resolve('src/store') },
        { find: '$features', replacement: resolve('src/features') },
        { find: '$shared', replacement: resolve('src/shared') },
        { find: '$app', replacement: resolve('playwright/app-stubs') },
        {
          find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
          replacement: resolve('src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: /^svelte-fa$/,
          replacement: resolve('src/lib/components/shared/icons/fa-proxy.ts'),
        },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
});
test.afterAll(async () => server?.close());

test('locks the complete 55-row current-main evidence contract', () => {
  expect(() =>
    execFileSync('git', ['merge-base', '--is-ancestor', target.commit, 'HEAD']),
  ).not.toThrow();
  expect(
    execFileSync('git', ['rev-parse', target.commit + '^{tree}'], { encoding: 'utf8' }).trim(),
  ).toBe(target.tree);
  expect(baselineRows.map(({ row }) => row)).toEqual([...approvedRowIds]);
  expect(new Set(approvedRowIds).size).toBe(55);
  expect(
    baselineRows
      .filter(({ probe }) => !mountedScenes.includes(probe as MountedScene))
      .map(({ row }) => row),
  ).toEqual([...semanticOnlyRowIds]);

  const allEvidence = [...mountedDefinitions, ...semanticEvidence];
  const evidenceIds = allEvidence.map(({ evidenceId }) => evidenceId);
  expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
  const referencedEvidenceIds = new Set(evidenceRows.flatMap(({ evidenceIds }) => evidenceIds));
  for (const evidenceId of evidenceIds) expect(referencedEvidenceIds.has(evidenceId)).toBe(true);

  for (const record of mountedDefinitions) {
    expect(record.rowIds.length, record.evidenceId).toBeGreaterThan(0);
    expect(record.observedStates.length, record.evidenceId).toBeGreaterThan(0);
    for (const rowId of record.rowIds) expect(approvedRowIds).toContain(rowId);
  }
  for (const assertion of semanticEvidence) {
    expect(assertion.status, assertion.evidenceId).toBe('passed');
    expect(approvedRowIds).toContain(assertion.rowId);
    expect(Object.keys(assertion.stateAssertions)).toEqual(assertion.observedStates);
    for (const assertionId of Object.values(assertion.stateAssertions)) {
      expect(passedAssertionIds.has(assertionId), assertion.evidenceId).toBe(true);
    }
  }
  for (const row of evidenceRows) {
    expect(row.verdict, row.row).toBe('PRESERVED');
    expect(row.implementationOwner, row.row).toBeNull();
    expect(Object.keys(row.stateEvidence), row.row).toEqual([...row.states]);
    for (const state of row.states) {
      expect(row.stateEvidence[state]?.length, `${row.row}:${state}`).toBeGreaterThan(0);
      for (const evidenceId of row.stateEvidence[state] ?? []) {
        expect(evidenceIds, `${row.row}:${state}:${evidenceId}`).toContain(evidenceId);
      }
    }
  }
  for (const rowId of semanticOnlyRowIds) {
    const row = evidenceRows.find(({ row }) => row === rowId);
    expect(row, rowId).toBeDefined();
    for (const state of row?.states ?? []) {
      expect(row?.stateEvidence[state], `${rowId}:${state}`).toEqual([`semantic:${rowId}`]);
    }
  }
});

async function mount(page: Page, scene: MountedScene, state: MountedState) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: state.reduced ? 'reduce' : 'no-preference' });
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.addStyleTag({ content: 'body { margin: 0; }' });
  await page.evaluate(
    async ({ scene, state }) => {
      Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      document.documentElement.classList.toggle('dark', state.theme === 'dark');
      const [{ mount, tick }, { default: Host }] = await Promise.all([
        import('/@id/svelte'),
        import('/test/fixtures/CurrentMainBaselineHost.svelte'),
      ]);
      document.body.replaceChildren();
      const target = document.createElement('div');
      document.body.append(target);
      mount(Host, { target, props: { scene, ...state } });
      await tick();
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
    },
    { scene, state },
  );
}

test('captures mounted light/dark, width, zoom, focus, hover, keyboard, and reduced-motion evidence', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const records: unknown[] = [];
  for (const state of mountedStates) {
    for (const scene of mountedScenes) {
      await mount(page, scene, state);
      const root = page.locator('[data-baseline-scene]');
      await expect(root).toBeVisible();
      if (scene === 'chat') {
        const rows = page.locator('[data-compact-tool-row]');
        expect(await rows.count()).toBeGreaterThanOrEqual(8);
        const disclosure = rows.first().locator('[data-tool-sentence]');
        await disclosure.hover();
        await disclosure.focus();
        await page.keyboard.press('Enter');
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#tool-details-read-a')).toHaveCount(0);
      } else if (scene === 'sidebar') {
        const cards = page.locator('[data-sidebar-launcher-grid] [data-sidebar-launcher]');
        await expect(cards).toHaveCount(4);
        await cards.first().hover();
        const button = cards.first().getByRole('button').first();
        await button.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.sidebar-expanded-card')).toBeVisible();
      } else if (scene === 'tabs') {
        const toggle = page.getByRole('button', { name: /Open spaces/ });
        await toggle.hover();
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAccessibleName('Open spaces');
      } else {
        await expect(page.getByTestId('physical-viewport')).toBeVisible();
        expect(
          Number(await page.getByTestId('panel-workspace-inset').getAttribute('data-canvas-width')),
        ).toBeGreaterThan(0);
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const image = `${scene}--${state.name}.png`;
      await page.screenshot({
        path: resolve(artifacts, image),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
      const hash = createHash('sha256')
        .update(readFileSync(resolve(artifacts, image)))
        .digest('hex');
      const geometry = await root.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          style: {
            color: style.color,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
          },
          active: document.activeElement?.outerHTML.slice(0, 1000),
          html: node.outerHTML
            .replace(/auggie-gradient-[^\s"'()<>]+/g, 'auggie-gradient-stable')
            .replace(/auggie-clip-path-[^\s"'()<>]+/g, 'auggie-clip-path-stable')
            .replace(/stop-color="[^"]+"/g, 'stop-color="dynamic"')
            .slice(0, 12000),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      const definition = mountedDefinitions.find(
        (candidate) => candidate.scene === scene && candidate.state.name === state.name,
      );
      if (!definition) throw new Error(`Missing mounted definition for ${scene}:${state.name}`);
      records.push({ ...definition, image, sha256: hash, geometry });
    }
  }
  const evidence = {
    target,
    generatedAt: '2026-08-14T00:00:00.000Z',
    rows: evidenceRows,
    records,
    assertions: semanticEvidence,
  };
  writeFileSync(resolve(artifacts, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(records).toHaveLength(8);
  expect(readFileSync(resolve(artifacts, 'evidence.json'), 'utf8')).toContain(target.commit);
});
