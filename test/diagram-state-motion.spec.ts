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
  settled: boolean;
  state: string;
  node: { x: number; y: number; width: number; height: number; opacity: number } | null;
  enteringOpacity: number | null;
  group: { x: number; y: number; width: number; height: number } | null;
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

async function recordTransition(page: Page, rootId: string, buttonName: string, probe: Probe) {
  return page.locator(`#${rootId}`).evaluate(
    async (root, { buttonName, probe }) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
          settled: renderer.dataset.diagramSettled === 'true',
          state: renderer.dataset.diagramState ?? '',
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
      root.querySelector<HTMLButtonElement>(`button[aria-label="${buttonName}"]`)!.click();
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
      return { before, start, afterCamera, settled, samples, cameraFrames };
    },
    { buttonName, probe },
  );
}

async function readStableSignature(page: Page, rootId: string) {
  return page.locator(`#${rootId}`).evaluate((root) => ({
    state: root.querySelector<HTMLElement>('.diagram-renderer')?.dataset.diagramState,
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
        path: edge.querySelector('path.edge-path')?.getAttribute('d'),
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
  }));
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

function expectCameraBeforeScene(transition: Awaited<ReturnType<typeof recordTransition>>) {
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
}

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
        frame.group !== null &&
        isBetween(
          frame.group.height,
          architecture23.start.group!.height,
          architecture23.settled.group!.height,
        ),
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
