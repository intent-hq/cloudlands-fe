import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { expectDrawingReachable } from './diagram-scroll-reachability';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const externalBaseUrl = process.env.UI_PREVIEW_BASE_URL;
let baseUrl = externalBaseUrl ?? '';
let server: ViteDevServer | undefined;
const maxActiveSceneGap = 64;

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  if (externalBaseUrl) return;
  const ownedServer = await createServer({
    cacheDir: viteHarnessCacheDir('diagram-active-scene'),
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

const fixtures = [
  {
    id: 'custom-architecture',
    states: ['orient', 'connect', 'observe'],
    first: ['renderer', 'user'],
    last: ['daemon', 'events', 'notes', 'renderer', 'user'],
  },
  {
    id: 'custom-delivery-walkthrough',
    states: ['draft', 'verify', 'publish', 'observe'],
    first: ['author', 'proposal'],
    last: ['audit', 'registry', 'updater'],
  },
];

function sceneGeometry(element: Element) {
  const viewport = element.querySelector('.diagram-scroll-container')!.getBoundingClientRect();
  const drawing = element.querySelector('.diagram-content')!.getBoundingClientRect();
  const svg = element.querySelector<SVGSVGElement>('svg.diagram-svg-layer')!;
  const svgBox = svg.getBoundingClientRect();
  const scale = Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b);
  const painted = [
    ...element.querySelectorAll<SVGGraphicsElement>(
      '[data-node-id], .group-bg, .group-label, .edge-path, .edge-label-container',
    ),
  ];
  const boxes = painted
    .filter((node) => {
      let opacity = 1;
      for (
        let current: Element | null = node;
        current && current !== element;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        opacity *= Number(style.opacity);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return opacity > 0.01;
    })
    .map((node) => {
      const box = node.getBoundingClientRect();
      // Bound the actual path plus its seven-unit arrowhead and non-scaling stroke.
      const margin = node.matches('.edge-path') ? 3.5 * scale + 0.5 : 0.5;
      return {
        left: box.left - margin,
        right: box.right + margin,
        top: box.top - margin,
        bottom: box.bottom + margin,
      };
    });
  const paintedTop = Math.min(...boxes.map((box) => box.top));
  const paintedBottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    state: element.getAttribute('data-diagram-state'),
    settled: element.getAttribute('data-diagram-settled') === 'true',
    width: viewport.width,
    height: viewport.height,
    drawingHeight: drawing.height,
    paintedHeight: paintedBottom - paintedTop,
    topGap: paintedTop - viewport.top,
    bottomGap: viewport.bottom - paintedBottom,
    overflow: Math.max(
      0,
      ...boxes.flatMap((box) => [
        Math.max(drawing.left, svgBox.left) - box.left,
        box.right - Math.min(drawing.right, svgBox.right),
        Math.max(drawing.top, svgBox.top) - box.top,
        box.bottom - Math.min(drawing.bottom, svgBox.bottom),
      ]),
    ),
    nodes: [...element.querySelectorAll('[data-node-id]')]
      .map((node) => node.getAttribute('data-node-id'))
      .sort(),
    groups: [...element.querySelectorAll('[data-group-id]')]
      .map((node) => node.getAttribute('data-group-id'))
      .sort(),
    labels: [...element.querySelectorAll('.edge-label-container')]
      .map((node) => node.getAttribute('data-edge-id'))
      .sort(),
    edges: [...element.querySelectorAll<SVGPathElement>('.edge-path')].map((node) => ({
      id: node.closest('[data-edge-id]')!.getAttribute('data-edge-id'),
      path: node.getAttribute('d'),
      length: node.getTotalLength(),
    })),
    minPrimaryFont: Math.min(
      ...[...element.querySelectorAll('.node-label')].map(
        (node) => Number.parseFloat(getComputedStyle(node).fontSize) * scale,
      ),
    ),
    finite: boxes.length > 0 && boxes.every((box) => Object.values(box).every(Number.isFinite)),
    scale,
  };
}

async function sampleStep(root: Locator, index: number) {
  return root.evaluate(
    async (element, { source, index }) => {
      const read = new Function(`return (${source})`)() as typeof sceneGeometry;
      const samples = [read(element)];
      element.querySelectorAll<HTMLButtonElement>('[data-diagram-step-index]')[index].click();
      const started = performance.now();
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push(read(element));
      } while (
        (!samples.at(-1)!.settled || samples.length < 4) &&
        performance.now() - started < 4_000
      );
      return samples;
    },
    { source: sceneGeometry.toString(), index },
  );
}

