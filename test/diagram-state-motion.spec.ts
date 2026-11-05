import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const externalBaseUrl = process.env.UI_PREVIEW_BASE_URL;
let baseUrl = externalBaseUrl ?? '';
let server: ViteDevServer | undefined;

// Every workbench visit renders all diagram cases before `data-preview-ready`, which
// alone can take most of the default 30 s budget on CI (intent-hq/intent#5687). The
// per-visit budget sits above the workbench's own 45 s `readinessTimeoutMs` so a slow
// visit surfaces the preview's readiness error rather than a bare expect timeout.
const WORKBENCH_READY_TIMEOUT_MS = 60_000;
// Visits that touch only their own case mount just that case (`cases=target`), so their
// readiness no longer waits on every serial Mermaid render (intent-hq/intent#8188).
type WorkbenchScope = 'target' | 'all';
const scopeQuery = (scope: WorkbenchScope) => (scope === 'target' ? '&cases=target' : '');
test.describe.configure({ mode: 'default', timeout: 90_000 });

test.beforeAll(async ({}, workerInfo) => {
  if (externalBaseUrl) return;
  const ownedServer = await createServer({
    cacheDir: viteHarnessCacheDir('diagram-state-motion', { workerIndex: workerInfo.workerIndex }),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  server = ownedServer;
  try {
    await ownedServer.listen();
    baseUrl = ownedServer.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
    expect(baseUrl).not.toBe('');
  } catch (error) {
    await ownedServer.close().catch(() => undefined);
    server = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  const ownedServer = server;
  server = undefined;
  await ownedServer?.close();
});

const framingAppearances = [
  { name: 'Light', theme: 'light' },
  { name: 'Dark', theme: 'dark' },
  { name: 'Nord', theme: 'light', colorTheme: 'nord' },
] as const;
const framingWidths = [
  { name: 'wide', value: 960 },
  { name: 'narrow', value: 420 },
] as const;
const steppedFixtures = [
  { id: 'custom-architecture', steps: 3 },
  { id: 'custom-walkthrough', steps: 3 },
  { id: 'custom-delivery-walkthrough', steps: 4 },
] as const;

async function openMotionFixture(
  page: Page,
  state: string,
  reduced = false,
  scope: WorkbenchScope = 'target',
) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const motion = reduced ? 'reduced' : 'full';
  const url = `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960&motion=${motion}${scopeQuery(scope)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const scene = page.getByTestId('catalog-scene');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', {
    timeout: WORKBENCH_READY_TIMEOUT_MS,
  });
}

async function openSystemMotionFixture(page: Page, state: string, reduced: boolean) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const url = `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960${scopeQuery('target')}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: WORKBENCH_READY_TIMEOUT_MS,
  });
}

