import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL ?? 'http://127.0.0.1:5173';
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
  await page.emulateMedia({ reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=${width}&motion=${motion}`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
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
      element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[index].click();
      if (resizeWidth) {
        const host = element.closest<HTMLElement>('[data-testid="catalog-scene-focus"]')!;
        host.style.width = `${resizeWidth}px`;
      }
      const start = performance.now();
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        // ResizeObserver runs after rAF. Sample the resulting paint, not a forced
        // layout read before the browser has delivered the new lane width.
        if (resizeWidth) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        samples.push(read(element));
        if (interrupt && samples.length === 3) {
          element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[2].click();
          element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[0].click();
        }
      } while (
        (!samples.at(-1)!.settled || samples.length < 4) &&
        performance.now() - start < 4_000
      );
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
      for (const [index, resizeWidth] of [
        [1, 420],
        [2, 960],
        [0, width],
      ]) {
        resize.push(...(await sampleChange(root, index, resizeWidth)));
      }
      await testInfo.attach('resize-geometry', {
        body: JSON.stringify(resize, null, 2),
        contentType: 'application/json',
      });
      expect(resize.at(-1)!.settled).toBe(true);
      expect(resize.every((sample) => sample.finitePaint)).toBe(true);
      expect(Math.max(...resize.map((sample) => sample.overflow))).toBeLessThanOrEqual(1);
      await root.screenshot({ path: testInfo.outputPath('compact-walkthrough.png') });
    });
  }
}
