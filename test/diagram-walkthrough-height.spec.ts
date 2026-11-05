import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const externalBaseUrl = process.env.UI_PREVIEW_BASE_URL;
let baseUrl = externalBaseUrl ?? '';
let server: ViteDevServer | undefined;

test.describe.configure({ mode: 'default', timeout: 120_000 });

// Keep original failing attempts available alongside their geometry.
test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });

test.beforeAll(async () => {
  if (externalBaseUrl) return;
  const ownedServer = await createServer({
    cacheDir: viteHarnessCacheDir('diagram-walkthrough-height'),
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

const states = [
  { id: 'request', nodes: ['chat', 'redux', 'user'], edges: ['w1', 'w2', 'w3'] },
  { id: 'execute', nodes: ['chat', 'daemon', 'redux'], edges: ['w3', 'w4', 'w5'] },
  { id: 'render', nodes: ['chat', 'daemon', 'redux'], edges: ['w2', 'w5'] },
];

function geometry(element: Element) {
  const root = element as HTMLElement;
  const viewport = root.querySelector('.diagram-scroll-container')!.getBoundingClientRect();
  const outer = root.getBoundingClientRect();
  const visible = (node: Element) => {
    let opacity = 1;
    for (
      let current: Element | null = node;
      current && current !== root;
      current = current.parentElement
    ) {
      const style = getComputedStyle(current);
      opacity *= Number(style.opacity);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
    }
    return opacity > 0.01;
  };
  const painted = [
    ...root.querySelectorAll('[data-node-id], .edge-path, .edge-label-container'),
  ].filter(visible);
  const bounds = painted.map((node) => node.getBoundingClientRect());
  const top = Math.min(...bounds.map((box) => box.top));
  const bottom = Math.max(...bounds.map((box) => box.bottom));
  const svg = root.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
  const scale = Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b);
  const fonts = [...root.querySelectorAll('.node-label,.node-kind,.edge-label-html')].map(
    (node) => ({
      css: Number.parseFloat(getComputedStyle(node).fontSize),
      screen: Number.parseFloat(getComputedStyle(node).fontSize) * scale,
      primary: node.classList.contains('node-label'),
    }),
  );
  return {
    state: root.dataset.diagramState,
    settled: root.dataset.diagramSettled === 'true',
    phase: root.dataset.diagramMotionPhase,
    width: viewport.width,
    height: viewport.height,
    contentHeight: bottom - top,
    whitespace: viewport.height - (bottom - top),
    controlOffset: root.querySelector('.state-navigation')!.getBoundingClientRect().top - outer.top,
    footerOffset: root.querySelector('.diagram-footer')!.getBoundingClientRect().top - outer.top,
    nodes: [...root.querySelectorAll('[data-node-id]')]
      .map((node) => node.getAttribute('data-node-id'))
      .sort(),
    paintedNodes: painted
      .filter((node) => node.hasAttribute('data-node-id'))
      .map((node) => node.getAttribute('data-node-id'))
      .sort(),
    edges: [...root.querySelectorAll('.diagram-edge')]
      .map((node) => node.getAttribute('data-edge-id'))
      .sort(),
    labels: [...root.querySelectorAll('.edge-label-container')]
      .map((node) => node.getAttribute('data-edge-id'))
      .sort(),
    overflow: Math.max(
      0,
      ...bounds.flatMap((box) => [
        viewport.left - box.left,
        box.right - viewport.right,
        viewport.top - box.top,
        box.bottom - viewport.bottom,
      ]),
    ),
    overflowElements: painted.flatMap((node, index) => {
      const box = bounds[index];
      if (
        box.left >= viewport.left - 1 &&
        box.right <= viewport.right + 1 &&
        box.top >= viewport.top - 1 &&
        box.bottom <= viewport.bottom + 1
      )
        return [];
      return [
        {
          id:
            node.getAttribute('data-node-id') ??
            node.closest('[data-edge-id]')?.getAttribute('data-edge-id'),
          tag: node.tagName,
          x: box.x - viewport.x,
          y: box.y - viewport.y,
          width: box.width,
          height: box.height,
        },
      ];
    }),
    resizing: root.classList.contains('resizing'),
    scale,
    fonts,
    finitePaint:
      bounds.length > 0 &&
      bounds.every((box) => [box.x, box.y, box.width, box.height].every(Number.isFinite)),
    animationCount: root
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState !== 'finished').length,
  };
}

async function open(page: Page, width: number, motion: string) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  // Exercise the catalog's explicit motion preference in isolation. Combining it with the
  // OS reduced-motion blanket creates Chromium's 0.01ms bookkeeping animations.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=${width}&motion=${motion}`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 90_000,
  });
  await page.evaluate(() => document.fonts.ready);
  const root = page.locator('#custom-walkthrough .diagram-renderer');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true', { timeout: 30_000 });
  await root.scrollIntoViewIfNeeded();
  return root;
}

// Wide sandbox, the native note lane, and narrow reflow exercise content containment.
for (const width of [960, 662, 420]) {
  test(`walkthrough retains scene content and reachable controls at ${width}px`, async ({
    page,
  }, testInfo) => {
    const root = await open(page, width, 'reduced');
    const steps = [];
    for (const index of [0, 1, 2, 0]) {
      await root.locator('.stepper-dot').nth(index).click();
      await expect(root).toHaveAttribute('data-diagram-state', states[index].id);
      await expect(root).toHaveAttribute('data-diagram-settled', 'true');
      const step = await root.evaluate(geometry);
      expect(step.nodes).toEqual(states[index].nodes);
      expect(step.paintedNodes).toEqual(states[index].nodes);
      expect(step.edges).toEqual(states[index].edges);
      expect(step.labels).toEqual(states[index].edges);
      expect(step.finitePaint).toBe(true);
      expect(step.overflow).toBeLessThanOrEqual(1);
      const controls = root.locator('.state-navigation');
      await expect(controls).toBeVisible();
      expect(
        await controls.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const footer = element.closest('.diagram-footer')!.getBoundingClientRect();
          return rect.top >= footer.top - 1 && rect.bottom <= footer.bottom + 1;
        }),
      ).toBe(true);
      steps.push(step);
    }
    await testInfo.attach('step-geometry', {
      body: JSON.stringify(steps, null, 2),
      contentType: 'application/json',
    });
    await root.screenshot({ path: testInfo.outputPath('compact-walkthrough.png') });
  });
}