async function expectBundledSandboxFont(page: Page, rootId: string) {
  const evidence = await page
    .locator(`#${rootId} .edge-label-html`)
    .first()
    .evaluate((label) => ({
      token: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim(),
      computedFamily: getComputedStyle(label).fontFamily,
      loadedFaces: [...document.fonts]
        .filter(({ status }) => status === 'loaded')
        .map(({ family }) => family),
    }));
  expect(evidence.token).toMatch(/^['"]Inter Variable['"]/);
  expect(evidence.computedFamily).toMatch(/^['"]Inter Variable['"]/);
  expect(evidence.loadedFaces).toContain('Inter Variable');
}

type ContentMotionFrame = {
  state: string;
  phase: string;
  settled: boolean;
  nodes: Record<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
      opacity: number;
      background: string;
      sameAsBaseline: boolean;
    } | null
  >;
  edges: Record<
    string,
    {
      path: string;
      progress: number;
      reveal: number;
      maskDashOffset: number;
      maskApplied: boolean;
      sameAsBaseline: boolean;
      sourcePoint: { x: number; y: number };
      targetPoint: { x: number; y: number };
      sourceDistance: number;
      targetDistance: number;
    } | null
  >;
};

async function readStableSignature(page: Page, rootId: string) {
  return page.locator(`#${rootId}`).evaluate((root) => ({
    state: root.querySelector<HTMLElement>('.diagram-renderer')?.dataset.diagramState,
    nodes: [...root.querySelectorAll<SVGForeignObjectElement>('[data-node-id]')]
      .map((node) => node.dataset.nodeId)
      .sort(),
    edges: [...root.querySelectorAll<SVGGElement>('.diagram-edge')]
      .map((edge) => edge.dataset.edgeId)
      .sort(),
    labels: [...root.querySelectorAll<SVGForeignObjectElement>('.edge-label-container')]
      .map((label) => ({ id: label.dataset.edgeId, text: label.textContent?.trim() }))
      .sort((left, right) => left.id!.localeCompare(right.id!)),
    groups: [...root.querySelectorAll<SVGGElement>('[data-group-id]')]
      .map((group) => group.dataset.groupId)
      .sort(),
  }));
}

async function allRoutesComplete(page: Page, rootId: string) {
  return page
    .locator(`#${rootId} .diagram-edge`)
    .evaluateAll((edges) =>
      edges.every((edge) => edge.getAttribute('data-edge-motion-progress') === '1'),
    );
}

test('keeps the bundled sandbox font through theme changes and repeated document visits', async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const [state, rootId] of [
    ['custom-architecture', 'custom-architecture'],
    ['custom-walkthrough', 'custom-walkthrough'],
    ['custom-architecture', 'custom-architecture'],
  ] as const) {
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960&motion=full${scopeQuery('target')}`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: WORKBENCH_READY_TIMEOUT_MS,
    });
    await expectBundledSandboxFont(page, rootId);
    if (state === 'custom-architecture') {
      await page.getByRole('button', { name: 'Customize preview' }).click();
      await page
        .getByTestId('catalog-theme-control')
        .getByRole('radio', { name: 'Dark', exact: true })
        .click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expectBundledSandboxFont(page, rootId);
    }
  }
});

test('defaults to full system motion without a motion query', async ({ page }) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', false);
  const shell = page.getByTestId('catalog-shell');
  await expect(shell).toHaveAttribute('data-catalog-motion-preference', 'system');
  await expect(shell).toHaveAttribute('data-catalog-motion', 'full');
  expect(new URL(page.url()).searchParams.has('motion')).toBe(false);
  await expect(page.locator('html')).not.toHaveClass(/catalog-(?:full|reduced)-motion/);
});

test('honors reduced system motion by default without a motion query', async ({ page }) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', true);
  const shell = page.getByTestId('catalog-shell');
  await expect(shell).toHaveAttribute('data-catalog-motion-preference', 'system');
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  expect(new URL(page.url()).searchParams.has('motion')).toBe(false);
  await expect(page.locator('html')).not.toHaveClass(/catalog-(?:full|reduced)-motion/);
});

test('keeps live battery policy and explicit preview choices consistent in CSS', async ({
  page,
}) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', false);
  await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
  const shell = page.getByTestId('catalog-shell');
  const readPolicy = () =>
    page.evaluate(async () => {
      const modulePath = '/src/lib/utils/reduced-motion.ts';
      const { prefersReducedMotion } = await import(/* @vite-ignore */ modulePath);
      const dot = document.querySelector('#custom-walkthrough .stepper-dot')!;
      return {
        js: prefersReducedMotion(document),
        css: getComputedStyle(document.documentElement).getPropertyValue('--motion-reduced').trim(),
        stepTransition: getComputedStyle(dot).transitionProperty,
      };
    });
  await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
  await expect(shell).toHaveAttribute('data-catalog-motion-preference', 'system');
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  expect(await readPolicy()).toMatchObject({ js: true, css: '1', stepTransition: 'none' });
  await page.getByRole('radio', { name: 'Full', exact: true }).click();
  await expect(shell).toHaveAttribute('data-catalog-motion', 'full');
  expect(await readPolicy()).toMatchObject({ js: false, css: '0' });
  expect((await readPolicy()).stepTransition).not.toBe('none');
  await page
    .getByTestId('catalog-motion-control')
    .getByRole('radio', { name: 'System', exact: true })
    .click();
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  await page.evaluate(() => document.documentElement.removeAttribute('data-reduce-motion'));
  await expect(shell).toHaveAttribute('data-catalog-motion', 'full');
  expect(await readPolicy()).toMatchObject({ js: false, css: '0' });
  await page.getByRole('radio', { name: 'Reduced', exact: true }).click();
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  expect(await readPolicy()).toMatchObject({ js: true, css: '1', stepTransition: 'none' });
});

// The saved-motion-choice journey is one test per document visit so a single workbench
// load never shares a test budget with another. Each visit seeds the storage record the
// previous visit is asserted to have written.
const catalogPreferencesKey = 'component-catalog-preferences';

async function readStoredCatalogPreferences(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
    catalogPreferencesKey,
  );
}

async function seedStoredCatalogPreferences(page: Page, value: Record<string, unknown>) {
  await page.addInitScript(([key, serialized]) => localStorage.setItem(key, serialized), [
    catalogPreferencesKey,
    JSON.stringify(value),
  ] as const);
}

test('persists an accessible full motion choice over a reduced-motion system', async ({ page }) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', true);
  await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
  await page.getByRole('radio', { name: 'Full', exact: true }).click();
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'full');
  await expect(page.locator('html')).toHaveClass(/catalog-full-motion/);
  expect(new URL(page.url()).searchParams.get('motion')).toBe('full');
  expect(await readStoredCatalogPreferences(page)).toMatchObject({ motion: 'full' });
});

test('hydrates a saved full motion choice and persists a reduced override', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedStoredCatalogPreferences(page, { motion: 'full' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=960${scopeQuery('target')}`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: WORKBENCH_READY_TIMEOUT_MS,
  });
  await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Full', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('radio', { name: 'Reduced', exact: true }).click();
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'reduced');
  await expect(page.locator('html')).toHaveClass(/catalog-reduced-motion/);
  expect(new URL(page.url()).searchParams.get('motion')).toBe('reduced');
  expect(await readStoredCatalogPreferences(page)).toMatchObject({ motion: 'reduced' });
});

