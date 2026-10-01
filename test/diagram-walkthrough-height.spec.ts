import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function sampleChange(
  root: Locator,
  index: number,
  resizeWidth?: number,
  interrupt?: boolean,
) {
  return root.evaluate(
    async (element, { source, index, resizeWidth, interrupt }) => {
      const read = new Function(`return (${source})`)() as typeof geometry;
      const samples = [read(element)];
      let frameSample = samples[0];
      // A non-painted probe requests an observation every frame, even when only a
      // transform changes. Register after the renderer's observer so its synchronous
      // refit and all rAF callbacks are included before paint.
      const frameProbe = resizeWidth ? document.createElement('div') : undefined;
      if (frameProbe) {
        frameProbe.style.cssText =
          'position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;contain:strict;' +
          'transition:none!important;animation:none!important;width:0;height:0';
        element.append(frameProbe);
      }
      const observer = resizeWidth
        ? new ResizeObserver(() => {
            frameSample = read(element);
          })
        : undefined;
      if (frameProbe) observer?.observe(frameProbe);
      observer?.observe(element.querySelector('.diagram-scroll-container')!);
      try {
        element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[index].click();
        if (resizeWidth) {
          const host = element.closest<HTMLElement>('[data-testid="catalog-scene-focus"]')!;
          host.style.width = `${resizeWidth}px`;
        }
        const start = performance.now();
        do {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => {
              if (frameProbe) frameProbe.style.width = `${(samples.length % 2) + 1}px`;
              resolve();
            }),
          );
          // Deliver the frame after ResizeObserver has updated it. Remeasuring in
          // this task can advance the catalog's 0.01ms ancestor width transition
          // between paints, before the renderer receives that new lane width.
          if (resizeWidth) await new Promise<void>((resolve) => setTimeout(resolve, 0));
          samples.push(resizeWidth ? frameSample : read(element));
          if (interrupt && samples.length === 3) {
            element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[2].click();
            element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[0].click();
          }
        } while (
          (!samples.at(-1)!.settled || samples.length < 4) &&
          performance.now() - start < 4_000
        );
      } finally {
        observer?.disconnect();
        frameProbe?.remove();
      }
      return samples;
    },
    { source: geometry.toString(), index, resizeWidth, interrupt },
  );
}

