import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL ?? 'http://127.0.0.1:5173';
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
  sourceDistance: number;
  targetDistance: number;
  labelDistance: number | null;
  exitingOpacity: number | null;
  overflow: number;
  camera: string;
  footerOffset: number;
  motionPhase: string;
  cameraAnimationCount: number;
  cameraDurations: number[];
  entranceOpacity: number;
  nodeEntryOpacity: number;
  groupEntryOpacity: number;
  routeEntryOpacity: number;
  labelEntryOpacity: number;
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
  }));
  const renderer = await root.locator('.diagram-renderer').elementHandle();
  await root
    .locator('.diagram-nav-button')
    .nth(direction === 'forward' ? 1 : 0)
    .click();
  const frames = [];
  const deadline = Date.now() + 2_500;
  while (Date.now() < deadline) {
    frames.push(
      await root.evaluate((element, before) => {
        const diagram = element.querySelector<HTMLElement>('.diagram-renderer')!;
        const camera = element.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
        const geometry = element.querySelector<SVGGElement>('.diagram-geometry-motion')!;
        const entered = (selector: string, ids: Array<string | undefined>, key: string) =>
          [...element.querySelectorAll<HTMLElement>(selector)].filter(
            (node) => !ids.includes(node.dataset[key as keyof DOMStringMap]),
          );
        const maximumOpacity = (elements: Element[]) =>
          Math.max(0, ...elements.map((node) => Number(getComputedStyle(node).opacity)));
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
          .filter((edge) => Number(getComputedStyle(edge.parentElement!).opacity) > 0.01)
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
          cameraAnimationCount: cameraAnimations.length,
          cameraDurations: cameraAnimations.map((animation) =>
            Number(animation.effect?.getTiming().duration),
          ),
          enteredCounts: [nodes.length, groups.length, routes.length, labels.length],
          entryOpacities: [nodes, groups, routes, labels].map(maximumOpacity),
          entryDelays: [nodes, groups, routes, labels].map(maximumDelay),
          entryDurations: [nodes, groups, routes, labels].map(maximumDuration),
          nodeOpacities: opacityRecord('[data-node-id]'),
          groupOpacities: opacityRecord('[data-group-id]', true),
          edgeOpacities: opacityRecord('.diagram-edge', true),
          labelOpacities: opacityRecord('.edge-label-container'),
          detachedEdges,
          routeProgress: [...element.querySelectorAll<SVGGElement>('.diagram-edge')].map((edge) =>
            Number(edge.dataset.edgeMotionProgress),
          ),
        };
      }, baseline),
    );
    if (frames.at(-1)!.settled && frames.length > 1) break;
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
  return {
    baseline,
    frames,
    sameMount: await renderer.evaluate(
      (node, selector) => node === document.querySelector(selector),
      `#${rootId} .diagram-renderer`,
    ),
  };
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
      const sideDistance = (point: DOMPoint, bounds: DOMRect) =>
        Math.min(
          Math.hypot(point.x - (bounds.left + bounds.right) / 2, point.y - bounds.top),
          Math.hypot(point.x - bounds.right, point.y - (bounds.top + bounds.bottom) / 2),
          Math.hypot(point.x - (bounds.left + bounds.right) / 2, point.y - bounds.bottom),
          Math.hypot(point.x - bounds.left, point.y - (bounds.top + bounds.bottom) / 2),
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
          maxOpacity(enteringRoutes),
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
          sourceDistance: sideDistance(start, source),
          targetDistance: sideDistance(end, target),
          labelDistance,
          exitingOpacity: exiting ? Number(getComputedStyle(exiting).opacity) : null,
          overflow: viewport.scrollWidth - viewport.clientWidth,
          camera: `${getComputedStyle(camera).transform}|${getComputedStyle(geometry).transform}`,
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

function expectFrameGeometry(frame: Frame) {
  expect(frame.sourceDistance).toBeLessThanOrEqual(2);
  expect(frame.targetDistance).toBeGreaterThanOrEqual(4.5);
  expect(frame.targetDistance).toBeLessThanOrEqual(6);
  expect(frame.labelDistance).toBeLessThanOrEqual(4.5);
  expect(frame.overflow).toBeLessThanOrEqual(1);
}

function isBetween(value: number, start: number, end: number) {
  return value > Math.min(start, end) && value < Math.max(start, end);
}

function cameraMatrix(frame: Frame) {
  const values = frame.camera
    .split('|')[0]
    .match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)
    ?.map(Number);
  if (!values || values.length !== 6) throw new Error(`Invalid camera matrix: ${frame.camera}`);
  return values;
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
      frame.cameraDurations.some((duration) => duration >= 300 && duration <= 340),
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
  expect(transition.afterCamera.elapsedMs).toBeGreaterThanOrEqual(200);
  expect(transition.afterCamera.elapsedMs).toBeLessThanOrEqual(650);
  const firstVisibleFrame = (key: keyof Frame) =>
    transition.samples.findIndex((frame) => Number(frame[key]) > 0.01);
  const sceneFrame = Math.max(
    firstVisibleFrame('nodeEntryOpacity'),
    firstVisibleFrame('groupEntryOpacity'),
  );
  const routeFrame = firstVisibleFrame('routeEntryOpacity');
  const labelFrame = firstVisibleFrame('labelEntryOpacity');
  if (sceneFrame >= 0 && routeFrame >= 0) expect(routeFrame).toBeGreaterThan(sceneFrame);
  if (routeFrame >= 0 && labelFrame >= 0) expect(labelFrame).toBeGreaterThan(routeFrame);
}