test('hydrates a saved reduced motion choice on a later stepped fixture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedStoredCatalogPreferences(page, { motion: 'reduced' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-delivery-walkthrough&theme=light&width=960${scopeQuery('target')}`,
  );
  // This visit checks saved policy hydration, not another gallery transition.
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
    'data-catalog-motion-preference',
    'reduced',
  );
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'reduced');
  await expect(page.locator('html')).toHaveClass(/catalog-reduced-motion/);
  await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Reduced', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

for (const width of [960, 320]) {
  test(`keeps the short ownership kind label on one line at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=${width}&motion=full${scopeQuery('target')}`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: WORKBENCH_READY_TIMEOUT_MS,
    });

    const lineTops = await page
      .locator('#custom-walkthrough [data-node-id="chat"] .node-kind-label')
      .evaluate((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return [...range.getClientRects()].map(({ top }) => Math.round(top * 10) / 10);
      });
    expect(new Set(lineTops).size).toBe(1);
  });
}

test('stepped sandbox controls restore scene content when navigating back', async ({ page }) => {
  await openMotionFixture(page, 'custom-architecture', true, 'all');
  for (const fixture of steppedFixtures) {
    const root = page.locator(`#${fixture.id} .diagram-renderer`);
    const signatures = [await readStableSignature(page, fixture.id)];
    for (let index = 1; index < fixture.steps; index += 1) {
      await root.getByRole('button', { name: 'Next step' }).click();
      await expect(root).toHaveAttribute('data-diagram-settled', 'true');
      const current = await readStableSignature(page, fixture.id);
      expect(current.state).not.toBe(signatures[index - 1].state);
      expect(current.nodes.length).toBeGreaterThan(0);
      expect(await allRoutesComplete(page, fixture.id)).toBe(true);
      signatures.push(current);
    }
    for (let index = fixture.steps - 2; index >= 0; index -= 1) {
      await root.getByRole('button', { name: 'Previous step' }).click();
      await expect(root).toHaveAttribute('data-diagram-settled', 'true');
      expect(await readStableSignature(page, fixture.id)).toEqual(signatures[index]);
      expect(await allRoutesComplete(page, fixture.id)).toBe(true);
    }
  }
  await page.goto(`${baseUrl}/sandbox/button?state=default&motion=reduced`);
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true');
  await expect(page.locator('.diagram-renderer')).toHaveCount(0);
});