// Wide sandbox, the measured native note lane, and narrow reflow are distinct contracts.
for (const width of [960, 662, 420]) {
  for (const motion of ['full', 'reduced']) {
    test(`compact walkthrough retains content and stable controls · ${width}px · ${motion}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      const root = await open(page, width, motion);
      const steps = [await root.evaluate(geometry)];
      const transitions = [];
      for (const index of [1, 2, 0]) {
        const samples = await sampleChange(root, index);
        transitions.push(samples);
        const last = samples.at(-1)!;
        expect(last.settled).toBe(true);
        expect(last.nodes).toEqual(states[index].nodes);
        expect(last.edges).toEqual(states[index].edges);
        expect(last.labels).toEqual(states[index].edges);
        steps.push(last);
      }
      await testInfo.attach('step-geometry', {
        body: JSON.stringify({ steps, transitions }, null, 2),
        contentType: 'application/json',
      });
      // A temporary transition frame must release its departing-scene space.
      expect(steps.at(-1)!.height).toBeCloseTo(steps[0].height, 0);
      expect(steps.at(-1)!.scale).toBeCloseTo(steps[0].scale, 4);
      if (motion === 'full') {
        const departure = transitions[0];
        // Keep the outgoing user visible during its exit, rather than dropping
        // paint to satisfy containment. Check every observed transition phase.
        expect(
          departure.some(
            (sample) => sample.phase === 'exit' && sample.paintedNodes.includes('user'),
          ),
        ).toBe(true);
        for (const phase of ['camera', 'exit', 'scene']) {
          const frames = departure.filter((sample) => sample.phase === phase);
          expect(frames.length, phase).toBeGreaterThan(0);
          expect(Math.max(...frames.map((sample) => sample.overflow)), phase).toBeLessThanOrEqual(
            1,
          );
        }
      }
      // Active-scene sizing intentionally changes height between steps. Bound each
      // step's own whitespace, not a union or the first step's reserved frame.
      for (const step of steps) {
        expect(step.height).toBeLessThanOrEqual(step.contentHeight + 140);
        expect(step.controlOffset - step.footerOffset).toBeCloseTo(
          steps[0].controlOffset - steps[0].footerOffset,
          0,
        );
        expect(step.fonts.length).toBeGreaterThanOrEqual(5);
        expect(Math.min(...step.fonts.map((font) => font.css))).toBeGreaterThanOrEqual(10);
        expect(Math.min(...step.fonts.map((font) => font.screen))).toBeGreaterThanOrEqual(10);
        expect(step.fonts.filter((font) => font.primary).every((font) => font.screen >= 12)).toBe(
          true,
        );
        expect(step.overflow).toBeLessThanOrEqual(1);
        expect(step.nodes.length).toBe(3);
        expect(
          [step.width, step.height, step.contentHeight, step.scale].every(Number.isFinite),
        ).toBe(true);
      }
      for (const samples of transitions) {
        expect(samples.every((sample) => sample.finitePaint)).toBe(true);
        expect(Math.max(...samples.map((sample) => sample.overflow))).toBeLessThanOrEqual(1);
        const navigationOffsets = samples.map(
          (sample) => sample.controlOffset - sample.footerOffset,
        );
        expect(Math.max(...navigationOffsets) - Math.min(...navigationOffsets)).toBeLessThanOrEqual(
          1,
        );
        if (motion === 'reduced')
          expect(samples.every((sample) => sample.animationCount === 0)).toBe(true);
        else expect(samples.some((sample) => sample.animationCount > 0)).toBe(true);
      }
      const rapid = await sampleChange(root, 1, undefined, true);
      await testInfo.attach('rapid-geometry', {
        body: JSON.stringify(rapid),
        contentType: 'application/json',
      });
      expect(rapid.at(-1)!.settled).toBe(true);
      expect(rapid.every((sample) => sample.finitePaint)).toBe(true);
      expect(rapid.at(-1)!.state).toBe('request');
      expect(rapid.at(-1)!.nodes).toEqual(states[0].nodes);
      expect(rapid.at(-1)!.edges).toEqual(states[0].edges);
      expect(Math.max(...rapid.map((sample) => sample.overflow))).toBeLessThanOrEqual(1);
      const resize = [];
      const resizeSegments = [];
      for (const [index, resizeWidth] of [
        [1, 420],
        [2, 960],
        [0, width],
      ]) {
        const samples = await sampleChange(root, index, resizeWidth);
        resize.push(...samples);
        resizeSegments.push({ index, resizeWidth, samples });
      }
      await testInfo.attach('resize-geometry', {
        body: JSON.stringify(resize, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach('resize-segments', {
        body: JSON.stringify(resizeSegments, null, 2),
        contentType: 'application/json',
      });
      expect(resize.at(-1)!.settled).toBe(true);
      expect(resize.every((sample) => sample.finitePaint)).toBe(true);
      expect(Math.max(...resize.map((sample) => sample.overflow))).toBeLessThanOrEqual(1);
      for (const { index, samples } of resizeSegments) {
        const final = samples.at(-1)!;
        expect(final.settled).toBe(true);
        expect(final.state).toBe(states[index].id);
        expect(final.nodes).toEqual(states[index].nodes);
        expect(final.paintedNodes).toEqual(states[index].nodes);
        expect(final.edges).toEqual(states[index].edges);
        expect(final.labels).toEqual(states[index].edges);
        expect(final.fonts.length).toBeGreaterThanOrEqual(5);
        expect(Math.min(...final.fonts.map((font) => font.css))).toBeGreaterThanOrEqual(10);
        expect(Math.min(...final.fonts.map((font) => font.screen))).toBeGreaterThanOrEqual(10);
        expect(final.fonts.filter((font) => font.primary).every((font) => font.screen >= 12)).toBe(
          true,
        );
        const offsets = samples.map((sample) => sample.controlOffset - sample.footerOffset);
        expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThanOrEqual(1);
        if (motion === 'reduced') {
          expect(samples.every((sample) => sample.animationCount === 0)).toBe(true);
        }
      }
      await root.screenshot({ path: testInfo.outputPath('compact-walkthrough.png') });
    });
  }
}

// Moving an ancestor changes viewport coordinates without changing the diagram's
// own geometry. It must not keep a completed resize in the settling state.
test('walkthrough settles a resize while its ancestor moves', async ({ page }, testInfo) => {
  const root = await open(page, 662, 'reduced');
  const result = await root.evaluate(async (element, source) => {
    const read = new Function(`return (${source})`)() as typeof geometry;
    const host = element.closest<HTMLElement>('[data-testid="catalog-scene-focus"]')!;
    const motion = host.animate(
      [{ transform: 'translateY(0px)' }, { transform: 'translateY(8px)' }],
      { duration: 800, iterations: Infinity, direction: 'alternate', easing: 'linear' },
    );
    const samples = [];
    try {
      element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[1].click();
      host.style.width = '420px';
      const start = performance.now();
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        samples.push({ ...read(element), rootTop: element.getBoundingClientRect().top });
      } while (
        (!samples.at(-1)!.settled || samples.length < 4) &&
        performance.now() - start < 4000
      );
      return { samples, ancestorStillMoving: motion.playState === 'running' };
    } finally {
      motion.cancel();
    }
  }, geometry.toString());
  await testInfo.attach('ancestor-motion-geometry', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.ancestorStillMoving).toBe(true);
  const tops = result.samples.map((sample) => sample.rootTop);
  expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(0.01);
  expect(result.samples.at(-1)!.settled).toBe(true);
  expect(result.samples.at(-1)!.state).toBe('execute');
  expect(result.samples.every((sample) => sample.finitePaint)).toBe(true);
  expect(Math.max(...result.samples.map((sample) => sample.overflow))).toBeLessThanOrEqual(1);
  // Capture the viewport after the behavioral checks: a locator clip can become
  // stale while surrounding catalog sections reposition the settled diagram.
  await root.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('ancestor-motion-walkthrough.png') });
});

// Reusing the mounted scene exposes resize delivery races that a fresh page can miss.
test('walkthrough repeated resizing keeps painted content contained', async ({
  page,
}, testInfo) => {
  const root = await open(page, 662, 'reduced');
  const rounds = [];
  for (let round = 0; round < 3; round += 1) {
    for (const index of [1, 2, 0]) await sampleChange(root, index);
    await sampleChange(root, 1, undefined, true);
    const segments = [];
    for (const [index, width] of [
      [1, 420],
      [2, 960],
      [0, 662],
    ]) {
      segments.push({ index, width, samples: await sampleChange(root, index, width) });
    }
    rounds.push(segments);
  }
  await testInfo.attach('repeated-resize-geometry', {
    body: JSON.stringify(rounds, null, 2),
    contentType: 'application/json',
  });
  for (const segments of rounds) {
    for (const { index, samples } of segments) {
      expect(Math.max(...samples.map((sample) => sample.overflow))).toBeLessThanOrEqual(1);
      expect(samples.every((sample) => sample.finitePaint)).toBe(true);
      expect(samples.every((sample) => sample.animationCount === 0)).toBe(true);
      const final = samples.at(-1)!;
      expect(final.settled).toBe(true);
      expect(final.nodes).toEqual(states[index].nodes);
      expect(final.edges).toEqual(states[index].edges);
      expect(final.labels).toEqual(states[index].edges);
    }
  }
});

// A cached source frame must not hide a defect introduced by the interaction.
test('resize sampling detects painted overflow and control movement', async ({
  page,
}, testInfo) => {
  const root = await open(page, 662, 'reduced');
  await root.evaluate((element) => {
    element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[0].addEventListener(
      'click',
      () => {
        const node = element.querySelector<SVGElement>('[data-node-id="redux"]')!;
        const controls = element.querySelector<HTMLElement>('.state-navigation')!;
        node.style.translate = '200px 0';
        controls.style.translate = '0 12px';
      },
      { once: true },
    );
  });
  const samples = await sampleChange(root, 0, 662);
  await testInfo.attach('painted-defect-control', {
    body: JSON.stringify(samples, null, 2),
    contentType: 'application/json',
  });
  expect(samples[0].overflow).toBeLessThanOrEqual(1);
  expect(Math.max(...samples.map((sample) => sample.overflow))).toBeGreaterThan(1);
  const offsets = samples.map((sample) => sample.controlOffset - sample.footerOffset);
  expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(1);
  expect(samples.at(-1)!.overflow).toBeGreaterThan(1);
  await root.screenshot({ path: testInfo.outputPath('painted-defect-control.png') });
});

// Unlike a persistent defect, this paint disappears before the following sampler rAF.
test('resize sampling detects one painted frame from a later callback', async ({
  page,
}, testInfo) => {
  const root = await open(page, 662, 'reduced');
  await root.evaluate((element, source) => {
    const read = new Function(`return (${source})`)() as typeof geometry;
    const target = element as HTMLElement & { paintedDefect: ReturnType<typeof geometry>[] };
    target.paintedDefect = [];
    element.querySelector('.stepper-dot')!.addEventListener(
      'click',
      () => {
        // Register after the sampler rAF, then after its post-frame task. The initial
        // observer delivery has finished before the one-frame defect is introduced.
        queueMicrotask(() =>
          requestAnimationFrame(() =>
            setTimeout(
              () =>
                requestAnimationFrame(() => {
                  const node = element.querySelector<SVGElement>('[data-node-id="redux"]')!;
                  const controls = element.querySelector<HTMLElement>('.state-navigation')!;
                  node.style.translate = '200px 0';
                  controls.style.translate = '0 12px';
                  target.paintedDefect.push(read(element));
                  requestAnimationFrame(() => {
                    node.style.removeProperty('translate');
                    controls.style.removeProperty('translate');
                    target.paintedDefect.push(read(element));
                  });
                }),
              0,
            ),
          ),
        );
      },
      { once: true },
    );
  }, geometry.toString());
  const samples = await sampleChange(root, 0, 662);
  const injected = await root.evaluate(
    (element) =>
      (element as HTMLElement & { paintedDefect: ReturnType<typeof geometry>[] }).paintedDefect,
  );
  await testInfo.attach('one-frame-defect-control', {
    body: JSON.stringify({ samples, injected }, null, 2),
    contentType: 'application/json',
  });
  expect(injected).toHaveLength(2);
  expect(injected[0].overflow).toBeGreaterThan(1);
  expect(injected[1].overflow).toBeLessThanOrEqual(1);
  expect(samples[0].overflow).toBeLessThanOrEqual(1);
  expect(Math.max(...samples.map((sample) => sample.overflow))).toBeGreaterThan(1);
  const offsets = samples.map((sample) => sample.controlOffset - sample.footerOffset);
  expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(1);
  expect(samples.at(-1)!.overflow).toBeLessThanOrEqual(1);
});