function expectFixedFooter(transition: Awaited<ReturnType<typeof recordTransition>>) {
  for (const frame of [transition.start, ...transition.samples, transition.settled]) {
    expect(Math.abs(frame.footerOffset - transition.before.footerOffset)).toBeLessThanOrEqual(1);
  }
}

function expectCameraInterpolation(transition: Awaited<ReturnType<typeof recordTransition>>) {
  expect(transition.start.camera).not.toBe(transition.settled.camera);
  expect(
    transition.samples.some(
      (frame) =>
        frame.camera !== transition.start.camera && frame.camera !== transition.settled.camera,
    ),
  ).toBe(true);
  const midpoint = transition.cameraFrames.reduce((closest, frame) =>
    Math.abs(frame.elapsedMs - 160) < Math.abs(closest.elapsedMs - 160) ? frame : closest,
  );
  expect(midpoint.elapsedMs).toBeGreaterThanOrEqual(120);
  expect(midpoint.elapsedMs).toBeLessThanOrEqual(210);
  expect(cameraProgress(transition.before, midpoint, transition.settled)).toBeGreaterThan(0.05);
  expect(cameraProgress(transition.before, midpoint, transition.settled)).toBeLessThan(0.8);
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
        expect(transition.frames[0].phase).toBe('camera');
        expect(transition.frames[0].settled).toBe(false);
        expect(
          transition.frames.some(
            (frame) =>
              frame.phase === 'camera' &&
              frame.cameraAnimationCount > 0 &&
              frame.cameraDurations.some((duration) => duration >= 300 && duration <= 340),
          ),
        ).toBe(true);
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
          'edgeOpacities',
          'labelOpacities',
        ] as const;
        const hasDepartingContent = lifecycleKeys.some((key) =>
          Object.keys(transition.frames[0][key]).some((id) => !(id in settledFrame[key])),
        );
        if (hasDepartingContent) {
          expect(exitIndex).toBeGreaterThan(0);
          expect(sceneIndex).toBeGreaterThan(exitIndex);
        }
        const lifecycle = (
          key: 'nodeOpacities' | 'groupOpacities' | 'edgeOpacities' | 'labelOpacities',
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
          if (sceneDelay > 0) expect(stagedFrame.entryDelays[2]).toBeGreaterThan(sceneDelay);
          expect(stagedFrame.entryDelays[3]).toBeGreaterThan(stagedFrame.entryDelays[2]);
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
  expect(Math.max(...transition.frames.map((frame) => frame.entryDurations[2]))).toBeGreaterThan(
    100,
  );
  expect(Math.max(...transition.frames.map((frame) => frame.entryDurations[3]))).toBeGreaterThan(
    100,
  );
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
  expect(architecture23.start.group!.height).not.toBe(architecture23.settled.group!.height);
  expect(
    [architecture23.afterClick, ...architecture23.samples].some((frame) =>
      frame.groupAnimationDurations.some((duration) => duration >= 200 && duration <= 240),
    ),
  ).toBe(true);
  expect(
    architecture23.samples.some(
      (frame) =>
        frame.progress > architecture23.start.progress &&
        frame.progress < architecture23.settled.progress,
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
  expect(architecture31.settled.exitingOpacity).toBeNull();
  expectCameraBeforeScene(architecture31);
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
      (frame) =>
        frame.progress > ownership12.start.progress &&
        frame.progress < ownership12.settled.progress,
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
        frame.exitingOpacity !== null &&
        frame.exitingOpacity < ownership23.start.exitingOpacity! &&
        frame.exitingOpacity > 0,
    ),
  ).toBe(true);
  expect(ownership23.settled.exitingOpacity).toBeNull();
  expectCameraBeforeScene(ownership23);
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

  await root
    .getByRole('button', { name: 'State 2: 2. Follow the data' })
    .evaluate((node) => (node as HTMLButtonElement).click());
  await expect(root.locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-motion-phase',
    'camera',
  );
  await root
    .getByRole('button', { name: 'State 1: 1. Start in the workbench' })
    .evaluate((node) => (node as HTMLButtonElement).click());
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
        const metrics = await root.evaluate((section) => {
          const renderer = section.querySelector<HTMLElement>('.diagram-renderer')!;
          const viewport = section.querySelector<HTMLElement>('.diagram-scroll-container')!;
          const footer = section.querySelector<HTMLElement>('.diagram-footer')!;
          const viewportBounds = viewport.getBoundingClientRect();
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
            clipped: painted.some(
              (bounds) =>
                bounds.left < viewportBounds.left - 1 ||
                bounds.right > viewportBounds.right + 1 ||
                bounds.top < viewportBounds.top - 1 ||
                bounds.bottom > viewportBounds.bottom + 1,
            ),
            centerDelta: Math.abs(
              (minX + maxX) / 2 - (viewportBounds.left + viewportBounds.right) / 2,
            ),
            clipAmount: Math.max(
              viewportBounds.left - minX,
              maxX - viewportBounds.right,
              viewportBounds.top - minY,
              maxY - viewportBounds.bottom,
            ),
            clipSides: {
              left: viewportBounds.left - minX,
              right: maxX - viewportBounds.right,
              top: viewportBounds.top - minY,
              bottom: maxY - viewportBounds.bottom,
            },
            footerOffset:
              footer.getBoundingClientRect().bottom - renderer.getBoundingClientRect().bottom,
            clearsFooter: viewportBounds.bottom <= footer.getBoundingClientRect().top + 1,
            overflow: Math.max(
              viewport.scrollWidth - viewport.clientWidth,
              viewport.scrollHeight - viewport.clientHeight,
            ),
            overflowStyle: getComputedStyle(viewport).overflow,
            finiteAnimationCount: finiteAnimations.length,
          };
        });
        expect(metrics.nodeCount).toBe(nodeCounts[index]);
        expect(metrics.clipped, JSON.stringify({ index, metrics })).toBe(false);
        expect(metrics.centerDelta).toBeLessThanOrEqual(8);
        expect(Math.abs(metrics.footerOffset)).toBeLessThanOrEqual(1);
        expect(metrics.clearsFooter).toBe(true);
        expect(metrics.overflowStyle).toBe('hidden');
        expect(metrics.finiteAnimationCount).toBe(0);
      }
    });
  }
}
