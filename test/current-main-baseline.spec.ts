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

function stableVitestReport(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => stableVitestReport(item));
    if (key === 'testResults') {
      return items.toSorted((left, right) =>
        String((left as { name?: string }).name).localeCompare(
          String((right as { name?: string }).name),
        ),
      );
    }
    if (key === 'assertionResults') {
      return items.toSorted((left, right) =>
        String((left as { fullName?: string }).fullName).localeCompare(
          String((right as { fullName?: string }).fullName),
        ),
      );
    }
    return items;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['duration', 'startTime', 'endTime'].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([itemKey, item]) => [itemKey, stableVitestReport(item, itemKey)]),
  );
}

const semanticOnlyRowIds = baselineRows
  .filter(({ row }) => !mountedDefinitions.some(({ rowIds }) => rowIds.includes(row)))
  .map(({ row }) => row);

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
  writeFileSync(reportPath, `${JSON.stringify(stableVitestReport(report), null, 2)}\n`);
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
  const allEvidence = [...mountedDefinitions, ...semanticEvidence];
  const evidenceIds = allEvidence.map(({ evidenceId }) => evidenceId);
  expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
  const referencedEvidenceIds = new Set(evidenceRows.flatMap(({ evidenceIds }) => evidenceIds));
  for (const evidenceId of evidenceIds) expect(referencedEvidenceIds.has(evidenceId)).toBe(true);

  for (const record of mountedDefinitions) {
    expect(record.rowIds.length, record.evidenceId).toBeGreaterThan(0);
    expect(record.observedStates.length, record.evidenceId).toBeGreaterThan(0);
    expect(Object.keys(record.rowAssertions), record.evidenceId).toEqual(record.rowIds);
    for (const checks of Object.values(record.rowAssertions)) {
      expect(checks.length, record.evidenceId).toBeGreaterThan(0);
    }
    for (const rowId of record.rowIds) expect(approvedRowIds).toContain(rowId);
  }
  for (const assertion of semanticEvidence) {
    expect(assertion.status, assertion.evidenceId).toBe('passed');
    expect(approvedRowIds).toContain(assertion.rowId);
    expect(Object.keys(assertion.stateAssertions)).toEqual(assertion.observedStates);
    expect(Object.keys(assertion.configuredStates)).toEqual(assertion.observedStates);
    for (const state of assertion.observedStates) {
      expect(assertion.configuredStates[state], `${assertion.evidenceId}:${state}`).toContain(
        state,
      );
    }
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

function contrastRatio(first: string, second: string): number {
  const channels = (value: string) =>
    (value.match(/[\d.]+/g) ?? [])
      .slice(0, 3)
      .map(Number)
      .map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
  const luminance = (value: string) => {
    const [red, green, blue] = channels(value);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function assertMountedScene(page: Page, scene: MountedScene) {
  if (scene === 'chat') {
    const rows = page.locator('[data-compact-tool-row]');
    expect(await rows.count()).toBeGreaterThanOrEqual(8);
    await expect(page.locator('[data-tool-status="error"]')).toHaveCount(1);
    const disclosure = rows.first().locator('[data-tool-sentence]');
    await disclosure.hover();
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#tool-details-read-a')).toHaveCount(0);
    return {
      'CHAT-02': { compactRows: await rows.count(), disclosureKeyboardAndPointer: true },
      'CHAT-36': { collapsedDetails: true, errorRows: 1 },
    };
  }
  if (scene === 'sidebar') {
    const grid = page.locator('[data-sidebar-launcher-grid]');
    const cards = grid.locator('[data-sidebar-launcher]');
    await expect(cards).toHaveCount(4);
    await expect(grid.locator('[data-sidebar-launcher="activity"]')).toHaveCount(0);
    const agents = grid.locator('[data-sidebar-launcher="agents"]');
    await expect(page.locator('[data-sidebar-launcher="browser"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Shell' })).toHaveCount(1);
    const agentRows = agents.locator('[data-sidebar-agent]');
    await expect(agentRows).toHaveCount(6);
    await expect(agents.locator('[data-sidebar-agent-overflow]')).toContainText('+2');
    const launcherBox = await agents.boundingBox();
    const agentBoxes = await agentRows.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    );
    expect(launcherBox).not.toBeNull();
    for (const box of agentBoxes) {
      expect(box.left).toBeGreaterThanOrEqual(launcherBox!.x - 0.5);
      expect(box.right).toBeLessThanOrEqual(launcherBox!.x + launcherBox!.width + 0.5);
    }
    const agentTrigger = agents.getByRole('button').first();
    const sidebarHost = page.locator('[data-sidebar-launcher-host]');
    const hostBefore = await sidebarHost.boundingBox();
    await agentTrigger.hover();
    await agentTrigger.focus();
    await page.keyboard.press('Enter');
    const overlay = page.locator('[data-sidebar-overlay]');
    await expect(overlay).toBeVisible();
    expect(await sidebarHost.boundingBox()).toEqual(hostBefore);
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(agentTrigger).toBeFocused();
    await page.mouse.move(0, 0);
    await agentTrigger.evaluate((node) => node.blur());
    await page.waitForTimeout(100);

    const accessibility = await agents.evaluate((node) => {
      const label = node.querySelector<HTMLElement>('[data-sidebar-launcher-label]')!;
      let surface: HTMLElement | null = label;
      let background = 'rgba(0, 0, 0, 0)';
      while (surface && background === 'rgba(0, 0, 0, 0)') {
        background = getComputedStyle(surface).backgroundColor;
        surface = surface.parentElement;
      }
      const focusable = [...node.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
      return {
        color: getComputedStyle(label).color,
        background,
        accessibleNames: focusable.map(
          (item) =>
            item.getAttribute('aria-label') ||
            item.getAttribute('aria-labelledby') ||
            item.textContent?.trim(),
        ),
        focusOrder: focusable.map((item) => item.outerHTML.slice(0, 120)),
      };
    });
    expect(contrastRatio(accessibility.color, accessibility.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(accessibility.accessibleNames.every(Boolean)).toBe(true);
    expect(accessibility.focusOrder.length).toBeGreaterThan(0);
    return {
      'WORKSPACE-03': { activityLauncherCount: 0 },
      'WORKSPACE-14': { visibleAgents: 6, overflow: 2 },
      'WORKSPACE-15': { containedAgentRows: agentBoxes.length },
      'WORKSPACE-16': { leftOriented: agentBoxes.every((box) => box.left >= launcherBox!.x) },
      'WORKSPACE-19': { physicalDeck: true, launcherCount: 4 },
      'WORKSPACE-20': { hoverAndFocus: true },
      'WORKSPACE-21': { browserLauncher: true },
      'WORKSPACE-22': { shellLauncher: true },
      'WORKSPACE-26': { overlayWithoutReflow: true },
      'WORKSPACE-27': { escapeDismissed: true, focusRestored: true },
      'REMAINING-21': {
        contrast: contrastRatio(accessibility.color, accessibility.background),
        accessibleNames: accessibility.accessibleNames.length,
        focusOrder: accessibility.focusOrder.length,
        reducedMotion: await page.evaluate(
          () => matchMedia('(prefers-reduced-motion: reduce)').matches,
        ),
      },
    };
  }
  if (scene === 'tabs') {
    const toggle = page.getByRole('button', { name: /Open spaces/ });
    await toggle.hover();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAccessibleName('Open spaces');
    return { 'WORKSPACE-31': { consolidatedControl: true, keyboardActivation: true } };
  }

  await expect(page.getByTestId('physical-viewport')).toBeVisible();
  const canvasWidth = Number(
    await page.getByTestId('panel-workspace-inset').getAttribute('data-canvas-width'),
  );
  expect(canvasWidth).toBeGreaterThan(0);
  const panels = page.locator('[data-testid="panel-workspace-inset"] .panel-split-child');
  expect(await panels.count()).toBeGreaterThanOrEqual(3);
  const handles = page.getByRole('button', { name: 'Resize panel' });
  expect(await handles.count()).toBeGreaterThan(0);
  await handles.first().hover();
  await handles.first().focus();
  await page.keyboard.press('Escape');
  const shell = page.locator('[data-baseline-zero-tab-shell]');
  await expect(shell.getByRole('button', { name: 'New Agent' })).toBeVisible();
  await expect(shell.getByRole('button', { name: /^New panel/ })).toBeVisible();
  return {
    'WORKSPACE-42': { canvasWidth, reachablePanels: await panels.count() },
    'WORKSPACE-45': { resizeHandles: await handles.count(), keyboardFocus: true },
    'WORKSPACE-56': { zeroTabShell: true, recoverableActions: 2 },
  };
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
      const rowObservations = await assertMountedScene(page, scene);
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
      expect(Object.keys(rowObservations)).toEqual(definition.rowIds);
      records.push({ ...definition, rowObservations, image, sha256: hash, geometry });
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
