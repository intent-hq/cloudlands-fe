import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const externalBaseUrl = process.env.UI_PREVIEW_BASE_URL;
let baseUrl = externalBaseUrl ?? '';
let server: ViteDevServer | undefined;

test.describe.configure({ mode: 'default', timeout: 120_000 });

// Keep first-attempt failures alongside the raw geometry. A failure screenshot is
// post-failure; trace frames are sampled. Neither proves the violating box was painted.
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

type SettlementCapture6036 = {
  target: Element | null;
  records: (Record<string, unknown> | null)[];
  count: number;
  overflow: boolean;
  incomplete: boolean;
  segment: string;
  snapshots: string[];
  serializedUnits: number;
};

function geometry(element: Element) {
  const root = element as HTMLElement;
  const capture = (
    globalThis as typeof globalThis & {
      __walkthroughSettlement6036?: SettlementCapture6036;
    }
  ).__walkthroughSettlement6036;
  if (capture) {
    if (capture.target === null) capture.target = root;
    else if (capture.target !== root) capture.incomplete = true;
  }
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
    settlementDiagnostic: {
      sampledAt: performance.now(),
      timeOrigin: performance.timeOrigin,
      segment: capture?.segment ?? null,
      decisionCount: capture?.count ?? null,
      rootLeft: outer.left,
      rootTop: outer.top,
      rootWidth: outer.width,
      rootHeight: outer.height,
      viewportLeft: viewport.left,
      viewportTop: viewport.top,
      documentScrollTop: root.ownerDocument.scrollingElement?.scrollTop ?? null,
    },
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
      const capture = (
        globalThis as typeof globalThis & {
          __walkthroughSettlement6036?: SettlementCapture6036;
        }
      ).__walkthroughSettlement6036;
      if (capture)
        capture.segment = `${interrupt ? 'rapid' : resizeWidth ? 'resize' : 'step'}:${index}:${resizeWidth ?? 'unchanged'}`;
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
      const captureSelected = width === 420;
      let captureAttachmentAttempted = false;
      let selectedBindingStarted = false;
      let selectedDocumentLost = false;
      let mainNavigationCount = 0;
      const selectedMainFrame = page.mainFrame();
      const observeMainNavigation = (frame: ReturnType<Page['mainFrame']>) => {
        if (frame !== selectedMainFrame) return;
        mainNavigationCount += 1;
        if (selectedBindingStarted) selectedDocumentLost = true;
      };
      const observeDocumentLoss = () => {
        selectedDocumentLost = true;
      };
      if (captureSelected) {
        page.on('framenavigated', observeMainNavigation);
        page.on('close', observeDocumentLoss);
        page.on('crash', observeDocumentLoss);
      }
      const attachSettlementDecisions = async (boundary: string) => {
        if (!captureSelected || captureAttachmentAttempted) return;
        captureAttachmentAttempted = true;
        let payload: Record<string, unknown>;
        const navigationsBeforeCollection = mainNavigationCount;
        try {
          payload = await page.evaluate((boundary) => {
            const capture = (
              globalThis as typeof globalThis & {
                __walkthroughSettlement6036?: SettlementCapture6036;
              }
            ).__walkthroughSettlement6036;
            if (!capture) return { boundary, incomplete: true, reason: 'missing-buffer' };
            return {
              boundary,
              capacity: 4096,
              count: capture.count,
              overflow: capture.overflow,
              incomplete:
                capture.incomplete ||
                capture.overflow ||
                capture.target === null ||
                capture.count === 0,
              targetBound: capture.target !== null,
              records: capture.records.slice(0, capture.count),
              snapshots: capture.snapshots,
              serializedUnits: capture.serializedUnits,
            };
          }, boundary);
        } catch (error) {
          payload = {
            boundary,
            incomplete: true,
            reason: 'collection-error',
            error: String(error),
          };
        }
        payload.documentContinuity = {
          bindingStarted: selectedBindingStarted,
          mainNavigationCount,
          navigationsBeforeCollection,
          lost: selectedDocumentLost,
        };
        payload.incomplete =
          payload.incomplete === true ||
          !selectedBindingStarted ||
          selectedDocumentLost ||
          mainNavigationCount !== navigationsBeforeCollection;
        try {
          const serialized = JSON.stringify(payload);
          const body =
            Buffer.byteLength(serialized, 'utf8') <= 8 * 1024 * 1024
              ? serialized
              : JSON.stringify({ boundary, incomplete: true, reason: 'attachment-cap' });
          await testInfo.attach('settlement-decisions', {
            body,
            contentType: 'application/json',
          });
        } catch (error) {
          // Missing attachment invalidates diagnostic evidence, never the original oracle result.
          console.warn('6036 settlement diagnostic attachment failed', String(error));
        }
      };
      let paintAttempted = false;
      let paintIncomplete = false;
      const paintEvidence: Record<string, unknown>[] = [];
      const observeFailedSegmentPaint = async (
        root: Locator,
        index: number,
        resizeWidth: number,
        samples: Awaited<ReturnType<typeof sampleChange>>,
      ) => {
        if (!captureSelected || paintAttempted || samples.at(-1)?.settled !== false) return;
        paintAttempted = true;
        const event: Record<string, unknown> = {
          index,
          resizeWidth,
          failedSample: samples.at(-1),
          hostStartedAt: Date.now(),
          incomplete: false,
          qualification:
            'After sample return; target capture may scroll/wait. Neither image is the original sampled frame.',
        };
        paintEvidence.push(event);
        try {
          const before = await root.evaluate(geometry);
          event.before = before;
          const viewport = page.viewportSize();
          if (!viewport || viewport.width !== 1280 || viewport.height !== 1000) {
            throw new Error('Unexpected diagnostic viewport');
          }
          const d = before.settlementDiagnostic;
          if (
            !Number.isFinite(d.rootWidth) ||
            !Number.isFinite(d.rootHeight) ||
            d.rootWidth <= 0 ||
            d.rootHeight <= 0 ||
            d.rootWidth > 1600 ||
            d.rootHeight > 1200 ||
            d.rootWidth * d.rootHeight > 1_500_000
          ) {
            throw new Error('Target exceeds finite paint-capture bounds');
          }
          const attachPNG = async (name: string, png: Buffer) => {
            if (png.byteLength > 8 * 1024 * 1024) throw new Error('PNG exceeds cap');
            await testInfo.attach(name, { body: png, contentType: 'image/png' });
          };
          const beforeNavigationCount = mainNavigationCount;
          await attachPNG(
            'unsettled-segment-viewport',
            await page.screenshot({
              animations: 'allow',
              caret: 'initial',
              fullPage: false,
              timeout: 2_000,
            }),
          );
          event.afterViewport = await root.evaluate(geometry);
          await attachPNG(
            'unsettled-segment-target-later',
            await root.screenshot({
              animations: 'allow',
              caret: 'initial',
              timeout: 2_000,
            }),
          );
          event.afterTarget = await root.evaluate(geometry);
          event.beforeNavigationCount = beforeNavigationCount;
          event.afterNavigationCount = mainNavigationCount;
          if (selectedDocumentLost || mainNavigationCount !== beforeNavigationCount) {
            throw new Error('Document continuity lost during paint capture');
          }
        } catch (error) {
          paintIncomplete = true;
          event.incomplete = true;
          event.error = String(error).slice(0, 1024);
        } finally {
          event.hostEndedAt = Date.now();
        }
      };
      let paintAttachmentAttempted = false;
      const attachPaintEvidence = async () => {
        if (!captureSelected || paintAttachmentAttempted) return;
        paintAttachmentAttempted = true;
        try {
          await testInfo.attach('unsettled-segment-paint-context', {
            body: JSON.stringify({
              attempted: paintAttempted,
              incomplete: paintIncomplete,
              documentLost: selectedDocumentLost,
              events: paintEvidence,
            }),
            contentType: 'application/json',
          });
        } catch (error) {
          paintIncomplete = true;
          console.warn('6036 paint attachment failed', String(error));
        }
      };
      try {
        if (captureSelected) {
          await page.addInitScript(() => {
            (
              globalThis as typeof globalThis & {
                __walkthroughSettlement6036?: SettlementCapture6036;
              }
            ).__walkthroughSettlement6036 = {
              target: null,
              records: new Array<Record<string, unknown> | null>(4096).fill(null),
              count: 0,
              overflow: false,
              incomplete: false,
              segment: 'initial',
              snapshots: [],
              serializedUnits: 0,
            };
          });
        }
        const root = await open(page, width, motion);
        selectedBindingStarted = captureSelected;
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
          expect(
            Math.max(...navigationOffsets) - Math.min(...navigationOffsets),
          ).toBeLessThanOrEqual(1);
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
          await observeFailedSegmentPaint(root, index, resizeWidth, samples);
        }
        await testInfo.attach('resize-geometry', {
          body: JSON.stringify(resize, null, 2),
          contentType: 'application/json',
        });
        await testInfo.attach('resize-segments', {
          body: JSON.stringify(resizeSegments, null, 2),
          contentType: 'application/json',
        });
        await attachPaintEvidence();
        await attachSettlementDecisions('before-resize-assertions');
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
          expect(
            final.fonts.filter((font) => font.primary).every((font) => font.screen >= 12),
          ).toBe(true);
          const offsets = samples.map((sample) => sample.controlOffset - sample.footerOffset);
          expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThanOrEqual(1);
          if (motion === 'reduced') {
            expect(samples.every((sample) => sample.animationCount === 0)).toBe(true);
          }
        }
        await root.screenshot({ path: testInfo.outputPath('compact-walkthrough.png') });
      } finally {
        try {
          await attachPaintEvidence();
          await attachSettlementDecisions('failure-or-early-exit');
          if (captureSelected) {
            // Required companion: covers document loss after the earlier record attachment.
            const continuity = {
              boundary: 'after-last-browser-action',
              observedAt: Date.now(),
              bindingStarted: selectedBindingStarted,
              mainNavigationCount,
              lost: selectedDocumentLost,
              incomplete: !selectedBindingStarted || selectedDocumentLost,
              paintAttempted,
              paintIncomplete,
              paintAttachmentAttempted,
            };
            try {
              await testInfo.attach('settlement-document-continuity', {
                body: JSON.stringify(continuity, null, 2),
                contentType: 'application/json',
              });
            } catch (error) {
              console.warn('6036 settlement continuity attachment failed', String(error));
            }
          }
        } finally {
          if (captureSelected) {
            page.off('framenavigated', observeMainNavigation);
            page.off('close', observeDocumentLoss);
            page.off('crash', observeDocumentLoss);
          }
        }
      }
    });
  }
}
