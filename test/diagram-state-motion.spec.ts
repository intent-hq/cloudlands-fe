import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const externalBaseUrl = process.env.UI_PREVIEW_BASE_URL;
let baseUrl = externalBaseUrl ?? '';
let server: ViteDevServer | undefined;

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  if (externalBaseUrl) return;
  const ownedServer = await createServer({
    cacheDir: viteHarnessCacheDir('diagram-state-motion'),
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

type Probe = {
  edgeId: string;
  sourceId: string;
  targetId: string;
  movingNodeId?: string;
  enteringNodeId?: string;
  groupId?: string;
  exitingEdgeId?: string;
};

type ScreenPoint = { x: number; y: number };
type ScreenBounds = { left: number; right: number; top: number; bottom: number };

type Frame = {
  elapsedMs: number;
  settled: boolean;
  state: string;
  anchor: { x: number; y: number };
  node: { x: number; y: number; width: number; height: number; opacity: number } | null;
  enteringOpacity: number | null;
  group: { x: number; y: number; width: number; height: number } | null;
  groupAnimationDurations: number[];
  path: string;
  progress: number;
  sourcePoint: ScreenPoint;
  sourceBounds: ScreenBounds;
  targetPoint: ScreenPoint;
  targetBounds: ScreenBounds;
  labelDistance: number | null;
  overflow: number;
  camera: string;
  cameraPose: number[];
  footerOffset: number;
  motionPhase: string;
  cameraAnimationCount: number;
  cameraDurations: number[];
  entranceOpacity: number;
  nodeEntryOpacity: number;
  groupEntryOpacity: number;
  routeEntryOpacity: number;
  labelEntryOpacity: number;
  nodeColor: string | null;
  edgeReveal: number;
  exitingReveal: number | null;
};

async function openMotionFixture(page: Page, state: string, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const motion = reduced ? 'reduced' : 'full';
  const url = `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960&motion=${motion}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const scene = page.getByTestId('catalog-scene');
  if (!(await scene.isVisible({ timeout: 3_000 }).catch(() => false))) await page.reload();
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 30_000 });
}

async function openSystemMotionFixture(page: Page, state: string, reduced: boolean) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const url = `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
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

async function recordControlMotion(page: Page, rootId: string, direction: 'forward' | 'backward') {
  const root = page.locator(`#${rootId}`);
  const baseline = await root.evaluate((element) => ({
    state: element.querySelector<HTMLElement>('.diagram-renderer')!.dataset.diagramState,
    nodeIds: [...element.querySelectorAll<HTMLElement>('[data-node-id]')].map(
      (node) => node.dataset.nodeId,
    ),
    groupIds: [...element.querySelectorAll<HTMLElement>('[data-group-id]')].map(
      (group) => group.dataset.groupId,
    ),
    edgeIds: [...element.querySelectorAll<HTMLElement>('.diagram-edge')].map(
      (edge) => edge.dataset.edgeId,
    ),
    camera: getComputedStyle(element.querySelector('.diagram-svg-layer')!).transform,
    geometry: getComputedStyle(element.querySelector('.diagram-geometry-motion')!).transform,
  }));
  const renderer = await root.locator('.diagram-renderer').elementHandle();
  const recorder = await root.evaluateHandle(
    (element, { before, direction }) => {
      const read = () => {
        const diagram = element.querySelector<HTMLElement>('.diagram-renderer')!;
        const camera = element.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
        const geometry = element.querySelector<SVGGElement>('.diagram-geometry-motion')!;
        const entered = (selector: string, ids: Array<string | undefined>, key: string) =>
          [...element.querySelectorAll<HTMLElement>(selector)].filter(
            (node) => !ids.includes(node.dataset[key as keyof DOMStringMap]),
          );
        const maximumOpacity = (elements: Element[]) =>
          Math.max(0, ...elements.map((node) => Number(getComputedStyle(node).opacity)));
        const revealProgress = (element: Element) => {
          const value = getComputedStyle(element).getPropertyValue('--edge-reveal-progress').trim();
          return value === '' ? 1 : Number(value);
        };
        const maximumReveal = (elements: Element[]) => Math.max(0, ...elements.map(revealProgress));
        const maximumDelay = (elements: Element[]) =>
          Math.max(
            0,
            ...elements.flatMap((node) =>
              node
                .getAnimations({ subtree: true })
                .map((animation) => Number(animation.effect?.getTiming().delay)),
            ),
          );
        const maximumDuration = (elements: Element[]) =>
          Math.max(
            0,
            ...elements.flatMap((node) =>
              node
                .getAnimations({ subtree: true })
                .map((animation) => Number(animation.effect?.getTiming().duration)),
            ),
          );
        const opacityRecord = (selector: string, parent = false) =>
          Object.fromEntries(
            [...element.querySelectorAll<HTMLElement>(selector)].map((node) => [
              node.dataset.nodeId ?? node.dataset.groupId ?? node.dataset.edgeId,
              Number(getComputedStyle(parent ? node.parentElement! : node).opacity),
            ]),
          );
        const detachedEdges = [...element.querySelectorAll<SVGGElement>('.diagram-edge')]
          .filter((edge) => revealProgress(edge.parentElement!) > 0.01)
          .filter((edge) => {
            const source = element.querySelector<SVGForeignObjectElement>(
              `[data-node-id="${edge.dataset.edgeFrom}"]`,
            );
            const target = element.querySelector<SVGForeignObjectElement>(
              `[data-node-id="${edge.dataset.edgeTo}"]`,
            );
            return (
              !source ||
              !target ||
              Number(getComputedStyle(source).opacity) <= 0.01 ||
              Number(getComputedStyle(target).opacity) <= 0.01
            );
          })
          .map((edge) => edge.dataset.edgeId);
        const nodes = entered('[data-node-id]', before.nodeIds, 'nodeId');
        const groups = entered('[data-group-id]', before.groupIds, 'groupId').map(
          (group) => group.parentElement!,
        );
        const routes = entered('.diagram-edge', before.edgeIds, 'edgeId').map(
          (edge) => edge.parentElement!,
        );
        const labels = entered('.edge-label-container', before.edgeIds, 'edgeId');
        const cameraAnimations = [camera, geometry].flatMap((node) =>
          node
            .getAnimations({ subtree: false })
            .filter((animation) => animation.playState === 'running'),
        );
        return {
          state: diagram.dataset.diagramState,
          selectedStep: Number(
            element
              .querySelector('[data-diagram-step-index][aria-current="step"]')
              ?.getAttribute('data-diagram-step-index'),
          ),
          phase: diagram.dataset.diagramMotionPhase,
          settled: diagram.dataset.diagramSettled === 'true',
          camera: getComputedStyle(camera).transform,
          geometry: getComputedStyle(geometry).transform,
          cameraAnimationCount: cameraAnimations.length,
          cameraDurations: cameraAnimations.map((animation) =>
            Number(animation.effect?.getTiming().duration),
          ),
          enteredCounts: [nodes.length, groups.length, routes.length, labels.length],
          entryOpacities: [
            maximumOpacity(nodes),
            maximumOpacity(groups),
            maximumReveal(routes),
            maximumOpacity(labels),
          ],
          entryDelays: [nodes, groups, routes, labels].map(maximumDelay),
          entryDurations: [nodes, groups, routes, labels].map(maximumDuration),
          nodeOpacities: opacityRecord('[data-node-id]'),
          groupOpacities: opacityRecord('[data-group-id]', true),
          edgeReveals: Object.fromEntries(
            [...element.querySelectorAll<SVGGElement>('.diagram-edge')].map((edge) => [
              edge.dataset.edgeId,
              revealProgress(edge.parentElement!),
            ]),
          ),
          labelOpacities: opacityRecord('.edge-label-container'),
          detachedEdges,
          routeProgress: [...element.querySelectorAll<SVGGElement>('.diagram-edge')].map((edge) =>
            Number(edge.dataset.edgeMotionProgress),
          ),
        };
      };
      const finished = new Promise<ReturnType<typeof read>[]>((resolve) => {
        const button =
          element.querySelectorAll('.diagram-nav-button')[direction === 'forward' ? 1 : 0];
        window.addEventListener(
          'click',
          async (event) => {
            if (!(event.target instanceof Node) || !button.contains(event.target))
              throw new Error('Unexpected control click while recording diagram motion');
            // Observe after Svelte's delegated handler, not at the button where a
            // native event's microtask checkpoint can still precede delegation.
            await Promise.resolve();
            const frames = [read()];
            const deadline = performance.now() + 2_500;
            do {
              await new Promise<void>((next) => requestAnimationFrame(() => next()));
              frames.push(read());
            } while (!frames.at(-1)!.settled && performance.now() < deadline);
            resolve(frames);
          },
          { once: true },
        );
      });
      return { finished };
    },
    { before: baseline, direction },
  );
  await root
    .locator('.diagram-nav-button')
    .nth(direction === 'forward' ? 1 : 0)
    .click();
  const frames = await recorder.evaluate(async ({ finished }) => finished);
  await recorder.dispose();
  return {
    baseline,
    frames,
    sameMount: await renderer.evaluate(
      (node, selector) => node === document.querySelector(selector),
      `#${rootId} .diagram-renderer`,
    ),
  };
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

async function recordContentMotion(
  page: Page,
  rootId: string,
  direction: 'forward' | 'backward',
  nodeIds: string[],
  edgeIds: string[],
) {
  const root = page.locator(`#${rootId}`);
  const recorder = await root.evaluateHandle(
    (element, { direction, nodeIds, edgeIds }) => {
      const initialNodes = new Map(
        nodeIds.map((id) => [id, element.querySelector(`[data-node-id="${id}"]`)]),
      );
      const initialEdges = new Map(
        edgeIds.map((id) => [id, element.querySelector(`.diagram-edge[data-edge-id="${id}"]`)]),
      );
      const number = (value: string, fallback: number) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      const nodeBounds = (node: SVGForeignObjectElement) => {
        const style = getComputedStyle(node);
        const x = number(style.getPropertyValue('x'), node.x.baseVal.value);
        const y = number(style.getPropertyValue('y'), node.y.baseVal.value);
        const width = number(style.width, node.width.baseVal.value);
        const height = number(style.height, node.height.baseVal.value);
        return { left: x, right: x + width, top: y, bottom: y + height };
      };
      const boundaryDistance = (
        point: DOMPoint,
        bounds: { left: number; right: number; top: number; bottom: number },
      ) => {
        const outsideX = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
        const outsideY = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
        if (outsideX > 0 || outsideY > 0) return Math.hypot(outsideX, outsideY);
        return -Math.min(
          point.x - bounds.left,
          bounds.right - point.x,
          point.y - bounds.top,
          bounds.bottom - point.y,
        );
      };
      const revealProgress = (element: Element) => {
        const value = getComputedStyle(element).getPropertyValue('--edge-reveal-progress').trim();
        return value === '' ? 1 : Number(value);
      };
      const read = (): ContentMotionFrame => {
        const renderer = element.querySelector<HTMLElement>('.diagram-renderer')!;
        return {
          state: renderer.dataset.diagramState ?? '',
          phase: renderer.dataset.diagramMotionPhase ?? '',
          settled: renderer.dataset.diagramSettled === 'true',
          nodes: Object.fromEntries(
            nodeIds.map((id) => {
              const node = element.querySelector<SVGForeignObjectElement>(`[data-node-id="${id}"]`);
              if (!node) return [id, null];
              const bounds = nodeBounds(node);
              return [
                id,
                {
                  x: bounds.left,
                  y: bounds.top,
                  width: bounds.right - bounds.left,
                  height: bounds.bottom - bounds.top,
                  opacity: Number(getComputedStyle(node).opacity),
                  background: getComputedStyle(
                    node.querySelector<HTMLElement>('.diagram-node-html')!,
                  ).backgroundColor,
                  sameAsBaseline: node === initialNodes.get(id),
                },
              ];
            }),
          ),
          edges: Object.fromEntries(
            edgeIds.map((id) => {
              const edge = element.querySelector<SVGGElement>(
                `.diagram-edge[data-edge-id="${id}"]`,
              );
              const path = edge?.querySelector<SVGPathElement>('path.edge-path');
              const source = edge?.dataset.edgeFrom
                ? element.querySelector<SVGForeignObjectElement>(
                    `[data-node-id="${edge.dataset.edgeFrom}"]`,
                  )
                : null;
              const target = edge?.dataset.edgeTo
                ? element.querySelector<SVGForeignObjectElement>(
                    `[data-node-id="${edge.dataset.edgeTo}"]`,
                  )
                : null;
              const maskPath = edge?.querySelector<SVGPathElement>('.edge-reveal-mask-path');
              if (!edge || !path || !source || !target || !maskPath) return [id, null];
              const length = path.getTotalLength();
              const sourcePoint = path.getPointAtLength(0);
              const targetPoint = path.getPointAtLength(length);
              return [
                id,
                {
                  path: path.getAttribute('d') ?? '',
                  progress: Number(edge.dataset.edgeMotionProgress),
                  reveal: revealProgress(edge.parentElement!),
                  maskDashOffset: number(getComputedStyle(maskPath).strokeDashoffset, NaN),
                  maskApplied: edge.querySelector(':scope > g')?.hasAttribute('mask') ?? false,
                  sameAsBaseline: edge === initialEdges.get(id),
                  sourcePoint: { x: sourcePoint.x, y: sourcePoint.y },
                  targetPoint: { x: targetPoint.x, y: targetPoint.y },
                  sourceDistance: boundaryDistance(sourcePoint, nodeBounds(source)),
                  targetDistance: boundaryDistance(targetPoint, nodeBounds(target)),
                },
              ];
            }),
          ),
        };
      };
      const baseline = read();
      const button =
        element.querySelectorAll<HTMLButtonElement>('.diagram-nav-button')[
          direction === 'forward' ? 1 : 0
        ];
      const finished = new Promise<ContentMotionFrame[]>((resolve) => {
        window.addEventListener(
          'click',
          async (event) => {
            if (!(event.target instanceof Node) || !button.contains(event.target))
              throw new Error('Unexpected control click while recording diagram content motion');
            await Promise.resolve();
            const frames = [read()];
            const deadline = performance.now() + 2_500;
            do {
              await new Promise<void>((next) => requestAnimationFrame(() => next()));
              frames.push(read());
            } while (!frames.at(-1)!.settled && performance.now() < deadline);
            resolve(frames);
          },
          { once: true },
        );
      });
      return { baseline, finished };
    },
    { direction, nodeIds, edgeIds },
  );
  await root
    .getByRole('button', { name: direction === 'forward' ? 'Next step' : 'Previous step' })
    .click();
  const result = await recorder.evaluate(async ({ baseline, finished }) => ({
    baseline,
    frames: await finished,
  }));
  await recorder.dispose();
  return result;
}

async function recordReducedControlMotion(
  page: Page,
  rootId: string,
  direction: 'forward' | 'backward',
) {
  const root = page.locator(`#${rootId}`);
  const renderer = root.locator('.diagram-renderer');
  const beforeState = await renderer.getAttribute('data-diagram-state');
  await root.evaluate((element) => {
    const sampledRoot = element as HTMLElement & {
      reducedMotionObserver?: MutationObserver;
      reducedMotionSamples?: Array<{ count: number; targets: string[] }>;
    };
    const diagram = element.querySelector<HTMLElement>('.diagram-renderer')!;
    const sample = () => {
      const finiteAnimations = diagram
        .getAnimations({ subtree: true })
        .filter((animation) =>
          Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
        );
      sampledRoot.reducedMotionSamples!.push({
        count: finiteAnimations.length,
        targets: finiteAnimations.map((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
          const name =
            animation instanceof CSSTransition
              ? `transition:${animation.transitionProperty}`
              : animation instanceof CSSAnimation
                ? `animation:${animation.animationName}`
                : 'waapi';
          const timing = animation.effect?.getTiming();
          return target
            ? `${name}:${target.tagName}.${target.getAttribute('class') ?? ''}:${timing?.duration}`
            : name;
        }),
      });
    };
    sampledRoot.reducedMotionSamples = [];
    sampledRoot.reducedMotionObserver = new MutationObserver(sample);
    sampledRoot.reducedMotionObserver.observe(diagram, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    sample();
  });
  await root
    .getByRole('button', { name: direction === 'forward' ? 'Next step' : 'Previous step' })
    .click();
  await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return root.evaluate((element, previousState) => {
    const sampledRoot = element as HTMLElement & {
      reducedMotionObserver?: MutationObserver;
      reducedMotionSamples?: Array<{ count: number; targets: string[] }>;
    };
    const diagram = element.querySelector<HTMLElement>('.diagram-renderer')!;
    const finiteAnimationCount = diagram
      .getAnimations({ subtree: true })
      .filter((animation) =>
        Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
      ).length;
    sampledRoot.reducedMotionSamples!.push({ count: finiteAnimationCount, targets: [] });
    sampledRoot.reducedMotionObserver?.disconnect();
    const result = {
      beforeState: previousState,
      state: diagram.dataset.diagramState,
      selectedStep: Number(
        element
          .querySelector('[data-diagram-step-index][aria-current="step"]')
          ?.getAttribute('data-diagram-step-index'),
      ),
      phase: diagram.dataset.diagramMotionPhase,
      settled: diagram.dataset.diagramSettled === 'true',
      finiteAnimationCounts: sampledRoot.reducedMotionSamples!,
    };
    delete sampledRoot.reducedMotionObserver;
    delete sampledRoot.reducedMotionSamples;
    return result;
  }, beforeState);
}

async function recordTransition(page: Page, rootId: string, buttonName: string, probe: Probe) {
  return page.locator(`#${rootId}`).evaluate(
    async (root, { buttonName, probe }) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      let transitionStartedAt: number | null = null;
      const beforeNodeIds = new Set(
        [...root.querySelectorAll<SVGForeignObjectElement>('[data-node-id]')].map(
          (node) => node.dataset.nodeId,
        ),
      );
      const beforeGroupIds = new Set(
        [...root.querySelectorAll<SVGGElement>('[data-group-id]')].map(
          (group) => group.dataset.groupId,
        ),
      );
      const beforeEdgeIds = new Set(
        [...root.querySelectorAll<SVGGElement>('.diagram-edge')].map((edge) => edge.dataset.edgeId),
      );
      const frame = (): Frame => {
        const renderer = root.querySelector<HTMLElement>('.diagram-renderer')!;
        const rendererBounds = renderer.getBoundingClientRect();
        const path = root.querySelector<SVGPathElement>(
          `.diagram-edge[data-edge-id="${probe.edgeId}"] path.edge-path`,
        )!;
        const edgeGroup = path.closest<SVGGElement>('.diagram-edge')!;
        const matrix = path.getScreenCTM()!;
        const length = path.getTotalLength();
        const start = path.getPointAtLength(0).matrixTransform(matrix);
        const end = path.getPointAtLength(length).matrixTransform(matrix);
        const source = root
          .querySelector<SVGForeignObjectElement>(`[data-node-id="${probe.sourceId}"]`)!
          .getBoundingClientRect();
        const target = root
          .querySelector<SVGForeignObjectElement>(`[data-node-id="${probe.targetId}"]`)!
          .getBoundingClientRect();
        const movingNode = probe.movingNodeId
          ? root.querySelector<SVGForeignObjectElement>(`[data-node-id="${probe.movingNodeId}"]`)
          : null;
        const movingBounds = movingNode?.getBoundingClientRect();
        const enteringNode = probe.enteringNodeId
          ? root.querySelector<SVGForeignObjectElement>(`[data-node-id="${probe.enteringNodeId}"]`)
          : null;
        const group = probe.groupId
          ? root.querySelector<SVGRectElement>(`[data-group-id="${probe.groupId}"] .group-bg`)
          : null;
        const groupBounds = group?.getBoundingClientRect();
        const groupAnimationDurations =
          group
            ?.getAnimations({ subtree: false })
            .map((animation) => Number(animation.effect?.getTiming().duration)) ?? [];
        const label = root.querySelector<SVGForeignObjectElement>(
          `.edge-label-container[data-edge-id="${probe.edgeId}"]`,
        );
        const labelBounds = label?.getBoundingClientRect();
        const labelCenter = labelBounds
          ? {
              x: (labelBounds.left + labelBounds.right) / 2,
              y: (labelBounds.top + labelBounds.bottom) / 2,
            }
          : null;
        const labelDistance = labelCenter
          ? Math.min(
              ...Array.from({ length: 201 }, (_, index) => {
                const point = path.getPointAtLength((length * index) / 200).matrixTransform(matrix);
                return Math.hypot(point.x - labelCenter.x, point.y - labelCenter.y);
              }),
            )
          : null;
        const exiting = probe.exitingEdgeId
          ? root.querySelector<SVGGElement>(`.diagram-edge[data-edge-id="${probe.exitingEdgeId}"]`)
              ?.parentElement
          : null;
        const revealProgress = (element: Element | null) => {
          if (!element) return null;
          const value = getComputedStyle(element).getPropertyValue('--edge-reveal-progress').trim();
          return value === '' ? 1 : Number(value);
        };
        const viewport = root.querySelector<HTMLElement>('.diagram-scroll-container')!;
        const footer = root.querySelector<HTMLElement>('.diagram-footer')!;
        const camera = root.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
        const geometry = root.querySelector<SVGGElement>('.diagram-geometry-motion')!;
        const cameraAnimations = [camera, geometry].flatMap((element) =>
          element
            .getAnimations({ subtree: false })
            .filter((animation) => animation.playState === 'running'),
        );
        const enteringNodes = [
          ...root.querySelectorAll<SVGForeignObjectElement>('[data-node-id]'),
        ].filter((node) => !beforeNodeIds.has(node.dataset.nodeId));
        const enteringGroups = [...root.querySelectorAll<SVGGElement>('[data-group-id]')]
          .filter((group) => !beforeGroupIds.has(group.dataset.groupId))
          .map((group) => group.parentElement!);
        const enteringRoutes = [...root.querySelectorAll<SVGGElement>('.diagram-edge')]
          .filter((edge) => !beforeEdgeIds.has(edge.dataset.edgeId))
          .map((edge) => edge.parentElement!);
        const enteringLabels = [
          ...root.querySelectorAll<SVGForeignObjectElement>('.edge-label-container'),
        ].filter((label) => !beforeEdgeIds.has(label.dataset.edgeId));
        const maxOpacity = (elements: Element[]) =>
          Math.max(0, ...elements.map((element) => Number(getComputedStyle(element).opacity)));
        const entryOpacities = [
          maxOpacity(enteringNodes),
          maxOpacity(enteringGroups),
          Math.max(0, ...enteringRoutes.map((route) => revealProgress(route) ?? 0)),
          maxOpacity(enteringLabels),
        ];
        return {
          elapsedMs: transitionStartedAt === null ? 0 : performance.now() - transitionStartedAt,
          settled: renderer.dataset.diagramSettled === 'true',
          state: renderer.dataset.diagramState ?? '',
          anchor: {
            x: source.left - rendererBounds.left,
            y: source.top - rendererBounds.top,
          },
          node: movingBounds
            ? {
                x: movingBounds.x,
                y: movingBounds.y,
                width: movingBounds.width,
                height: movingBounds.height,
                opacity: Number(getComputedStyle(movingNode!).opacity),
              }
            : null,
          enteringOpacity: enteringNode ? Number(getComputedStyle(enteringNode).opacity) : null,
          group: groupBounds
            ? {
                x: groupBounds.x,
                y: groupBounds.y,
                width: groupBounds.width,
                height: groupBounds.height,
              }
            : null,
          groupAnimationDurations,
          path: path.getAttribute('d') ?? '',
          progress: Number(edgeGroup.dataset.edgeMotionProgress),
          sourcePoint: { x: start.x, y: start.y },
          sourceBounds: {
            left: source.left,
            right: source.right,
            top: source.top,
            bottom: source.bottom,
          },
          targetPoint: { x: end.x, y: end.y },
          targetBounds: {
            left: target.left,
            right: target.right,
            top: target.top,
            bottom: target.bottom,
          },
          labelDistance,
          overflow: viewport.scrollWidth - viewport.clientWidth,
          camera: `${getComputedStyle(camera).transform}|${getComputedStyle(geometry).transform}`,
          cameraPose: (() => {
            const matrix = camera.getScreenCTM()!;
            const bounds = renderer.getBoundingClientRect();
            return [
              matrix.a,
              matrix.b,
              matrix.c,
              matrix.d,
              matrix.e - bounds.x,
              matrix.f - bounds.y,
            ];
          })(),
          footerOffset:
            footer.getBoundingClientRect().bottom - renderer.getBoundingClientRect().bottom,
          motionPhase: renderer.dataset.diagramMotionPhase ?? '',
          cameraAnimationCount: cameraAnimations.length,
          cameraDurations: cameraAnimations.map((animation) =>
            Number(animation.effect?.getTiming().duration),
          ),
          entranceOpacity: Math.max(...entryOpacities),
          nodeEntryOpacity: entryOpacities[0],
          groupEntryOpacity: entryOpacities[1],
          routeEntryOpacity: entryOpacities[2],
          labelEntryOpacity: entryOpacities[3],
          nodeColor: movingNode
            ? getComputedStyle(movingNode.querySelector('.diagram-node-html')!).backgroundColor
            : null,
          edgeReveal: revealProgress(edgeGroup.parentElement) ?? 1,
          exitingReveal: revealProgress(exiting),
        };
      };
      const before = frame();
      transitionStartedAt = performance.now();
      root.querySelector<HTMLButtonElement>(`button[aria-label="${buttonName}"]`)!.click();
      const afterClick = frame();
      await Promise.resolve();
      await nextFrame();
      const deadline = performance.now() + 2_000;
      let start = frame();
      while (start.motionPhase === 'camera' && start.cameraAnimationCount === 0) {
        if (performance.now() > deadline) throw new Error('Diagram camera animation did not start');
        await nextFrame();
        start = frame();
      }
      const cameraFrames: Frame[] = [];
      let sample = start;
      while (sample.motionPhase === 'camera') {
        cameraFrames.push(sample);
        await nextFrame();
        sample = frame();
      }
      const afterCamera = sample;
      const samples = [...cameraFrames, afterCamera];
      while (
        root.querySelector<HTMLElement>('.diagram-renderer')!.dataset.diagramSettled !== 'true'
      ) {
        if (performance.now() > deadline) throw new Error('Diagram motion did not settle');
        await nextFrame();
        samples.push(frame());
      }
      const settled = frame();
      return { before, afterClick, start, afterCamera, settled, samples, cameraFrames };
    },
    { buttonName, probe },
  );
}

async function readStableSignature(page: Page, rootId: string) {
  return page.locator(`#${rootId}`).evaluate((root) => {
    const canonicalPath = (path: SVGPathElement | null) => {
      const data = path?.getAttribute('d');
      if (!data || /[^\d\s,.\-ML]/i.test(data)) return data;
      const values = data.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)?.map(Number) ?? [];
      const points = Array.from({ length: values.length / 2 }, (_, index) => ({
        x: values[index * 2],
        y: values[index * 2 + 1],
      }));
      if (points.length < 2) return data;
      const vertical = points.every(({ x }) => Math.abs(x - points[0].x) < 0.01);
      const horizontal = points.every(({ y }) => Math.abs(y - points[0].y) < 0.01);
      if (!vertical && !horizontal) return data;
      const first = points[0];
      const last = points.at(-1)!;
      return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
    };
    return {
      state: root.querySelector<HTMLElement>('.diagram-renderer')?.dataset.diagramState,
      camera: getComputedStyle(root.querySelector<SVGSVGElement>('.diagram-svg-layer')!).transform,
      nodes: [...root.querySelectorAll<SVGForeignObjectElement>('[data-node-id]')]
        .map((node) => ({
          id: node.dataset.nodeId,
          x: node.getAttribute('x'),
          y: node.getAttribute('y'),
          width: node.getAttribute('width'),
          height: node.getAttribute('height'),
        }))
        .sort((left, right) => left.id!.localeCompare(right.id!)),
      edges: [...root.querySelectorAll<SVGGElement>('.diagram-edge')]
        .map((edge) => ({
          id: edge.dataset.edgeId,
          path: canonicalPath(edge.querySelector('path.edge-path')),
        }))
        .sort((left, right) => left.id!.localeCompare(right.id!)),
      labels: [...root.querySelectorAll<SVGForeignObjectElement>('.edge-label-container')]
        .map((label) => ({
          id: label.dataset.edgeId,
          x: label.getAttribute('x'),
          y: label.getAttribute('y'),
          width: label.getAttribute('width'),
          height: label.getAttribute('height'),
          text: label.textContent?.trim(),
        }))
        .sort((left, right) => left.id!.localeCompare(right.id!)),
      groups: [...root.querySelectorAll<SVGGElement>('[data-group-id]')]
        .map((group) => {
          const background = group.querySelector<SVGRectElement>('.group-bg')!;
          return {
            id: group.dataset.groupId,
            x: background.getAttribute('x'),
            y: background.getAttribute('y'),
            width: background.getAttribute('width'),
            height: background.getAttribute('height'),
          };
        })
        .sort((left, right) => left.id!.localeCompare(right.id!)),
    };
  });
}

async function allRoutesComplete(page: Page, rootId: string) {
  return page
    .locator(`#${rootId} .diagram-edge`)
    .evaluateAll((edges) =>
      edges.every((edge) => edge.getAttribute('data-edge-motion-progress') === '1'),
    );
}

function signedBoundaryDistance(point: ScreenPoint, bounds: ScreenBounds) {
  const outsideX = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
  const outsideY = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
  if (outsideX > 0 || outsideY > 0) return Math.hypot(outsideX, outsideY);
  const insideDistance = Math.min(
    point.x - bounds.left,
    bounds.right - point.x,
    point.y - bounds.top,
    bounds.bottom - point.y,
  );
  return insideDistance === 0 ? 0 : -insideDistance;
}

function expectFrameGeometry(frame: Frame) {
  expect(
    Math.abs(signedBoundaryDistance(frame.sourcePoint, frame.sourceBounds)),
  ).toBeLessThanOrEqual(2);
  const targetDistance = signedBoundaryDistance(frame.targetPoint, frame.targetBounds);
  expect(targetDistance).toBeGreaterThanOrEqual(4.5);
  expect(targetDistance).toBeLessThanOrEqual(6);
  expect(frame.labelDistance).toBeLessThanOrEqual(4.5);
  expect(frame.overflow).toBeLessThanOrEqual(1);
}

test('endpoint boundary oracle rejects detached, interior, and wrong-shape points', () => {
  const expectedShape = { left: 0, right: 100, top: 0, bottom: 40 };
  const wrongShape = { left: 120, right: 220, top: 0, bottom: 40 };
  expect(signedBoundaryDistance({ x: 0, y: 10 }, expectedShape)).toBe(0);
  expect(signedBoundaryDistance({ x: -3, y: 10 }, expectedShape)).toBeGreaterThan(2);
  expect(signedBoundaryDistance({ x: 95, y: 20 }, expectedShape)).toBe(-5);
  expect(signedBoundaryDistance({ x: 105, y: 20 }, expectedShape)).toBe(5);
  expect(signedBoundaryDistance({ x: 100, y: 20 }, wrongShape)).toBeGreaterThan(2);
});

test('keeps the bundled sandbox font through theme changes and repeated document visits', async ({
  page,
}) => {
  for (const [state, rootId] of [
    ['custom-architecture', 'custom-architecture'],
    ['custom-walkthrough', 'custom-walkthrough'],
    ['custom-architecture', 'custom-architecture'],
  ] as const) {
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960&motion=full`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 30_000,
    });
    await expectBundledSandboxFont(page, rootId);
    if (state === 'custom-architecture') {
      await page.getByRole('radio', { name: 'Dark', exact: true }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expectBundledSandboxFont(page, rootId);
    }
  }
});

function isBetween(value: number, start: number, end: number) {
  return value > Math.min(start, end) && value < Math.max(start, end);
}

function cameraMatrix(frame: Frame) {
  if (frame.cameraPose.length !== 6 || !frame.cameraPose.every(Number.isFinite))
    throw new Error(`Invalid camera pose: ${frame.cameraPose}`);
  return frame.cameraPose;
}

function cameraProgress(start: Frame, current: Frame, end: Frame) {
  const from = cameraMatrix(start);
  const at = cameraMatrix(current);
  const to = cameraMatrix(end);
  const delta = to.map((value, index) => value - from[index]);
  const distanceSquared = delta.reduce((total, value) => total + value * value, 0);
  return (
    delta.reduce((total, value, index) => total + (at[index] - from[index]) * value, 0) /
    distanceSquared
  );
}

function expectCameraBeforeScene(transition: Awaited<ReturnType<typeof recordTransition>>) {
  expect(transition.afterClick.motionPhase).toBe('camera');
  expect(transition.afterClick.entranceOpacity).toBe(0);
  expect(
    Math.hypot(
      transition.afterClick.anchor.x - transition.before.anchor.x,
      transition.afterClick.anchor.y - transition.before.anchor.y,
    ),
  ).toBeLessThanOrEqual(1);
  expect(transition.cameraFrames.length).toBeGreaterThan(0);
  expect(
    transition.cameraFrames.some((frame) =>
      frame.cameraDurations.some((duration) => duration >= 160 && duration <= 200),
    ),
    JSON.stringify(transition.cameraFrames.map((frame) => frame.cameraDurations)),
  ).toBe(true);
  expect(
    Math.max(...transition.cameraFrames.map((frame) => frame.entranceOpacity)),
    JSON.stringify(
      transition.cameraFrames.map((frame) => ({
        phase: frame.motionPhase,
        node: frame.nodeEntryOpacity,
        group: frame.groupEntryOpacity,
        route: frame.routeEntryOpacity,
        label: frame.labelEntryOpacity,
      })),
    ),
  ).toBe(0);
  expect(transition.afterCamera.motionPhase).not.toBe('camera');
  expect(transition.afterCamera.elapsedMs).toBeGreaterThanOrEqual(120);
  expect(transition.afterCamera.elapsedMs).toBeLessThanOrEqual(450);
  const firstVisibleFrame = (key: keyof Frame) =>
    transition.samples.findIndex((frame) => Number(frame[key]) > 0.01);
  const sceneFrame = Math.max(
    firstVisibleFrame('nodeEntryOpacity'),
    firstVisibleFrame('groupEntryOpacity'),
  );
  const routeFrame = firstVisibleFrame('routeEntryOpacity');
  const labelFrame = firstVisibleFrame('labelEntryOpacity');
  if (sceneFrame >= 0 && routeFrame >= 0)
    expect(Math.abs(routeFrame - sceneFrame)).toBeLessThanOrEqual(1);
  if (routeFrame >= 0 && labelFrame >= 0) {
    expect(labelFrame).toBeGreaterThanOrEqual(routeFrame);
    expect(
      transition.samples[labelFrame].elapsedMs - transition.samples[routeFrame].elapsedMs,
    ).toBeLessThanOrEqual(100);
  }
}

function expectFixedFooter(transition: Awaited<ReturnType<typeof recordTransition>>) {
  for (const frame of [transition.start, ...transition.samples, transition.settled]) {
    expect(Math.abs(frame.footerOffset - transition.before.footerOffset)).toBeLessThanOrEqual(1);
  }
}

function expectUnchangedCameraBeforeScene(
  transition: Awaited<ReturnType<typeof recordTransition>>,
) {
  expect(transition.afterClick.motionPhase).toBe('exit');
  expect(transition.afterClick.cameraAnimationCount).toBe(0);
  expect(transition.afterClick.camera).toBe(transition.before.camera);
  expect(transition.cameraFrames).toHaveLength(0);
  expect(
    Math.hypot(
      transition.afterClick.anchor.x - transition.before.anchor.x,
      transition.afterClick.anchor.y - transition.before.anchor.y,
    ),
  ).toBeLessThanOrEqual(1);
  const scene = transition.samples.findIndex((frame) => frame.motionPhase === 'scene');
  expect(scene).toBeGreaterThan(0);
  expect(
    transition.samples
      .slice(0, scene)
      .every((frame) => frame.motionPhase === 'exit' && frame.entranceOpacity === 0),
  ).toBe(true);
}

function expectCameraInterpolation(transition: Awaited<ReturnType<typeof recordTransition>>) {
  expect(transition.start.camera).not.toBe(transition.settled.camera);
  expect(
    transition.samples.some(
      (frame) =>
        frame.camera !== transition.start.camera && frame.camera !== transition.settled.camera,
    ),
  ).toBe(true);
  expect(
    transition.cameraFrames.some((frame) => {
      // Camera interpolation ends before the scene's content/origin rebase.
      const progress = cameraProgress(transition.before, frame, transition.afterCamera);
      return progress > 0.15 && progress < 0.85;
    }),
  ).toBe(true);
}

test('animates real clicks by default without a motion query', async ({ page }) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', false);
  const shell = page.getByTestId('catalog-shell');
  await expect(shell).toHaveAttribute('data-catalog-motion-preference', 'system');
  await expect(shell).toHaveAttribute('data-catalog-motion', 'full');
  expect(new URL(page.url()).searchParams.has('motion')).toBe(false);
  await expect(page.locator('html')).not.toHaveClass(/catalog-(?:full|reduced)-motion/);

  const transition = await recordControlMotion(page, 'custom-walkthrough', 'forward');
  expect(transition.frames[0]).toMatchObject({ phase: 'camera', settled: false });
  expect(
    transition.frames.some(
      (frame) => frame.cameraAnimationCount > 0 && frame.cameraDurations.some((value) => value > 0),
    ),
  ).toBe(true);
  expect(transition.frames.some((frame) => frame.phase === 'scene')).toBe(true);
  expect(transition.frames.at(-1)).toMatchObject({ phase: 'settled', settled: true });
});

test('honors reduced system motion by default without a motion query', async ({ page }) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', true);
  const shell = page.getByTestId('catalog-shell');
  await expect(shell).toHaveAttribute('data-catalog-motion-preference', 'system');
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  expect(new URL(page.url()).searchParams.has('motion')).toBe(false);
  await expect(page.locator('html')).not.toHaveClass(/catalog-(?:full|reduced)-motion/);

  const transition = await recordReducedControlMotion(page, 'custom-walkthrough', 'forward');
  expect(transition).toMatchObject({ selectedStep: 1, phase: 'settled', settled: true });
  expect(Math.max(...transition.finiteAnimationCounts.map(({ count }) => count))).toBe(0);
});

test('keeps live battery policy and explicit preview choices consistent in CSS and stepped motion', async ({
  page,
}, info) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', false);
  const shell = page.getByTestId('catalog-shell');
  const root = page.locator('#custom-walkthrough');
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
  const evidence = [];
  await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
  await expect(shell).toHaveAttribute('data-catalog-motion-preference', 'system');
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  expect(await readPolicy()).toMatchObject({ js: true, css: '1', stepTransition: 'none' });
  const battery = await recordReducedControlMotion(page, 'custom-walkthrough', 'forward');
  expect(battery).toMatchObject({ selectedStep: 1, phase: 'settled', settled: true });
  expect(Math.max(...battery.finiteAnimationCounts.map(({ count }) => count))).toBe(0);
  evidence.push({ policy: await readPolicy(), transition: battery });

  await page.getByRole('radio', { name: 'Full', exact: true }).click();
  await expect(shell).toHaveAttribute('data-catalog-motion', 'full');
  expect(await readPolicy()).toMatchObject({ js: false, css: '0' });
  expect((await readPolicy()).stepTransition).not.toBe('none');
  const full = await recordControlMotion(page, 'custom-walkthrough', 'backward');
  expect(full.sameMount).toBe(true);
  expect(full.frames.some((frame) => frame.cameraAnimationCount > 0)).toBe(true);
  expect(full.frames.at(-1)).toMatchObject({ selectedStep: 0, phase: 'settled', settled: true });
  evidence.push({ policy: await readPolicy(), transition: full });

  await page.getByRole('radio', { name: 'System', exact: true }).click();
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  await page.evaluate(() => document.documentElement.removeAttribute('data-reduce-motion'));
  await expect(shell).toHaveAttribute('data-catalog-motion', 'full');
  expect(await readPolicy()).toMatchObject({ js: false, css: '0' });
  const restored = await recordControlMotion(page, 'custom-walkthrough', 'forward');
  expect(restored.frames.some((frame) => frame.cameraAnimationCount > 0)).toBe(true);
  expect(restored.frames.at(-1)).toMatchObject({
    selectedStep: 1,
    phase: 'settled',
    settled: true,
  });
  evidence.push({ policy: await readPolicy(), transition: restored });

  await page.getByRole('radio', { name: 'Reduced', exact: true }).click();
  await expect(shell).toHaveAttribute('data-catalog-motion', 'reduced');
  expect(await readPolicy()).toMatchObject({ js: true, css: '1', stepTransition: 'none' });
  const reduced = await recordReducedControlMotion(page, 'custom-walkthrough', 'backward');
  expect(reduced).toMatchObject({ selectedStep: 0, phase: 'settled', settled: true });
  expect(Math.max(...reduced.finiteAnimationCounts.map(({ count }) => count))).toBe(0);
  expect(await allRoutesComplete(page, 'custom-walkthrough')).toBe(true);
  evidence.push({ policy: await readPolicy(), transition: reduced });
  await info.attach('battery-policy-transitions', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
  await root.screenshot({ path: info.outputPath('battery-policy-restored.png') });
});

test('persists accessible full and reduced motion choices across stepped fixtures', async ({
  page,
}) => {
  await openSystemMotionFixture(page, 'custom-walkthrough', true);
  await page.getByRole('radio', { name: 'Full', exact: true }).click();
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'full');
  await expect(page.locator('html')).toHaveClass(/catalog-full-motion/);
  expect(new URL(page.url()).searchParams.get('motion')).toBe('full');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('component-catalog-preferences') ?? '{}'),
    ),
  ).toMatchObject({ motion: 'full' });
  const fullTransition = await recordControlMotion(page, 'custom-walkthrough', 'forward');
  expect(fullTransition.frames[0]).toMatchObject({ phase: 'camera', settled: false });

  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=960`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByRole('radio', { name: 'Full', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('radio', { name: 'Reduced', exact: true }).click();
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'reduced');
  await expect(page.locator('html')).toHaveClass(/catalog-reduced-motion/);
  expect(new URL(page.url()).searchParams.get('motion')).toBe('reduced');
  const reducedTransition = await recordReducedControlMotion(
    page,
    'custom-architecture',
    'forward',
  );
  expect(Math.max(...reducedTransition.finiteAnimationCounts.map(({ count }) => count))).toBe(0);

  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-delivery-walkthrough&theme=light&width=960`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByRole('radio', { name: 'Reduced', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('animates delivery nodes and painted connections between Observe and Publish', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openMotionFixture(page, 'custom-delivery-walkthrough');
  const root = page.locator('#custom-delivery-walkthrough');
  const renderer = root.locator('.diagram-renderer');
  for (const state of ['verify', 'publish', 'observe']) {
    await root.getByRole('button', { name: 'Next step' }).click();
    await expect(renderer).toHaveAttribute('data-diagram-state', state);
    await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
  }

  const cases = [
    {
      direction: 'backward' as const,
      from: 'observe',
      to: 'publish',
      departingNodes: ['updater', 'audit'],
      enteringNodes: ['checks', 'artifact'],
      departingEdges: ['dw6', 'dw7'],
      enteringEdges: ['dw4', 'dw5'],
    },
    {
      direction: 'forward' as const,
      from: 'publish',
      to: 'observe',
      departingNodes: ['checks', 'artifact'],
      enteringNodes: ['updater', 'audit'],
      departingEdges: ['dw4', 'dw5'],
      enteringEdges: ['dw6', 'dw7'],
    },
  ];

  for (const transitionCase of cases) {
    const transition = await recordContentMotion(
      page,
      'custom-delivery-walkthrough',
      transitionCase.direction,
      ['registry', ...transitionCase.departingNodes, ...transitionCase.enteringNodes],
      [...transitionCase.departingEdges, ...transitionCase.enteringEdges],
    );
    const settled = transition.frames.at(-1)!;
    expect(transition.baseline.state).toBe(transitionCase.from);
    expect(settled).toMatchObject({ state: transitionCase.to, phase: 'settled', settled: true });

    const registryStart = transition.baseline.nodes.registry!;
    const registryEnd = settled.nodes.registry!;
    expect(
      Math.hypot(registryEnd.x - registryStart.x, registryEnd.y - registryStart.y),
    ).toBeGreaterThan(2);
    expect(
      transition.frames.some((frame) => {
        const registry = frame.nodes.registry;
        return (
          registry !== null &&
          (isBetween(registry.x, registryStart.x, registryEnd.x) ||
            isBetween(registry.y, registryStart.y, registryEnd.y))
        );
      }),
    ).toBe(true);
    expect(
      transition.frames.every(
        (frame) => frame.nodes.registry === null || frame.nodes.registry.sameAsBaseline,
      ),
    ).toBe(true);

    for (const id of [...transitionCase.departingNodes, ...transitionCase.enteringNodes]) {
      expect(
        transition.frames.some((frame) => {
          const opacity = frame.nodes[id]?.opacity;
          return opacity !== undefined && opacity > 0.01 && opacity < 0.99;
        }),
        `${transitionCase.from}→${transitionCase.to} ${id} opacity`,
      ).toBe(true);
    }
    for (const id of [...transitionCase.departingEdges, ...transitionCase.enteringEdges]) {
      const observations = transition.frames.flatMap((frame) => {
        const edge = frame.edges[id];
        return edge
          ? [
              {
                phase: frame.phase,
                reveal: edge.reveal,
                dash: edge.maskDashOffset,
                mask: edge.maskApplied,
              },
            ]
          : [];
      });
      expect(
        observations.every(({ mask }) => mask),
        `${id} mask application`,
      ).toBe(true);
      expect(
        observations.some(({ reveal }) => reveal > 0.01 && reveal < 0.99),
        `${transitionCase.from}→${transitionCase.to} ${id} reveal variable`,
      ).toBe(true);
      expect(
        observations.some(({ dash }) => dash > 0.01 && dash < 0.99),
        `${transitionCase.from}→${transitionCase.to} ${id} mask dash ${JSON.stringify(observations)}`,
      ).toBe(true);
    }

    const firstEnteringNode = transition.frames.find((frame) =>
      transitionCase.enteringNodes.some((id) => (frame.nodes[id]?.opacity ?? 0) > 0.01),
    )!;
    expect(
      transitionCase.departingNodes.every(
        (id) => (firstEnteringNode.nodes[id]?.opacity ?? 0) <= 0.01,
      ),
    ).toBe(true);
    const firstEnteringEdge = transition.frames.find((frame) =>
      transitionCase.enteringEdges.some((id) => (frame.edges[id]?.reveal ?? 0) > 0.01),
    )!;
    expect(
      transitionCase.departingEdges.every(
        (id) => (firstEnteringEdge.edges[id]?.reveal ?? 0) <= 0.01,
      ),
    ).toBe(true);
  }
});

test('targets complete delivery scene geometry before incoming content appears', async ({
  page,
}) => {
  await openMotionFixture(page, 'custom-delivery-walkthrough');
  const root = page.locator('#custom-delivery-walkthrough');
  const renderer = root.locator('.diagram-renderer');
  for (const state of ['verify', 'publish', 'observe']) {
    await root.getByRole('button', { name: 'Next step' }).click();
    await expect(renderer).toHaveAttribute('data-diagram-state', state);
    await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
  }

  for (const [stepIndex, enteringNodeId] of [
    [2, 'artifact'],
    [3, 'updater'],
  ] as const) {
    const samples = await root.evaluate(
      async (element, target) => {
        const diagram = element.querySelector<HTMLElement>('.diagram-renderer')!;
        const nextFrame = () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const read = () => {
          const node = element.querySelector<SVGForeignObjectElement>('[data-node-id="registry"]')!;
          const nodeStyle = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          const enteringNode = element.querySelector<SVGForeignObjectElement>(
            `[data-node-id="${target.enteringNodeId}"]`,
          );
          const svg = element.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
          return {
            phase: diagram.dataset.diagramMotionPhase,
            settled: diagram.dataset.diagramSettled === 'true',
            local: { x: Number.parseFloat(nodeStyle.x), y: Number.parseFloat(nodeStyle.y) },
            screen: { x: bounds.x, y: bounds.y },
            enteringOpacity: enteringNode ? Number(getComputedStyle(enteringNode).opacity) : 0,
            frame: { width: svg.width.baseVal.value, height: svg.height.baseVal.value },
          };
        };
        const frames = [read()];
        element
          .querySelector<HTMLButtonElement>(`[data-diagram-step-index="${target.stepIndex}"]`)!
          .click();
        let settledFrames = 0;
        for (let frame = 0; frame < 120 && settledFrames < 4; frame += 1) {
          await nextFrame();
          const sample = read();
          frames.push(sample);
          settledFrames = sample.settled ? settledFrames + 1 : 0;
        }
        return frames;
      },
      { stepIndex, enteringNodeId },
    );
    const destination = samples.at(-1)!;
    const afterSelection = samples.slice(1);
    const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
      Math.hypot(left.x - right.x, left.y - right.y);
    const destinationLocal = afterSelection.findIndex(
      ({ local }) => distance(local, destination.local) <= 0.25,
    );
    const entryStart = afterSelection.findIndex(({ enteringOpacity }) => enteringOpacity > 0.01);

    expect(destinationLocal).toBeGreaterThanOrEqual(0);
    expect(entryStart).toBeGreaterThan(destinationLocal);
    expect(
      afterSelection.every(
        ({ frame }) =>
          Math.abs(frame.width - destination.frame.width) <= 0.1 &&
          Math.abs(frame.height - destination.frame.height) <= 0.1,
      ),
      JSON.stringify(afterSelection.map(({ phase, frame }) => ({ phase, frame }))),
    ).toBe(true);
    expect(
      afterSelection
        .slice(destinationLocal)
        .every(({ local }) => distance(local, destination.local) <= 0.25),
    ).toBe(true);
    expect(
      afterSelection
        .slice(entryStart)
        .every(({ screen }) => distance(screen, destination.screen) <= 1),
      JSON.stringify(
        afterSelection.slice(entryStart).map(({ phase, local, screen, enteringOpacity }) => ({
          phase,
          local,
          screen,
          enteringOpacity,
        })),
      ),
    ).toBe(true);
  }
});

test('animates the untouched initial ownership step before the following step', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openMotionFixture(page, 'custom-walkthrough');
  const root = page.locator('#custom-walkthrough');
  const renderer = root.locator('.diagram-renderer');
  await expect(renderer).toHaveAttribute('data-diagram-state', 'request');
  await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');

  const cases = [
    {
      from: 'request',
      to: 'execute',
      departingNodes: ['user'],
      enteringNodes: ['daemon'],
      departingEdges: ['w1', 'w2'],
      enteringEdges: ['w4', 'w5'],
      sharedNodes: ['chat', 'redux'],
      sharedEdges: ['w3'],
    },
    {
      from: 'execute',
      to: 'render',
      departingNodes: [],
      enteringNodes: [],
      departingEdges: ['w3', 'w4'],
      enteringEdges: ['w2'],
      sharedNodes: ['chat', 'redux', 'daemon'],
      sharedEdges: ['w5'],
    },
  ];

  for (const transitionCase of cases) {
    const transition = await recordContentMotion(
      page,
      'custom-walkthrough',
      'forward',
      ['user', 'chat', 'redux', 'daemon'],
      ['w1', 'w2', 'w3', 'w4', 'w5'],
    );
    const settled = transition.frames.at(-1)!;
    expect(transition.baseline).toMatchObject({
      state: transitionCase.from,
      phase: 'settled',
      settled: true,
    });
    expect(settled).toMatchObject({ state: transitionCase.to, phase: 'settled', settled: true });
    expect(transition.frames.some((frame) => frame.phase === 'exit')).toBe(true);
    expect(transition.frames.some((frame) => frame.phase === 'scene')).toBe(true);

    for (const id of [...transitionCase.departingNodes, ...transitionCase.enteringNodes]) {
      expect(
        transition.frames.some((frame) => {
          const opacity = frame.nodes[id]?.opacity;
          return opacity !== undefined && opacity > 0.01 && opacity < 0.99;
        }),
        `${transitionCase.from}→${transitionCase.to} ${id} opacity`,
      ).toBe(true);
    }
    for (const id of [...transitionCase.departingEdges, ...transitionCase.enteringEdges]) {
      expect(
        transition.frames.some((frame) => {
          const edge = frame.edges[id];
          return (
            edge !== null &&
            edge.reveal > 0.01 &&
            edge.reveal < 0.99 &&
            edge.maskDashOffset > 0.01 &&
            edge.maskDashOffset < 0.99
          );
        }),
        `${transitionCase.from}→${transitionCase.to} ${id} painted reveal`,
      ).toBe(true);
    }
    for (const id of transitionCase.sharedNodes) {
      const start = transition.baseline.nodes[id]!;
      const end = settled.nodes[id]!;
      expect(transition.frames.every((frame) => frame.nodes[id]?.sameAsBaseline)).toBe(true);
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThanOrEqual(0.1);
    }
    for (const id of transitionCase.sharedEdges) {
      const start = transition.baseline.edges[id]!;
      const end = settled.edges[id]!;
      const routeFrames = transition.frames.flatMap((frame) =>
        frame.edges[id] ? [frame.edges[id]] : [],
      );
      expect(routeFrames.every(({ sameAsBaseline }) => sameAsBaseline)).toBe(true);
      if (end.path !== start.path) {
        expect(
          routeFrames.some(
            (edge) =>
              edge.path !== start.path &&
              edge.path !== end.path &&
              edge.progress > 0 &&
              edge.progress < 1,
          ),
        ).toBe(true);
      }
      expect(routeFrames.every(({ sourceDistance }) => Math.abs(sourceDistance) <= 2)).toBe(true);
      const minimumTargetGap = Math.min(start.targetDistance, end.targetDistance);
      const maximumTargetGap = Math.max(start.targetDistance, end.targetDistance);
      expect(
        routeFrames.every(
          ({ targetDistance }) =>
            targetDistance >= minimumTargetGap - 0.1 && targetDistance <= maximumTargetGap + 2,
        ),
      ).toBe(true);
    }

    const chatStart = transition.baseline.nodes.chat!.background;
    const chatEnd = settled.nodes.chat!.background;
    expect(chatEnd).not.toBe(chatStart);
    expect(
      transition.frames.some(
        (frame) =>
          frame.nodes.chat !== null &&
          frame.nodes.chat.background !== chatStart &&
          frame.nodes.chat.background !== chatEnd,
      ),
    ).toBe(true);
  }
});

for (const width of [960, 320]) {
  test(`keeps the short ownership kind label on one line at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=${width}&motion=full`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 30_000,
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

test('keeps transient retained-route corners rounded', async ({ page }) => {
  await openMotionFixture(page, 'custom-walkthrough');
  const root = page.locator('#custom-walkthrough');
  await root.getByRole('button', { name: 'State 2: 2. Follow execution' }).click();
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');

  const paths = await root.evaluate(async (element) => {
    const renderer = element.querySelector<HTMLElement>('.diagram-renderer')!;
    const readPath = () => {
      const path = element.querySelector<SVGPathElement>(
        '.diagram-edge[data-edge-id="w5"] path.edge-path',
      )!;
      const length = path.getTotalLength();
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(length);
      return {
        d: path.getAttribute('d') ?? '',
        excessLength: length - Math.hypot(end.x - start.x, end.y - start.y),
      };
    };
    const samples = [readPath()];
    element.querySelector<HTMLButtonElement>('[data-diagram-step-index="2"]')!.click();
    for (let frame = 0; frame < 120; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(readPath());
      if (renderer.dataset.diagramSettled === 'true' && frame > 1) break;
    }
    return samples;
  });
  const bentPaths = paths.filter(({ excessLength }) => excessLength > 0.5);
  expect(bentPaths.length).toBeGreaterThan(0);
  expect(bentPaths.every(({ d }) => d.includes(' Q '))).toBe(true);
});

test('keeps ownership motion when a scrollbar gutter changes only the viewport width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 941, height: 700 });
  await openMotionFixture(page, 'custom-walkthrough');
  await page.addStyleTag({
    content:
      '#custom-walkthrough .diagram-scroll-container.stepping-viewport { scrollbar-gutter: stable; }',
  });

  const transitions = await page.locator('#custom-walkthrough').evaluate(async (root) => {
    const renderer = root.querySelector<HTMLElement>('.diagram-renderer')!;
    const viewport = root.querySelector<HTMLElement>('.diagram-scroll-container')!;
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const edgeReveal = (edgeId: string) => {
      const edge = root.querySelector<SVGGElement>(
        `.diagram-edge[data-edge-id="${edgeId}"]`,
      )?.parentElement;
      if (!edge) return null;
      const value = getComputedStyle(edge).getPropertyValue('--edge-reveal-progress').trim();
      return value === '' ? 1 : Number(value);
    };
    const record = async (
      stepIndex: number,
      sharedSelectors: string[],
      enteringNodeId: string,
      enteringEdgeId: string,
      exitingEdgeId: string,
    ) => {
      const shared = sharedSelectors.map((selector) => root.querySelector(selector));
      const samples = [];
      const read = () => {
        const enteringNode = root.querySelector<SVGForeignObjectElement>(
          `[data-node-id="${enteringNodeId}"]`,
        );
        samples.push({
          phase: renderer.dataset.diagramMotionPhase,
          settled: renderer.dataset.diagramSettled === 'true',
          rendererWidth: renderer.getBoundingClientRect().width,
          viewportWidth: viewport.clientWidth,
          sharedIdentity: sharedSelectors.every(
            (selector, index) => root.querySelector(selector) === shared[index],
          ),
          enteringOpacity: enteringNode ? Number(getComputedStyle(enteringNode).opacity) : null,
          enteringReveal: edgeReveal(enteringEdgeId),
          exitingReveal: edgeReveal(exitingEdgeId),
        });
      };
      read();
      root.querySelector<HTMLButtonElement>(`[data-diagram-step-index="${stepIndex}"]`)!.click();
      for (let frame = 0; frame < 120; frame += 1) {
        await nextFrame();
        read();
        if (samples.at(-1)!.settled && frame > 1) break;
      }
      return samples;
    };

    return [
      await record(
        1,
        ['[data-node-id="chat"]', '[data-node-id="redux"]', '.diagram-edge[data-edge-id="w3"]'],
        'daemon',
        'w4',
        'w1',
      ),
      await record(
        2,
        [
          '[data-node-id="chat"]',
          '[data-node-id="redux"]',
          '[data-node-id="daemon"]',
          '.diagram-edge[data-edge-id="w5"]',
        ],
        'user',
        'w2',
        'w3',
      ),
    ];
  });

  const fractional = (value: number | null) => value !== null && value > 0 && value < 1;
  for (const samples of transitions) {
    expect(Math.max(...samples.map(({ rendererWidth }) => rendererWidth))).toBe(
      Math.min(...samples.map(({ rendererWidth }) => rendererWidth)),
    );
    expect(Math.max(...samples.map(({ viewportWidth }) => viewportWidth))).toBeGreaterThan(
      Math.min(...samples.map(({ viewportWidth }) => viewportWidth)),
    );
    expect(samples.every(({ sharedIdentity }) => sharedIdentity)).toBe(true);
    expect(samples.some(({ phase }) => phase === 'exit')).toBe(true);
    expect(samples.some(({ phase }) => phase === 'scene')).toBe(true);
    expect(samples.some(({ enteringReveal }) => fractional(enteringReveal))).toBe(true);
    expect(samples.some(({ exitingReveal }) => fractional(exitingReveal))).toBe(true);
  }
  expect(transitions[0].some(({ enteringOpacity }) => fractional(enteringOpacity))).toBe(true);
});

test('settles an ownership step interrupted by a genuine outer lane resize', async ({ page }) => {
  await page.setViewportSize({ width: 941, height: 700 });
  await openMotionFixture(page, 'custom-walkthrough');
  const root = page.locator('#custom-walkthrough');
  const renderer = root.locator('.diagram-renderer');
  const sharedChat = await root.locator('[data-node-id="chat"]').elementHandle();
  const beforeWidth = await renderer.evaluate((element) => element.getBoundingClientRect().width);

  await root.getByRole('button', { name: 'State 2: 2. Follow execution' }).click();
  await expect(renderer).toHaveAttribute('data-diagram-motion-phase', 'camera');
  await page.setViewportSize({ width: 861, height: 700 });

  await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
  await expect(renderer).toHaveAttribute('data-diagram-state', 'execute');
  await expect(root.locator('[data-node-id="daemon"]')).toHaveCSS('opacity', '1');
  await expect(root.locator('.diagram-edge[data-edge-id="w4"]')).toHaveAttribute(
    'data-edge-motion-progress',
    '1',
  );
  expect(await renderer.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(
    beforeWidth,
  );
  expect(await sharedChat!.evaluate((element) => element.isConnected)).toBe(false);
  expect(await allRoutesComplete(page, 'custom-walkthrough')).toBe(true);
});

test('interpolates a retained route with its moving endpoints in diagram coordinates', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openMotionFixture(page, 'custom-architecture');
  const root = page.locator('#custom-architecture');
  const renderer = root.locator('.diagram-renderer');
  await root.getByRole('button', { name: 'Next step' }).click();
  await expect(renderer).toHaveAttribute('data-diagram-state', 'connect');
  await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');

  const transition = await recordContentMotion(
    page,
    'custom-architecture',
    'forward',
    ['renderer', 'daemon'],
    ['a2'],
  );
  const settled = transition.frames.at(-1)!;
  const nodeStart = transition.baseline.nodes.daemon!;
  const nodeEnd = settled.nodes.daemon!;
  const edgeStart = transition.baseline.edges.a2!;
  const edgeEnd = settled.edges.a2!;
  expect(Math.hypot(nodeEnd.x - nodeStart.x, nodeEnd.y - nodeStart.y)).toBeGreaterThan(2);
  expect(
    transition.frames.some((frame) => {
      const node = frame.nodes.daemon;
      return (
        node !== null &&
        (isBetween(node.x, nodeStart.x, nodeEnd.x) || isBetween(node.y, nodeStart.y, nodeEnd.y))
      );
    }),
  ).toBe(true);
  expect(
    transition.frames.every(
      (frame) => frame.nodes.daemon === null || frame.nodes.daemon.sameAsBaseline,
    ),
  ).toBe(true);

  expect(edgeEnd.path).not.toBe(edgeStart.path);
  expect(
    transition.frames.some(
      (frame) =>
        frame.edges.a2 !== null &&
        frame.edges.a2.path !== edgeStart.path &&
        frame.edges.a2.path !== edgeEnd.path &&
        frame.edges.a2.progress > 0 &&
        frame.edges.a2.progress < 1,
    ),
  ).toBe(true);
  const routeFrames = transition.frames.flatMap((frame) =>
    frame.edges.a2 ? [{ phase: frame.phase, ...frame.edges.a2 }] : [],
  );
  expect(routeFrames.every(({ sameAsBaseline }) => sameAsBaseline)).toBe(true);
  expect(
    routeFrames.every(({ sourceDistance }) => Math.abs(sourceDistance) <= 2),
    JSON.stringify(
      transition.frames
        .filter((frame) => Math.abs(frame.edges.a2?.sourceDistance ?? 0) > 2)
        .map((frame) => ({
          phase: frame.phase,
          edgeProgress: frame.edges.a2?.progress,
          sourceDistance: frame.edges.a2?.sourceDistance,
          sourcePoint: frame.edges.a2?.sourcePoint,
          sourceNode: frame.nodes.renderer,
        })),
    ),
  ).toBe(true);
  const minimumTargetGap = Math.min(edgeStart.targetDistance, edgeEnd.targetDistance);
  const maximumTargetGap = Math.max(edgeStart.targetDistance, edgeEnd.targetDistance);
  expect(
    routeFrames.every(
      ({ targetDistance }) =>
        targetDistance >= minimumTargetGap - 0.1 && targetDistance <= maximumTargetGap + 2,
    ),
    JSON.stringify(routeFrames.map(({ phase, targetDistance }) => ({ phase, targetDistance }))),
  ).toBe(true);
});

test('keeps explicit full motion active for every stepped sandbox control', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=960&motion=full`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'full');
  await expect(page.locator('html')).toHaveClass(/catalog-full-motion/);

  for (const fixture of steppedFixtures) {
    const root = page.locator(`#${fixture.id}`);
    await expect(root.locator('[data-diagram-step-index]')).toHaveCount(fixture.steps);
    for (const direction of ['forward', 'backward'] as const) {
      for (let index = 0; index < fixture.steps - 1; index += 1) {
        const transition = await recordControlMotion(page, fixture.id, direction);
        const expectedStep = direction === 'forward' ? index + 1 : fixture.steps - index - 2;
        expect(transition.sameMount).toBe(true);
        expect(transition.frames[0].state).not.toBe(transition.baseline.state);
        expect(transition.frames[0].selectedStep).toBe(expectedStep);
        expect(['camera', 'exit']).toContain(transition.frames[0].phase);
        expect(transition.frames[0].settled).toBe(false);
        const cameraFrames = transition.frames.filter((frame) => frame.phase === 'camera');
        if (cameraFrames.length > 0) {
          expect(
            cameraFrames.some(
              (frame) =>
                frame.cameraAnimationCount > 0 &&
                frame.cameraDurations.some((duration) => duration >= 160 && duration <= 200),
            ),
          ).toBe(true);
        } else {
          expect(transition.frames[0].phase).toBe('exit');
        }
        const sceneIndex = transition.frames.findIndex((frame) => frame.phase === 'scene');
        expect(sceneIndex).toBeGreaterThan(0);
        const exitIndex = transition.frames.findIndex((frame) => frame.phase === 'exit');
        expect(
          Math.max(
            ...transition.frames.slice(0, sceneIndex).flatMap((frame) => frame.entryOpacities),
          ),
        ).toBe(0);
        expect(transition.frames.at(-1)).toMatchObject({
          selectedStep: expectedStep,
          settled: true,
          phase: 'settled',
        });
        expect(
          transition.frames.every((frame) => frame.detachedEdges.length === 0),
          JSON.stringify({
            fixture: fixture.id,
            direction,
            index,
            detached: transition.frames
              .filter((frame) => frame.detachedEdges.length > 0)
              .map((frame) => ({ phase: frame.phase, edges: frame.detachedEdges })),
          }),
        ).toBe(true);

        const settledFrame = transition.frames.at(-1)!;
        const lifecycleKeys = [
          'nodeOpacities',
          'groupOpacities',
          'edgeReveals',
          'labelOpacities',
        ] as const;
        const hasDepartingContent = lifecycleKeys.some((key) =>
          Object.keys(transition.frames[0][key]).some((id) => !(id in settledFrame[key])),
        );
        if (hasDepartingContent) {
          if (exitIndex === 0 && cameraFrames.length === 0) {
            expect(transition.frames[0].cameraAnimationCount).toBe(0);
            expect(transition.frames[0].camera).toBe(transition.baseline.camera);
            expect(transition.frames[0].geometry).toBe(transition.baseline.geometry);
          } else {
            expect(exitIndex).toBeGreaterThan(0);
          }
          expect(sceneIndex).toBeGreaterThan(exitIndex);
        }
        const lifecycle = (
          key: 'nodeOpacities' | 'groupOpacities' | 'edgeReveals' | 'labelOpacities',
        ) => {
          const beforeIds = Object.keys(transition.frames[0][key]);
          const afterIds = Object.keys(settledFrame[key]);
          const departingIds = beforeIds.filter((id) => !afterIds.includes(id));
          const enteringIds = afterIds.filter((id) => !beforeIds.includes(id));
          const sharedIds = beforeIds.filter((id) => afterIds.includes(id));
          const firstEnteringFrame = transition.frames.findIndex((frame) =>
            enteringIds.some((id) => (frame[key][id] ?? 0) > 0.01),
          );
          const hasIntermediateExit = transition.frames.some((frame) =>
            departingIds.some((id) => {
              const opacity = frame[key][id];
              return opacity !== undefined && opacity > 0.01 && opacity < 0.99;
            }),
          );
          if (firstEnteringFrame >= 0) {
            expect(
              departingIds.every(
                (id) => (transition.frames[firstEnteringFrame][key][id] ?? 0) <= 0.01,
              ),
              JSON.stringify({ fixture: fixture.id, direction, index, key }),
            ).toBe(true);
          }
          for (const frame of transition.frames) {
            for (const id of sharedIds) expect(frame[key][id]).toBeGreaterThan(0.5);
          }
          return hasIntermediateExit;
        };
        const intermediateExits = lifecycleKeys.map((key) => lifecycle(key));
        if (hasDepartingContent) {
          expect(
            intermediateExits.some(Boolean),
            JSON.stringify({ fixture: fixture.id, direction, index }),
          ).toBe(true);
        }

        const firstVisible = (category: number) =>
          transition.frames.findIndex(
            (frame) => frame.enteredCounts[category] > 0 && frame.entryOpacities[category] > 0.01,
          );
        const sceneEntry = Math.max(firstVisible(0), firstVisible(1));
        const routeEntry = firstVisible(2);
        const labelEntry = firstVisible(3);
        if (sceneEntry >= 0 && routeEntry >= 0) {
          expect(routeEntry).toBeGreaterThanOrEqual(sceneEntry);
        }
        const stagedFrame = transition.frames.find(
          (frame) => frame.enteredCounts[2] > 0 && frame.enteredCounts[3] > 0,
        );
        if (stagedFrame) {
          const sceneDelay = Math.max(stagedFrame.entryDelays[0], stagedFrame.entryDelays[1]);
          expect(stagedFrame.entryDelays[2]).toBeLessThanOrEqual(sceneDelay);
          expect(stagedFrame.entryDelays[3]).toBeGreaterThan(stagedFrame.entryDelays[2]);
          expect(stagedFrame.entryDelays[3] - stagedFrame.entryDelays[2]).toBeLessThanOrEqual(80);
        }
        if (routeEntry >= 0 && labelEntry >= 0) {
          expect(
            labelEntry,
            JSON.stringify({ fixture: fixture.id, direction, index, frames: transition.frames }),
          ).toBeGreaterThanOrEqual(routeEntry);
        }
      }
    }
  }
});

test('settles every stepped sandbox control without finite reduced-motion animations', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openMotionFixture(page, 'custom-architecture', true);
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'reduced');
  await expect(page.locator('html')).toHaveClass(/catalog-reduced-motion/);

  let transitionCount = 0;
  for (const fixture of steppedFixtures) {
    const signatures = [await readStableSignature(page, fixture.id)];
    for (let index = 1; index < fixture.steps; index += 1) {
      const transition = await recordReducedControlMotion(page, fixture.id, 'forward');
      const settled = await readStableSignature(page, fixture.id);
      transitionCount += 1;
      expect(transition.state).not.toBe(transition.beforeState);
      expect(transition).toMatchObject({ selectedStep: index, phase: 'settled', settled: true });
      expect(
        Math.max(...transition.finiteAnimationCounts.map((sample) => sample.count)),
        JSON.stringify(transition.finiteAnimationCounts),
      ).toBe(0);
      expect(settled.nodes.length).toBeGreaterThan(0);
      expect(await allRoutesComplete(page, fixture.id)).toBe(true);
      signatures.push(settled);
    }
    for (let index = fixture.steps - 2; index >= 0; index -= 1) {
      const transition = await recordReducedControlMotion(page, fixture.id, 'backward');
      const settled = await readStableSignature(page, fixture.id);
      transitionCount += 1;
      expect(transition.state).not.toBe(transition.beforeState);
      expect(transition).toMatchObject({ selectedStep: index, phase: 'settled', settled: true });
      expect(
        Math.max(...transition.finiteAnimationCounts.map((sample) => sample.count)),
        JSON.stringify(transition.finiteAnimationCounts),
      ).toBe(0);
      expect(await allRoutesComplete(page, fixture.id)).toBe(true);
      expect(settled).toEqual(signatures[index]);
    }
  }
  expect(transitionCount).toBe(14);

  await page.goto(`${baseUrl}/sandbox/button?state=default&motion=reduced`);
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true');
  await expect(page.locator('.diagram-renderer')).toHaveCount(0);
});

test('shows continuous Redux walkthrough motion when the system requests reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=960&motion=full`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
  });

  const transition = await recordControlMotion(page, 'custom-walkthrough', 'forward');
  expect(new Set(transition.frames.map((frame) => frame.camera)).size).toBeGreaterThan(1);
  expect(
    transition.frames.some((frame) => frame.entryOpacities[0] > 0 && frame.entryOpacities[0] < 1),
  ).toBe(true);
  expect(
    transition.frames.some((frame) => frame.routeProgress.some((value) => value > 0 && value < 1)),
  ).toBe(true);
  expect(
    transition.frames.some((frame) => frame.entryOpacities[2] > 0 && frame.entryOpacities[2] < 1),
  ).toBe(true);
  expect(Math.max(...transition.frames.map((frame) => frame.entryDurations[2]))).toBeGreaterThan(
    100,
  );
  expect(
    transition.frames.some((frame) => frame.entryOpacities[3] > 0 && frame.entryOpacities[3] < 1),
  ).toBe(true);
  expect(transition.frames.at(-1)).toMatchObject({ phase: 'settled', settled: true });
});