for (const appearance of framingAppearances) {
  for (const width of framingWidths) {
    test(`fits each reduced-motion scene above the footer · ${appearance.name} · ${width.name}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const params = new URLSearchParams({
        state: 'custom-architecture',
        theme: appearance.theme,
        width: String(width.value),
        motion: 'reduced',
        cases: 'target',
      });
      if ('colorTheme' in appearance) params.set('colorTheme', appearance.colorTheme);
      await page.goto(`${baseUrl}/sandbox/diagram-workbench?${params}`);
      await expect(page.getByTestId('catalog-scene')).toHaveAttribute(
        'data-preview-ready',
        'true',
        {
          timeout: WORKBENCH_READY_TIMEOUT_MS,
        },
      );
      const root = page.locator('#custom-architecture');
      const buttons = [
        'State 1: 1. Start in the workbench',
        'State 2: 2. Follow the data',
        'State 3: 3. Close the loop',
      ];
      const nodeCounts = [2, 4, 5];
      for (const [index, button] of buttons.entries()) {
        await root.getByRole('button', { name: button }).click();
        await expect(root.locator('.diagram-renderer')).toHaveAttribute(
          'data-diagram-settled',
          'true',
        );
        const metrics = await root.evaluate(async (section) => {
          const renderer = section.querySelector<HTMLElement>('.diagram-renderer')!;
          const viewport = section.querySelector<HTMLElement>('.diagram-scroll-container')!;
          const footer = section.querySelector<HTMLElement>('.diagram-footer')!;
          const svg = viewport.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
          const originalScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
          const nextFrame = () =>
            new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          viewport.scrollTo({ left: 0, top: 0, behavior: 'instant' });
          await nextFrame();

          type PaintDescriptor =
            | { kind: 'element'; id: string; category: string; element: Element; margin: number }
            | { kind: 'text'; id: string; category: string; element: Element; part: number }
            | {
                kind: 'marker';
                id: string;
                category: string;
                element: SVGPathElement;
                distance: number;
              };
          const descriptors: PaintDescriptor[] = [
            ...section.querySelectorAll<SVGGraphicsElement>(
              '[data-node-id], [data-group-id] .group-bg, .group-label, .edge-path, .edge-label-container',
            ),
          ]
            .filter(
              (element) =>
                !element.closest('mask') && Number(getComputedStyle(element).opacity) > 0,
            )
            .map((element, index) => {
              const nodeId = element.closest('[data-node-id]')?.getAttribute('data-node-id');
              const groupId = element.closest('[data-group-id]')?.getAttribute('data-group-id');
              const edgeId = element.closest('[data-edge-id]')?.getAttribute('data-edge-id');
              const category = nodeId
                ? 'node'
                : element.matches('.group-bg, .group-label')
                  ? 'group'
                  : element.matches('.edge-label-container')
                    ? 'label'
                    : 'route';
              const strokeWidth = Number.parseFloat(getComputedStyle(element).strokeWidth) || 0;
              return {
                kind: 'element' as const,
                id: `${category}:${nodeId ?? groupId ?? edgeId ?? index}`,
                category,
                element,
                margin: category === 'route' ? strokeWidth / 2 + 0.5 : 0,
              };
            });
          for (const [index, element] of [
            ...section.querySelectorAll('.node-label, .edge-label-text'),
          ].entries()) {
            const range = document.createRange();
            range.selectNodeContents(element);
            for (let part = 0; part < range.getClientRects().length; part += 1) {
              descriptors.push({
                kind: 'text',
                id: `text:${element.textContent?.trim()}:${index}:${part}`,
                category: 'text',
                element,
                part,
              });
            }
          }
          for (const [index, path] of [
            ...section.querySelectorAll<SVGPathElement>('path.edge-path'),
          ]
            .filter((element) => !element.closest('mask'))
            .entries()) {
            const style = getComputedStyle(path);
            const length = path.getTotalLength();
            const edgeId = path.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? index;
            if (style.markerStart !== 'none')
              descriptors.push({
                kind: 'marker',
                id: `marker-start:${edgeId}`,
                category: 'marker',
                element: path,
                distance: 0,
              });
            if (style.markerEnd !== 'none')
              descriptors.push({
                kind: 'marker',
                id: `marker-end:${edgeId}`,
                category: 'marker',
                element: path,
                distance: length,
              });
          }

          const readPaint = () =>
            descriptors.map((descriptor) => {
              if (descriptor.kind === 'element') {
                const bounds = descriptor.element.getBoundingClientRect();
                return {
                  id: descriptor.id,
                  category: descriptor.category,
                  left: bounds.left - descriptor.margin,
                  right: bounds.right + descriptor.margin,
                  top: bounds.top - descriptor.margin,
                  bottom: bounds.bottom + descriptor.margin,
                };
              }
              if (descriptor.kind === 'text') {
                const range = document.createRange();
                range.selectNodeContents(descriptor.element);
                const bounds = range.getClientRects()[descriptor.part]!;
                return { id: descriptor.id, category: descriptor.category, ...bounds.toJSON() };
              }
              const matrix = descriptor.element.getScreenCTM()!;
              const point = descriptor.element
                .getPointAtLength(descriptor.distance)
                .matrixTransform(matrix);
              const markerRadius = 7;
              return {
                id: descriptor.id,
                category: descriptor.category,
                left: point.x - markerRadius,
                right: point.x + markerRadius,
                top: point.y - markerRadius,
                bottom: point.y + markerRadius,
              };
            });
          const readSample = () => ({
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
            viewport: viewport.getBoundingClientRect().toJSON(),
            svg: svg.getBoundingClientRect().toJSON(),
            paint: readPaint(),
            foreignObjectsContained: [...viewport.querySelectorAll('foreignObject')].every(
              (foreignObject) => {
                const outer = foreignObject.getBoundingClientRect();
                const inner = foreignObject.firstElementChild?.getBoundingClientRect();
                return (
                  !inner ||
                  (inner.left >= outer.left - 1 &&
                    inner.right <= outer.right + 1 &&
                    inner.top >= outer.top - 1 &&
                    inner.bottom <= outer.bottom + 1)
                );
              },
            ),
          });
          const axis = (maximum: number, size: number) => {
            const values = [0];
            for (let value = size * 0.8; value < maximum; value += size * 0.8) values.push(value);
            if (maximum > 0) values.push(maximum);
            return values;
          };
          const maxLeft = viewport.scrollWidth - viewport.clientWidth;
          const maxTop = viewport.scrollHeight - viewport.clientHeight;
          const samples: ReturnType<typeof readSample>[] = [];
          for (const top of axis(maxTop, viewport.clientHeight)) {
            for (const left of axis(maxLeft, viewport.clientWidth)) {
              viewport.scrollTo({ left, top, behavior: 'instant' });
              await nextFrame();
              samples.push(readSample());
            }
          }
          const first = samples[0];
          const localPaint = first.paint.map((paint) => ({
            ...paint,
            left: paint.left - first.viewport.left,
            right: paint.right - first.viewport.left,
            top: paint.top - first.viewport.top,
            bottom: paint.bottom - first.viewport.top,
          }));
          const unreachable = first.paint.flatMap((paint, paintIndex) =>
            (['left', 'right', 'top', 'bottom'] as const).flatMap((side) => {
              const horizontal = side === 'left' || side === 'right';
              return samples.some((sample) => {
                const value = sample.paint[paintIndex][side];
                const start = horizontal ? sample.viewport.left : sample.viewport.top;
                const end = horizontal ? sample.viewport.right : sample.viewport.bottom;
                return value >= start - 1 && value <= end + 1;
              })
                ? []
                : [`${paint.id}:${side}`];
            }),
          );
          const svgLoss = samples.flatMap((sample) =>
            sample.paint.flatMap((paint) =>
              paint.left >= sample.svg.left - 1 &&
              paint.right <= sample.svg.right + 1 &&
              paint.top >= sample.svg.top - 1 &&
              paint.bottom <= sample.svg.bottom + 1
                ? []
                : [paint.id],
            ),
          );

          viewport.scrollTo({ ...originalScroll, behavior: 'instant' });
          const viewportBounds = first.viewport;
          const finiteAnimations = renderer
            .getAnimations({ subtree: true })
            .filter((animation) =>
              Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
            );
          return {
            nodeCount: section.querySelectorAll('[data-node-id]').length,
            footerOffset:
              footer.getBoundingClientRect().bottom - renderer.getBoundingClientRect().bottom,
            clearsFooter: viewportBounds.bottom <= footer.getBoundingClientRect().top + 1,
            overflow: Math.max(
              viewport.scrollWidth - viewport.clientWidth,
              viewport.scrollHeight - viewport.clientHeight,
            ),
            overflowStyle: getComputedStyle(viewport).overflow,
            finiteAnimationCount: finiteAnimations.length,
            clientHeight: viewport.clientHeight,
            scrollHeight: viewport.scrollHeight,
            clientWidth: viewport.clientWidth,
            scrollWidth: viewport.scrollWidth,
            maxLeft,
            maxTop,
            capped: viewport.scrollHeight > viewport.clientHeight + 1,
            fullyContainedAtTop: first.paint.every(
              (paint) =>
                paint.left >= first.viewport.left - 1 &&
                paint.right <= first.viewport.right + 1 &&
                paint.top >= first.viewport.top - 1 &&
                paint.bottom <= first.viewport.bottom + 1,
            ),
            strictHorizontalContainment: samples.every((sample) =>
              sample.paint.every(
                (paint) =>
                  paint.left >= sample.viewport.left - 1 &&
                  paint.right <= sample.viewport.right + 1,
              ),
            ),
            nonnegativePaintOrigin: localPaint.every(
              (paint) => paint.left >= -1 && paint.top >= -1,
            ),
            paintWithinNaturalExtent: localPaint.every(
              (paint) =>
                paint.right <= viewport.scrollWidth + 1 &&
                paint.bottom <= viewport.scrollHeight + 1,
            ),
            unreachable,
            svgLoss,
            foreignObjectsContained: samples.every((sample) => sample.foreignObjectsContained),
            reachedTop: samples.some((sample) => sample.left === 0 && sample.top === 0),
            reachedMaximum: samples.some(
              (sample) => sample.left === maxLeft && sample.top === maxTop,
            ),
            paintCategories: [...new Set(first.paint.map((paint) => paint.category))].sort(),
          };
        });
        expect(metrics.nodeCount).toBe(nodeCounts[index]);
        expect(Math.abs(metrics.footerOffset)).toBeLessThanOrEqual(1);
        expect(metrics.clearsFooter).toBe(true);
        expect(metrics.overflowStyle).toBe('auto');
        expect(metrics.finiteAnimationCount).toBe(0);
        expect(metrics.paintCategories).toEqual([
          'group',
          'label',
          'marker',
          'node',
          'route',
          'text',
        ]);
        expect(metrics.maxLeft, JSON.stringify({ index, metrics })).toBe(0);
        expect(metrics.scrollWidth).toBe(metrics.clientWidth);
        expect(metrics.strictHorizontalContainment, JSON.stringify({ index, metrics })).toBe(true);
        expect(metrics.nonnegativePaintOrigin, JSON.stringify({ index, metrics })).toBe(true);
        expect(metrics.paintWithinNaturalExtent, JSON.stringify({ index, metrics })).toBe(true);
        expect(metrics.unreachable, JSON.stringify({ index, metrics })).toEqual([]);
        expect(metrics.svgLoss, JSON.stringify({ index, metrics })).toEqual([]);
        expect(metrics.foreignObjectsContained, JSON.stringify({ index, metrics })).toBe(true);
        expect(metrics.reachedTop).toBe(true);
        expect(metrics.reachedMaximum).toBe(true);
        if (metrics.capped) {
          expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
          expect(metrics.maxTop).toBe(metrics.scrollHeight - metrics.clientHeight);
        } else {
          expect(metrics.scrollHeight).toBe(metrics.clientHeight);
          expect(metrics.fullyContainedAtTop, JSON.stringify({ index, metrics })).toBe(true);
        }
      }
    });
  }
}