async function captureScene(root: Locator, info: TestInfo, name: string) {
  // A whole diagram can exceed the viewport. Chromium's oversized element capture
  // emits resize events that relayout responsive diagrams (intent-hq/intent#5956).
  // Capture every region separately without resizing the viewport under test.
  for (const [region, selector] of [
    ['actions', '.diagram-actions'],
    ['drawing', '.diagram-scroll-container'],
    ['controls', '.diagram-footer'],
  ]) {
    await root.locator(selector).screenshot({ path: info.outputPath(`${name}-${region}.png`) });
  }
}

test('capturing a tall scene preserves the viewport and every diagram region', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.setContent(`
    <style>
      body { margin: 0; }
      .diagram-renderer { width: 360px; margin: 50px; }
      .diagram-actions { height: 35px; }
      .diagram-scroll-container { height: 90vh; }
      .diagram-footer { height: 100px; }
    </style>
    <div class="diagram-renderer">
      <div class="diagram-actions">Fit diagram</div>
      <div class="diagram-scroll-container">Active scene</div>
      <div class="diagram-footer">Previous / Next</div>
    </div>
  `);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    document.documentElement.dataset.captureResizes = '0';
    window.addEventListener('resize', () => {
      document.documentElement.dataset.captureResizes = String(
        Number(document.documentElement.dataset.captureResizes) + 1,
      );
    });
  });

  await captureScene(page.locator('.diagram-renderer'), testInfo, 'tall-scene');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator('html')).toHaveAttribute('data-capture-resizes', '0');
  for (const [region, height] of [
    ['actions', 35],
    ['drawing', 900],
    ['controls', 100],
  ] as const) {
    const png = await readFile(testInfo.outputPath(`tall-scene-${region}.png`));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({
      width: 360,
      height,
    });
  }
});

for (const fixture of fixtures) {
  for (const width of [960, 420]) {
    for (const motion of ['reduced', 'full']) {
      test(`fits only active painted scene · ${fixture.id} · ${width} · ${motion}`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.emulateMedia({
          reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
        });
        await page.goto(
          `${baseUrl}/sandbox/diagram-workbench?state=${fixture.id}&theme=light&width=${width}&motion=${motion}`,
        );
        const root = page.locator(`#${fixture.id} .diagram-renderer`);
        await expect(page.getByTestId('catalog-scene')).toHaveAttribute(
          'data-preview-ready',
          'true',
          { timeout: 60_000 },
        );
        await page.evaluate(() => document.fonts.ready);
        await expect(root).toHaveAttribute('data-diagram-settled', 'true', { timeout: 30_000 });
        const scenes = [];
        const transitions = [];
        for (const index of [...fixture.states.keys(), 0]) {
          const samples = await sampleStep(root, index);
          transitions.push(samples);
          scenes.push(samples.at(-1)!);
          await expectDrawingReachable(root);
          await captureScene(root, testInfo, `step-${scenes.length}-${index}`);
        }
        await testInfo.attach('active-scenes', {
          body: JSON.stringify(scenes, null, 2),
          contentType: 'application/json',
        });
        await testInfo.attach('active-transitions', {
          body: JSON.stringify(transitions, null, 2),
          contentType: 'application/json',
        });
        for (const samples of transitions) {
          expect(samples.at(-1)!.settled).toBe(true);
          expect(samples.every((sample) => sample.finite)).toBe(true);
          expect(
            Math.max(...samples.map((sample) => sample.overflow)),
            JSON.stringify(samples.filter((sample) => sample.overflow > 1)),
          ).toBeLessThanOrEqual(1);
        }
        expect(scenes[0].nodes).toEqual(fixture.first);
        expect(scenes.at(-2)!.nodes).toEqual(fixture.last);
        expect(scenes.at(-1)!.height).toBeCloseTo(scenes[0].height, 0);
        expect(scenes.at(-1)!.scale).toBeCloseTo(scenes[0].scale, 4);
        for (const [index, scene] of scenes.entries()) {
          expect(scene.state).toBe(fixture.states[index % fixture.states.length]);
          expect(scene.finite).toBe(true);
          expect(scene.minPrimaryFont).toBeGreaterThanOrEqual(12);
          expect(scene.edges.every((edge) => edge.path && edge.length > 0)).toBe(true);
          expect(scene.overflow, JSON.stringify(scene)).toBeLessThanOrEqual(1);
          expect(scene.topGap, JSON.stringify(scene)).toBeLessThanOrEqual(maxActiveSceneGap);
          expect(scene.bottomGap, JSON.stringify(scene)).toBeLessThanOrEqual(maxActiveSceneGap);
        }
        expect(Math.max(...scenes.map((scene) => scene.drawingHeight))).toBeGreaterThan(
          scenes[0].height + 40,
        );
        expect(
          Math.max(...scenes.map((scene) => scene.height - scene.paintedHeight)),
        ).toBeLessThanOrEqual(maxActiveSceneGap * 2);
      });
    }
  }
}