test('coordinates architecture and ownership state motion through settled frames', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openMotionFixture(page, 'custom-architecture');
  const architectureOrient = await readStableSignature(page, 'custom-architecture');
  const architecture12 = await recordTransition(
    page,
    'custom-architecture',
    'State 2: 2. Follow the data',
    { edgeId: 'a1', sourceId: 'user', targetId: 'renderer', enteringNodeId: 'daemon' },
  );
  expect(architecture12.start.settled).toBe(false);
  expect(architecture12.settled.settled).toBe(true);
  expect(
    architecture12.samples.some(
      (frame) =>
        frame.enteringOpacity !== null &&
        frame.enteringOpacity > 0 &&
        frame.enteringOpacity < architecture12.settled.enteringOpacity!,
    ),
  ).toBe(true);
  expectCameraBeforeScene(architecture12);
  expectFixedFooter(architecture12);
  expectCameraInterpolation(architecture12);
  expectFrameGeometry(architecture12.settled);

  const architecture23 = await recordTransition(
    page,
    'custom-architecture',
    'State 3: 3. Close the loop',
    {
      edgeId: 'a2',
      sourceId: 'renderer',
      targetId: 'daemon',
      movingNodeId: 'daemon',
      enteringNodeId: 'events',
      groupId: 'runtime',
    },
  );
  const nodeDelta = Math.hypot(
    architecture23.settled.node!.x - architecture23.before.node!.x,
    architecture23.settled.node!.y - architecture23.before.node!.y,
  );
  expect(nodeDelta).toBeGreaterThan(2);
  expect(
    architecture23.samples.some(
      (sample) =>
        sample.node !== null &&
        (isBetween(sample.node.x, architecture23.start.node!.x, architecture23.settled.node!.x) ||
          isBetween(sample.node.y, architecture23.start.node!.y, architecture23.settled.node!.y)),
    ),
  ).toBe(true);
  expect(
    architecture23.samples.some(
      (frame) =>
        frame.nodeColor !== null &&
        frame.nodeColor !== architecture23.start.nodeColor &&
        frame.nodeColor !== architecture23.settled.nodeColor,
    ),
  ).toBe(true);
  expect(architecture23.start.group!.height).not.toBe(architecture23.settled.group!.height);
  expect(
    [architecture23.afterClick, ...architecture23.samples].some((frame) =>
      frame.groupAnimationDurations.some((duration) => duration >= 200 && duration <= 240),
    ),
  ).toBe(true);
  expect(
    architecture23.samples.some(
      (frame) => frame.progress > 0 && frame.progress < architecture23.settled.progress,
    ),
  ).toBe(true);
  expect(architecture23.settled.progress).toBe(1);
  expect(
    architecture23.samples.some(
      (frame) =>
        frame.enteringOpacity !== null &&
        frame.enteringOpacity > 0 &&
        frame.enteringOpacity < architecture23.settled.enteringOpacity!,
    ),
  ).toBe(true);
  expectCameraBeforeScene(architecture23);
  expectFixedFooter(architecture23);
  expectCameraInterpolation(architecture23);
  expectFrameGeometry(architecture23.settled);
  const architectureStable = await readStableSignature(page, 'custom-architecture');
  const architecture31 = await recordTransition(
    page,
    'custom-architecture',
    'State 1: 1. Start in the workbench',
    {
      edgeId: 'a1',
      sourceId: 'user',
      targetId: 'renderer',
      groupId: 'client',
      exitingEdgeId: 'a5',
    },
  );
  expect(architecture31.settled.state).toBe('orient');
  expect(architecture31.settled.exitingReveal).toBeNull();
  expect(
    architecture31.samples.some(
      (frame) =>
        frame.motionPhase === 'exit' &&
        frame.exitingReveal !== null &&
        frame.exitingReveal > 0 &&
        frame.exitingReveal < 1,
    ),
  ).toBe(true);
  // The destination scene owns the reverse fit even though the old outgoing union
  // happened to match the previous camera.
  expectCameraBeforeScene(architecture31);
  expectCameraInterpolation(architecture31);
  expectFixedFooter(architecture31);

  await openMotionFixture(page, 'custom-walkthrough');
  const ownership12 = await recordTransition(
    page,
    'custom-walkthrough',
    'State 2: 2. Follow execution',
    { edgeId: 'w3', sourceId: 'chat', targetId: 'redux', enteringNodeId: 'daemon' },
  );
  expect(ownership12.start.path).not.toBe(ownership12.settled.path);
  expect(
    ownership12.samples.some(
      (frame) => frame.progress > 0 && frame.progress < ownership12.settled.progress,
    ),
  ).toBe(true);
  expect(ownership12.settled.progress).toBe(1);
  expect(
    ownership12.samples.some(
      (frame) =>
        frame.enteringOpacity !== null &&
        frame.enteringOpacity > 0 &&
        frame.enteringOpacity < ownership12.settled.enteringOpacity!,
    ),
  ).toBe(true);
  expectCameraBeforeScene(ownership12);
  expectFrameGeometry(ownership12.settled);
  expectFixedFooter(ownership12);

  const ownership23 = await recordTransition(
    page,
    'custom-walkthrough',
    'State 3: 3. Show the result',
    { edgeId: 'w5', sourceId: 'daemon', targetId: 'redux', exitingEdgeId: 'w3' },
  );
  expect(ownership23.start.path).not.toBe(ownership23.settled.path);
  expect(ownership23.settled.progress).toBe(1);
  expect(
    ownership23.samples.some(
      (frame) =>
        frame.motionPhase === 'exit' &&
        frame.exitingReveal !== null &&
        frame.exitingReveal < 1 &&
        frame.exitingReveal > 0 &&
        frame.progress > 0 &&
        frame.progress < ownership23.settled.progress,
    ),
  ).toBe(true);
  expect(ownership23.settled.exitingReveal).toBeNull();
  // Execute and Render retain local positions, but the destination-only origin still
  // moves their screen geometry continuously to the final frame.
  expectCameraBeforeScene(ownership23);
  expectCameraInterpolation(ownership23);
  expectFrameGeometry(ownership23.settled);
  expectFixedFooter(ownership23);
  const ownershipStable = await readStableSignature(page, 'custom-walkthrough');

  await openMotionFixture(page, 'custom-architecture');
  const root = page.locator('#custom-architecture');
  await root
    .getByRole('button', { name: 'State 2: 2. Follow the data' })
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(root.locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-motion-phase',
    'camera',
  );
  const finalStateButton = root.getByRole('button', { name: 'State 3: 3. Close the loop' });
  await finalStateButton.focus();
  await finalStateButton.evaluate((node) => (node as HTMLButtonElement).click());
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-state', 'observe');
  await expect(root.locator('[data-node-id="events"]')).toBeVisible();
  await expect(root.locator('.diagram-edge[data-edge-id="a5"]')).toBeVisible();
  await expect(finalStateButton).toBeFocused();
  await expect(root.locator('.diagram-scroll-container')).toHaveJSProperty('scrollLeft', 0);
  expect(await readStableSignature(page, 'custom-architecture')).toEqual(architectureStable);

  const interruptedExit = await root.evaluate((element) => {
    const diagram = element.querySelector<HTMLElement>('.diagram-renderer')!;
    const camera = element.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
    const before = getComputedStyle(camera).transform;
    element.querySelector<HTMLButtonElement>('[data-diagram-step-index="1"]')!.click();
    const interrupted = {
      phase: diagram.dataset.diagramMotionPhase,
      settled: diagram.dataset.diagramSettled,
      unchangedCamera: getComputedStyle(camera).transform === before,
      cameraAnimations: camera.getAnimations().length,
    };
    element.querySelector<HTMLButtonElement>('[data-diagram-step-index="0"]')!.click();
    return interrupted;
  });
  expect(interruptedExit).toEqual({
    phase: 'camera',
    settled: 'false',
    unchangedCamera: false,
    cameraAnimations: 1,
  });
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-state', 'orient');
  expect(await readStableSignature(page, 'custom-architecture')).toEqual(architectureOrient);

  await openMotionFixture(page, 'custom-walkthrough', true);
  const reducedRoot = page.locator('#custom-walkthrough');
  await reducedRoot
    .getByRole('button', { name: 'State 3: 3. Show the result' })
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(reducedRoot.locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-settled',
    'true',
  );
  await expect(reducedRoot.locator('.diagram-edge[data-edge-id="w5"]')).toHaveAttribute(
    'data-edge-motion-progress',
    '1',
  );
  await expect(reducedRoot.locator('[data-node-id="daemon"]')).toHaveCSS('opacity', '1');
  expect(await readStableSignature(page, 'custom-walkthrough')).toEqual(ownershipStable);
});

for (const appearance of framingAppearances) {
  for (const width of framingWidths) {
    test(`fits each reduced-motion scene above the footer · ${appearance.name} · ${width.name}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const params = new URLSearchParams({
        state: 'custom-architecture',
        theme: appearance.theme,
        width: String(width.value),
        motion: 'reduced',
      });
      if ('colorTheme' in appearance) params.set('colorTheme', appearance.colorTheme);
      await page.goto(`${baseUrl}/sandbox/diagram-workbench?${params}`);
      await expect(page.getByTestId('catalog-scene')).toHaveAttribute(
        'data-preview-ready',
        'true',
        {
          timeout: 30_000,
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
          const painted = [
            ...section.querySelectorAll<SVGGraphicsElement>(
              '[data-node-id], [data-group-id] .group-bg, .edge-path, .edge-label-container',
            ),
          ]
            .filter((element) => Number(getComputedStyle(element).opacity) > 0)
            .map((element) => element.getBoundingClientRect())
            .filter((bounds) => bounds.width > 0 || bounds.height > 0);
          const minX = Math.min(...painted.map((bounds) => bounds.left));
          const maxX = Math.max(...painted.map((bounds) => bounds.right));
          const minY = Math.min(...painted.map((bounds) => bounds.top));
          const maxY = Math.max(...painted.map((bounds) => bounds.bottom));
          const finiteAnimations = renderer
            .getAnimations({ subtree: true })
            .filter((animation) =>
              Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
            );
          return {
            nodeCount: section.querySelectorAll('[data-node-id]').length,
            centerDelta: Math.abs(
              (minX + maxX) / 2 - (viewportBounds.left + viewportBounds.right) / 2,
            ),
            footerOffset:
              footer.getBoundingClientRect().bottom - renderer.getBoundingClientRect().bottom,
            clearsFooter: viewportBounds.bottom <= footer.getBoundingClientRect().top + 1,
            overflow: Math.max(
              viewport.scrollWidth - viewport.clientWidth,
              viewport.scrollHeight - viewport.clientHeight,
            ),
            overflowStyle: getComputedStyle(viewport).overflow,
            finiteAnimationCount: finiteAnimations.length,
            capHeight: window.innerHeight * 0.9,
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
        expect(metrics.centerDelta).toBeLessThanOrEqual(8);
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
          expect(Math.abs(metrics.clientHeight - metrics.capHeight)).toBeLessThanOrEqual(1);
          expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
          expect(metrics.maxTop).toBe(metrics.scrollHeight - metrics.clientHeight);
        } else {
          expect(metrics.scrollHeight).toBe(metrics.clientHeight);
          expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.capHeight + 1);
          expect(metrics.fullyContainedAtTop, JSON.stringify({ index, metrics })).toBe(true);
        }
      }
    });
  }
}
