import { expect, test, type Locator, type Page } from '@playwright/test';
import { DIAGRAM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const states = Object.keys(DIAGRAM_WORKBENCH_CASES);
const widths = [240, 320, 420, 960, 1600] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ mode: 'serial' });

async function openState(
  page: Page,
  state: string,
  width: number,
  theme: 'light' | 'dark' | 'nord',
) {
  const url = `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=${theme}&width=${width}&motion=reduced`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const scene = page.getByTestId('catalog-scene');
  await expect(scene, `preview state ${state}`).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 120_000,
  });
  await expect(scene).toHaveAttribute('data-preview-stable', 'true');
  await expect(scene).toHaveAttribute('data-preview-capture-motion', 'reduced');
  await expect(scene).toHaveAttribute('data-preview-state', state);
  await expect(scene).toHaveAttribute('data-preview-width', String(width));
  await expect(page.locator('html')).toHaveClass(/catalog-reduced-motion/);
  const targetRenderer = page.locator(`#${state} .mermaid-renderer`);
  if ((await targetRenderer.count()) > 0) {
    await expect
      .poll(async () => {
        const terminalState = await targetRenderer
          .locator('.mermaid-error, .mermaid-empty')
          .count();
        return (
          terminalState > 0 || (await targetRenderer.getAttribute('data-render-settled')) === 'true'
        );
      })
      .toBe(true);
  }
  expect(await page.evaluate(() => window.__INTENT_PREVIEW__?.current())).toEqual({
    slug: 'diagram-workbench',
    state,
    width,
    status: 'ready',
  });
}

async function expectClientRequestLane(page: Page, identity: string) {
  const result = await page
    .locator('#mermaid-nested-groups svg[data-layout-settled="true"]')
    .evaluate((svg) => {
      const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
      const node = (name: string) => nodes.find((item) => item.textContent?.trim() === name)!;
      const path = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find((item) =>
        item.id.includes('L_Client_Gateway'),
      )!;
      const returnPath = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find((item) =>
        item.id.includes('L_Store_Client'),
      )!;
      const label = [...svg.querySelectorAll<SVGGElement>('g.edgeLabel')].find(
        (item) => item.textContent?.trim() === 'request',
      )!;
      const surface = label.querySelector<SVGGraphicsElement>('.edge-label-surface')!;
      const gateway = node('Gateway').getBoundingClientRect();
      const client = node('Client').getBoundingClientRect();
      const boundary = [...svg.querySelectorAll<SVGGElement>('g.cluster')]
        .find((cluster) =>
          cluster
            .querySelector(':scope > .cluster-label')
            ?.textContent?.includes('Runtime boundary'),
        )!
        .querySelector<SVGRectElement>(':scope > rect')!
        .getBoundingClientRect();
      const labelBounds = label.getBoundingClientRect();
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      const start = path.getPointAtLength(0).matrixTransform(matrix);
      const end = path.getPointAtLength(length).matrixTransform(matrix);
      const returnMatrix = returnPath.getScreenCTM()!;
      const returnEnd = returnPath
        .getPointAtLength(returnPath.getTotalLength())
        .matrixTransform(returnMatrix);
      const points = (path.dataset.manhattanPoints ?? '').split(' ').map((value) => {
        const [x, y] = value.split(',').map(Number);
        return new DOMPoint(x, y).matrixTransform(matrix);
      });
      const distanceToLabel = (point: DOMPoint) =>
        Math.hypot(
          Math.max(labelBounds.left - point.x, 0, point.x - labelBounds.right),
          Math.max(labelBounds.top - point.y, 0, point.y - labelBounds.bottom),
        );
      const probe = document.createElement('span');
      probe.style.background = 'var(--diagram-canvas)';
      svg.parentElement!.append(probe);
      const canvas = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const surfaceStyle = getComputedStyle(surface);
      const routeSamples = Array.from({ length: 201 }, (_, index) =>
        path.getPointAtLength((length * index) / 200).matrixTransform(matrix),
      );
      const otherLabels = [...svg.querySelectorAll<SVGGElement>('g.edgeLabel')].filter(
        (item) => item !== label,
      );
      return {
        clientGap: labelBounds.top - client.bottom,
        boundaryGap: boundary.top - labelBounds.bottom,
        bendGap: Math.min(...points.slice(1, -1).map(distanceToLabel)),
        startDistance: Math.hypot(
          start.x - (client.left + client.right) / 2,
          start.y - client.bottom,
        ),
        endDistance: Math.hypot(end.x - gateway.left, end.y - (gateway.top + gateway.bottom) / 2),
        returnDistance: Math.hypot(
          returnEnd.x - client.right,
          returnEnd.y - (client.top + client.bottom) / 2,
        ),
        routeOwnsLabel: routeSamples.some(
          (point) =>
            point.x >= labelBounds.left &&
            point.x <= labelBounds.right &&
            point.y >= labelBounds.top &&
            point.y <= labelBounds.bottom,
        ),
        overlapsOtherText: otherLabels.some((other) => {
          const bounds = other.getBoundingClientRect();
          return (
            labelBounds.left < bounds.right &&
            labelBounds.right > bounds.left &&
            labelBounds.top < bounds.bottom &&
            labelBounds.bottom > bounds.top
          );
        }),
        raised: Number(node('Client').dataset.requestLaneShift),
        lane: path.dataset.clientRequestLane,
        surfaceOpacity: surfaceStyle.opacity,
        surfaceBackground: surfaceStyle.backgroundColor,
        canvas,
      };
    });
  expect(result.raised, `${identity} Client shift`).toBeGreaterThan(0);
  expect(result.lane, `${identity} request lane`).toBe('downward');
  expect(result.clientGap, `${identity} Client clearance`).toBeGreaterThanOrEqual(8);
  expect(result.boundaryGap, `${identity} boundary clearance`).toBeGreaterThanOrEqual(8);
  expect(result.bendGap, `${identity} bend clearance`).toBeGreaterThanOrEqual(6);
  expect(result.startDistance, `${identity} request source port`).toBeLessThanOrEqual(1);
  expect(
    Math.abs(result.endDistance - 0.5 - 5),
    `${identity} request target gap`,
  ).toBeLessThanOrEqual(0.35);
  expect(
    Math.abs(result.returnDistance - 0.5 - 5),
    `${identity} return target gap`,
  ).toBeLessThanOrEqual(0.35);
  expect(result.routeOwnsLabel, `${identity} request label ownership`).toBe(true);
  expect(result.overlapsOtherText, `${identity} request text collision`).toBe(false);
  expect(result.surfaceOpacity, `${identity} request surface opacity`).toBe('1');
  expect(result.surfaceBackground, `${identity} request canvas surface`).toBe(result.canvas);
}

async function expectCustomGeometry(page: Page, state: string) {
  const result = await page.locator(`#${state} .diagram-renderer`).evaluate((renderer) => {
    const svg = renderer.querySelector<SVGSVGElement>('.diagram-svg-layer');
    if (!svg) return { missingSvg: true, overlaps: [], clippedLabels: [], edgeLabels: [] };
    const nodes = [...renderer.querySelectorAll<HTMLElement>('.diagram-node-html')];
    const overlaps: string[] = [];
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left].getBoundingClientRect();
        const b = nodes[right].getBoundingClientRect();
        if (
          a.right > b.left + 1 &&
          b.right > a.left + 1 &&
          a.bottom > b.top + 1 &&
          b.bottom > a.top + 1
        ) {
          overlaps.push(`${left}:${right}`);
        }
      }
    }
    const clippedLabels = [...renderer.querySelectorAll<HTMLElement>('.node-label')]
      .map((label, index) => ({
        index,
        clipped:
          label.scrollWidth > label.clientWidth + 2 || label.scrollHeight > label.clientHeight + 2,
      }))
      .filter(({ clipped }) => clipped)
      .map(({ index }) => index);
    const svgBounds = svg.getBoundingClientRect();
    const edgeLabels = [...renderer.querySelectorAll<SVGGraphicsElement>('.edge-label-container')]
      .map((label, index) => ({ index, bounds: label.getBoundingClientRect() }))
      .filter(
        ({ bounds }) =>
          bounds.left < svgBounds.left - 2 ||
          bounds.top < svgBounds.top - 2 ||
          bounds.right > svgBounds.right + 2 ||
          bounds.bottom > svgBounds.bottom + 2,
      )
      .map(({ index }) => index);
    return { missingSvg: false, overlaps, clippedLabels, edgeLabels };
  });
  expect(result.missingSvg, state).toBe(false);
  expect(result.overlaps, `${state} node overlaps`).toEqual([]);
  expect(result.clippedLabels, `${state} clipped node labels`).toEqual([]);
  expect(result.edgeLabels, `${state} edge-label bounds`).toEqual([]);
}

async function expectMermaidEdgeLabelGeometry(page: Page, state: string, expectedLabels: string[]) {
  const result = await page.locator(`#${state} .mermaid-svg`).evaluate((renderer) => {
    const labels = [...renderer.querySelectorAll<HTMLElement>('foreignObject span.edgeLabel')]
      .map((label, index) => {
        const foreignObject = label.closest('foreignObject');
        const content = label.querySelector<HTMLElement>('p') ?? label;
        if (!foreignObject) return null;
        const labelBounds = label.getBoundingClientRect();
        const contentBounds = content.getBoundingClientRect();
        const viewportBounds = foreignObject.getBoundingClientRect();
        const text = label.innerText.replace(/\s+/g, ' ').trim();
        if (!text) return null;
        const tolerance = 1;
        const contains = (bounds: DOMRect) =>
          bounds.left >= viewportBounds.left - tolerance &&
          bounds.top >= viewportBounds.top - tolerance &&
          bounds.right <= viewportBounds.right + tolerance &&
          bounds.bottom <= viewportBounds.bottom + tolerance;
        return {
          index,
          text,
          labelContained: contains(labelBounds),
          contentContained: contains(contentBounds),
          contentOverflow:
            content.scrollWidth > content.clientWidth + tolerance ||
            content.scrollHeight > content.clientHeight + tolerance,
          paddingImbalance: Math.max(
            Math.abs(Number(label.dataset.opticalTopGap) - Number(label.dataset.opticalBottomGap)),
            Math.abs(
              contentBounds.left - labelBounds.left - (labelBounds.right - contentBounds.right),
            ),
          ),
        };
      })
      .filter((label): label is NonNullable<typeof label> => label !== null);
    return {
      texts: labels.map(({ text }) => text),
      clipped: labels.filter(
        ({ labelContained, contentContained, contentOverflow }) =>
          !labelContained || !contentContained || contentOverflow,
      ),
      unbalanced: labels.filter(({ paddingImbalance }) => paddingImbalance > 0.5),
    };
  });
  expect(result.texts, `${state} edge-label text`).toEqual(expectedLabels);
  expect(result.clipped, `${state} clipped edge labels`).toEqual([]);
  expect(result.unbalanced, `${state} balanced edge-label knockout padding`).toEqual([]);
}

async function expectOpaqueStateLabelPaint(page: Page) {
  await page.setViewportSize({ width: 1400, height: 1400 });
  const state = page.locator('#mermaid-state');
  await state.scrollIntoViewIfNeeded();
  const result = await state.evaluate((root) => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--diagram-canvas)';
    root.append(probe);
    const canvasColor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const failures: string[] = [];
    let paintedOverlapCount = 0;
    const labels = [...root.querySelectorAll<SVGGElement>('g.edgeLabel')].filter((label) =>
      label.textContent?.trim(),
    );

    for (const label of labels) {
      const name = label.textContent!.trim();
      const background = label.querySelector<SVGRectElement>('rect.background');
      const text = label.querySelector<SVGGraphicsElement>('text');
      const path = label.dataset.routePathId
        ? root.querySelector<SVGPathElement>(`#${CSS.escape(label.dataset.routePathId)}`)
        : null;
      if (!background || !text || !path) {
        failures.push(`${name}: missing paint element`);
        continue;
      }

      const style = getComputedStyle(background);
      const backgroundBox = background.getBBox();
      const textBox = text.getBBox();
      const horizontalClearance = Math.min(
        textBox.x - backgroundBox.x,
        backgroundBox.x + backgroundBox.width - (textBox.x + textBox.width),
      );
      const verticalClearance = Math.min(
        textBox.y - backgroundBox.y,
        backgroundBox.y + backgroundBox.height - (textBox.y + textBox.height),
      );
      const screenBounds = background.getBoundingClientRect();
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      const crossing = Array.from({ length: 1001 }, (_, index) => {
        const point = path.getPointAtLength((length * index) / 1000);
        return matrix ? point.matrixTransform(matrix) : point;
      }).find(
        (point) =>
          point.x > screenBounds.left + 0.5 &&
          point.x < screenBounds.right - 0.5 &&
          point.y > screenBounds.top + 0.5 &&
          point.y < screenBounds.bottom - 0.5,
      );
      const stack = crossing ? document.elementsFromPoint(crossing.x, crossing.y) : [];
      const backgroundLayer = stack.indexOf(background);
      const routeLayer = stack.indexOf(path);

      if (style.opacity !== '1' || style.fillOpacity !== '1' || style.fill !== canvasColor) {
        failures.push(`${name}: translucent or canvas-mismatched surface`);
      }
      if (horizontalClearance < 5.9 || verticalClearance < 3.9) {
        failures.push(`${name}: incomplete text clearance`);
      }
      if (crossing) paintedOverlapCount += 1;
      if (crossing && (backgroundLayer < 0 || routeLayer <= backgroundLayer)) {
        failures.push(`${name}: route is not painted below the label surface`);
      }
    }

    return { count: labels.length, paintedOverlapCount, failures };
  });

  expect(result.count).toBeGreaterThan(0);
  expect(result.paintedOverlapCount).toBeGreaterThan(0);
  expect(result.failures).toEqual([]);
}

async function expectTerminalArrowGeometry(
  page: Page,
  state: string,
  expectedTargets: Record<string, string>,
) {
  const root = page.locator(`#${state}`);
  const pathSelector =
    state === 'mermaid-state' ? '.edgePaths path[marker-end]' : '.diagram-edge path[marker-end]';
  await expect(root.locator(pathSelector)).toHaveCount(Object.keys(expectedTargets).length, {
    timeout: 30_000,
  });
  const result = await root.evaluate(
    (section, args) => {
      const isMermaid = args.state === 'mermaid-state';
      const paths = [
        ...section.querySelectorAll<SVGPathElement>(
          isMermaid ? '.edgePaths path[marker-end]' : '.diagram-edge path[marker-end]',
        ),
      ];
      const nodes = isMermaid
        ? [...section.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
            const shape = node.querySelector<SVGGraphicsElement>(
              ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse',
            );
            return shape ? [{ label: node.textContent?.trim() ?? '', shape }] : [];
          })
        : [...section.querySelectorAll<HTMLElement>('.diagram-node-html')].map((node) => ({
            label: node.querySelector('.node-label')?.textContent?.trim() ?? '',
            shape: node.parentElement as unknown as SVGGraphicsElement,
          }));
      const signedBoundaryDistance = (point: DOMPoint, bounds: DOMRect) => {
        const dx = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
        const dy = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
        if (dx || dy) return Math.hypot(dx, dy);
        return -Math.min(
          point.x - bounds.left,
          bounds.right - point.x,
          point.y - bounds.top,
          bounds.bottom - point.y,
        );
      };
      const frame = section
        .querySelector<SVGSVGElement>(isMermaid ? '.mermaid-svg > svg' : '.diagram-svg-layer')!
        .getBoundingClientRect();

      return paths.map((path, index) => {
        const key = isMermaid
          ? String(index)
          : (path.closest('.diagram-edge')?.getAttribute('data-edge-id') ?? '');
        const expectedTarget = args.expectedTargets[key];
        const markerReference = path.getAttribute('marker-end') ?? '';
        const markerId = markerReference.match(/#([^)'\"]+)/)?.[1] ?? '';
        const marker = section.querySelector<SVGMarkerElement>(`marker[id="${markerId}"]`);
        const markerPath = marker?.querySelector<SVGPathElement>('path');
        const pathMatrix = path.getScreenCTM();
        const length = path.getTotalLength();
        const terminal = path.getPointAtLength(length);
        const tangent = path.getPointAtLength(Math.max(0, length - 0.25));
        const angle = Math.atan2(terminal.y - tangent.y, terminal.x - tangent.x);
        const refX = Number(marker?.getAttribute('refX'));
        const refY = Number(marker?.getAttribute('refY'));
        const viewBox = marker?.getAttribute('viewBox')?.split(/[ ,]+/).map(Number);
        const scaleX = viewBox ? Number(marker?.getAttribute('markerWidth')) / viewBox[2] : 1;
        const scaleY = viewBox ? Number(marker?.getAttribute('markerHeight')) / viewBox[3] : 1;
        const markerLength = markerPath?.getTotalLength() ?? 0;
        const markerSamples = Array.from({ length: 65 }, (_, sample) =>
          markerPath?.getPointAtLength((markerLength * sample) / 64),
        ).filter((point): point is DOMPoint => Boolean(point));
        const markerTip = markerSamples.toSorted((left, right) => right.x - left.x)[0];
        const localTip = markerTip
          ? {
              x:
                terminal.x +
                (markerTip.x - refX) * scaleX * Math.cos(angle) -
                (markerTip.y - refY) * scaleY * Math.sin(angle),
              y:
                terminal.y +
                (markerTip.x - refX) * scaleX * Math.sin(angle) +
                (markerTip.y - refY) * scaleY * Math.cos(angle),
            }
          : terminal;
        const tip = pathMatrix
          ? new DOMPoint(localTip.x, localTip.y).matrixTransform(pathMatrix)
          : new DOMPoint();
        const terminalScreen = pathMatrix
          ? new DOMPoint(terminal.x, terminal.y).matrixTransform(pathMatrix)
          : new DOMPoint();
        const tangentScreen = pathMatrix
          ? new DOMPoint(tangent.x, tangent.y).matrixTransform(pathMatrix)
          : new DOMPoint();
        const target = nodes.find((node) => node.label === expectedTarget);
        const targetBounds = target?.shape.getBoundingClientRect();
        const center = targetBounds
          ? {
              x: (targetBounds.left + targetBounds.right) / 2,
              y: (targetBounds.top + targetBounds.bottom) / 2,
            }
          : { x: 0, y: 0 };
        const inwardDot =
          (tip.x - tangentScreen.x) * (center.x - tip.x) +
          (tip.y - tangentScreen.y) * (center.y - tip.y);
        const closestTarget = nodes
          .map((node) => ({
            label: node.label,
            distance: Math.abs(signedBoundaryDistance(tip, node.shape.getBoundingClientRect())),
          }))
          .sort((left, right) => left.distance - right.distance)[0]?.label;
        const markerJoinDistance = Math.min(
          ...markerSamples.map((point) => Math.hypot(point.x - refX, point.y - refY)),
        );
        const markerPoints = markerSamples.map((point) => {
          const local = {
            x:
              terminal.x +
              (point.x - refX) * scaleX * Math.cos(angle) -
              (point.y - refY) * scaleY * Math.sin(angle),
            y:
              terminal.y +
              (point.x - refX) * scaleX * Math.sin(angle) +
              (point.y - refY) * scaleY * Math.cos(angle),
          };
          return pathMatrix
            ? new DOMPoint(local.x, local.y).matrixTransform(pathMatrix)
            : new DOMPoint();
        });
        const pathStyle = getComputedStyle(path);
        const markerStyle = markerPath && getComputedStyle(markerPath);
        const markerTipRadius = Number.parseFloat(markerStyle?.strokeWidth ?? '0') / 2;
        const strokeWidth = Number.parseFloat(pathStyle.strokeWidth);
        return {
          key,
          expectedTarget,
          closestTarget,
          boundaryDistance: targetBounds
            ? signedBoundaryDistance(tip, targetBounds) - markerTipRadius
            : null,
          inwardDot,
          markerJoinDistance,
          tipToTerminal: Math.hypot(tip.x - terminalScreen.x, tip.y - terminalScreen.y),
          markerUnits: marker?.getAttribute('markerUnits'),
          markerOrient: marker?.getAttribute('orient'),
          markerMid: path.getAttribute('marker-mid'),
          markerRatio: Number(marker?.getAttribute('markerWidth')) / strokeWidth,
          markerContained: markerPoints.every(
            (point) =>
              point.x >= frame.left - 1 &&
              point.x <= frame.right + 1 &&
              point.y >= frame.top - 1 &&
              point.y <= frame.bottom + 1,
          ),
          pathStroke: pathStyle.stroke,
          markerFill: markerStyle?.fill,
          markerStroke: markerStyle?.stroke,
          markerFillAttribute: markerPath?.getAttribute('fill'),
          markerStrokeAttribute: markerPath?.getAttribute('stroke'),
          pathLinecap: pathStyle.strokeLinecap,
          pathLinejoin: pathStyle.strokeLinejoin,
          markerLinecap: markerStyle?.strokeLinecap,
          markerLinejoin: markerStyle?.strokeLinejoin,
        };
      });
    },
    { state, expectedTargets },
  );

  expect(result).toHaveLength(Object.keys(expectedTargets).length);
  for (const edge of result) {
    expect(edge.closestTarget, `${state}/${edge.key} target`).toBe(edge.expectedTarget);
    expect(
      Math.abs((edge.boundaryDistance ?? Infinity) - 5),
      `${state}/${edge.key} painted terminal gap`,
    ).toBeLessThanOrEqual(0.35);
    expect(edge.inwardDot, `${state}/${edge.key} inward tangent`).toBeGreaterThan(0);
    expect(edge.markerJoinDistance, `${state}/${edge.key} shaft continuity`).toBeLessThanOrEqual(
      0.1,
    );
    expect(edge.tipToTerminal, `${state}/${edge.key} terminal marker`).toBeLessThanOrEqual(0.1);
    expect(edge.markerUnits).toBe('userSpaceOnUse');
    expect(edge.markerOrient).toBe('auto');
    expect(edge.markerMid).toBeNull();
    expect(edge.markerRatio, `${state}/${edge.key} proportional marker`).toBeGreaterThanOrEqual(4);
    expect(edge.markerRatio, `${state}/${edge.key} proportional marker`).toBeLessThanOrEqual(7);
    expect(edge.markerContained, `${state}/${edge.key} marker containment`).toBe(true);
    expect(edge.markerFillAttribute, `${state}/${edge.key} open marker interior`).toBe('none');
    expect(edge.markerStrokeAttribute, `${state}/${edge.key} marker stroke inheritance`).toBe(
      'context-stroke',
    );
    expect(edge.markerFill, `${state}/${edge.key} open marker fill`).toBe('none');
    expect([edge.pathStroke, 'context-stroke'], `${state}/${edge.key} marker stroke`).toContain(
      edge.markerStroke,
    );
    expect(edge.pathLinecap, `${state}/${edge.key} shaft cap`).toBe('round');
    expect(edge.pathLinejoin, `${state}/${edge.key} shaft join`).toBe('round');
    expect(edge.markerLinecap, `${state}/${edge.key} marker cap`).toBe('round');
    expect(edge.markerLinejoin, `${state}/${edge.key} marker join`).toBe('round');
  }
}

async function expectRunningToolClearance(page: Page, context: string) {
  const result = await page
    .locator('#mermaid-state svg[data-layout-settled=true]')
    .evaluate((svg) => {
      const label = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].find(
        (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === 'Tool starts',
      )!;
      const path = svg.querySelector<SVGPathElement>(`#${CSS.escape(label.dataset.routePathId!)}`)!;
      const surface = label.querySelector<SVGGraphicsElement>('rect.background')!;
      const values = path.dataset.labelSegment!.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)!.map(Number);
      const matrix = path.getScreenCTM()!;
      const first = new DOMPoint(values[0], values[1]).matrixTransform(matrix);
      const last = new DOMPoint(values[2], values[3]).matrixTransform(matrix);
      const bounds = surface.getBoundingClientRect();
      const vertical = Math.abs(first.x - last.x) < Math.abs(first.y - last.y);
      return {
        settled: Boolean(label.dataset.finalPathCenter),
        before: vertical
          ? bounds.top - Math.min(first.y, last.y)
          : bounds.left - Math.min(first.x, last.x),
        after: vertical
          ? Math.max(first.y, last.y) - bounds.bottom
          : Math.max(first.x, last.x) - bounds.right,
      };
    });
  expect(result.settled, `${context} final label placement`).toBe(true);
  expect(result.before, `${context} visible segment after turn`).toBeGreaterThanOrEqual(7.75);
  expect(result.after, `${context} visible outgoing stub`).toBeGreaterThanOrEqual(7.75);
}

async function expectStoreNodeGeometry(
  page: Page,
  state: 'mermaid-nested-groups' | 'custom-data-flow',
  context: string,
) {
  const result = await page.locator(`#${state}`).evaluate((root, renderedState) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--diagram-canvas)';
    root.append(probe);
    const canvas = getComputedStyle(probe).color;
    probe.remove();
    if (renderedState === 'custom-data-flow') {
      const body = [...root.querySelectorAll<HTMLElement>('.diagram-node-html')].find((node) =>
        node.textContent?.includes('Capture evidence'),
      )!;
      const copy = body.querySelector<HTMLElement>('.node-copy')!;
      const path = root.querySelector<SVGPathElement>('.diagram-edge[data-edge-id="d4"] path')!;
      const terminal = path
        .getPointAtLength(path.getTotalLength())
        .matrixTransform(path.getScreenCTM()!);
      const bounds = body.getBoundingClientRect();
      const copyBounds = copy.getBoundingClientRect();
      const markerId = path.getAttribute('marker-end')!.match(/#([^)]+)/)![1];
      const marker = root.querySelector<SVGMarkerElement>(`#${CSS.escape(markerId)}`)!;
      const markerStroke = Number.parseFloat(
        getComputedStyle(marker.querySelector<SVGPathElement>('path')!).strokeWidth,
      );
      const boundaryDistance = Math.hypot(
        Math.max(bounds.left - terminal.x, 0, terminal.x - bounds.right),
        Math.max(bounds.top - terminal.y, 0, terminal.y - bounds.bottom),
      );
      return {
        aspect: bounds.width / bounds.height,
        topGap: copyBounds.top - bounds.top,
        bottomGap: bounds.bottom - copyBounds.bottom,
        clipped:
          copyBounds.left < bounds.left ||
          copyBounds.right > bounds.right ||
          copyBounds.top < bounds.top ||
          copyBounds.bottom > bounds.bottom,
        perimeterClear: [...root.querySelectorAll<HTMLElement>('.diagram-node-html')].every(
          (node) => getComputedStyle(node).borderWidth === '0px',
        ),
        canvas,
        rim: getComputedStyle(body, '::before').borderTopColor,
        fill: getComputedStyle(body).backgroundColor,
        peerFill: getComputedStyle(
          [...root.querySelectorAll<HTMLElement>('.diagram-node-html')].find(
            (candidate) => candidate !== body,
          )!,
        ).backgroundColor,
        paintedGap: boundaryDistance - markerStroke / 2,
      };
    }
    const svg = root.querySelector<SVGSVGElement>('svg[data-layout-settled=true]')!;
    const node = [...svg.querySelectorAll<SVGGElement>('g.node')].find(
      (candidate) => candidate.textContent?.trim() === 'Store',
    )!;
    const body = node.querySelector<SVGPathElement>('[data-diagram-cylinder="true"]')!;
    const rim = node.querySelector<SVGPathElement>('.diagram-cylinder-rim')!;
    const label = node.querySelector<SVGGElement>(':scope > .label')!;
    const path = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path[marker-end]')].find(
      (candidate) => candidate.dataset.terminalTarget === node.id,
    )!;
    const bounds = body.getBoundingClientRect();
    const labelBounds = label.getBoundingClientRect();
    const terminal = path
      .getPointAtLength(path.getTotalLength())
      .matrixTransform(path.getScreenCTM()!);
    const radiusX = bounds.width / 2;
    const radiusY = bounds.height * Number(body.dataset.cylinderRimRatio);
    const centerX = bounds.left + radiusX;
    const boundary = Array.from({ length: 1025 }, (_, index) => {
      const angle = Math.PI + (Math.PI * index) / 1024;
      return {
        x: centerX + Math.cos(angle) * radiusX,
        y: bounds.top + radiusY + Math.sin(angle) * radiusY,
      };
    });
    const markerRef = path.getAttribute('marker-end')!.match(/#([^)]+)/)![1];
    const markerPath = svg.querySelector<SVGPathElement>(`#${CSS.escape(markerRef)} path`)!;
    const markerStroke = Number.parseFloat(getComputedStyle(markerPath).strokeWidth);
    const peer = [...svg.querySelectorAll<SVGGElement>('g.node')]
      .find((candidate) => candidate !== node)!
      .querySelector<SVGGraphicsElement>(':scope > .label-container')!;
    return {
      aspect: bounds.width / bounds.height,
      topGap: labelBounds.top - bounds.top,
      bottomGap: bounds.bottom - labelBounds.bottom,
      clipped:
        labelBounds.left < bounds.left ||
        labelBounds.right > bounds.right ||
        labelBounds.top < bounds.top ||
        labelBounds.bottom > bounds.bottom,
      perimeterClear: [
        ...svg.querySelectorAll<SVGGraphicsElement>('g.node > .label-container'),
      ].every((shape) => getComputedStyle(shape).stroke === 'none'),
      canvas,
      rim: getComputedStyle(rim).stroke,
      fill: getComputedStyle(body).fill,
      peerFill: getComputedStyle(peer).fill,
      paintedGap:
        Math.min(
          ...boundary.map((point) => Math.hypot(point.x - terminal.x, point.y - terminal.y)),
        ) -
        markerStroke / 2,
    };
  }, state);
  expect(result.aspect, `${context} wide cylinder`).toBeGreaterThanOrEqual(1.4);
  expect(result.aspect, `${context} stable cylinder`).toBeLessThanOrEqual(2.2);
  expect(result.topGap, `${context} top text space`).toBeGreaterThanOrEqual(8);
  expect(result.bottomGap, `${context} bottom text space`).toBeGreaterThanOrEqual(8);
  expect(
    Math.abs(result.topGap - result.bottomGap),
    `${context} optical centering`,
  ).toBeLessThanOrEqual(2);
  expect(result.clipped, `${context} label containment`).toBe(false);
  expect(result.perimeterClear, `${context} borderless nodes`).toBe(true);
  expect(result.rim, `${context} canvas rim`).toBe(result.canvas);
  expect(result.fill, `${context} normal node fill`).toBe(result.peerFill);
  expect(Math.abs(result.paintedGap - 5), `${context} painted terminal gap`).toBeLessThanOrEqual(
    0.35,
  );
}

async function expectMermaidClassGeometry(page: Page, context: string) {
  const renderer = page.locator('#mermaid-class .mermaid-svg');
  await expect(renderer.locator('.class-box-outline').first()).toBeVisible();
  const result = await renderer.evaluate((element) => {
    const nodes = [...element.querySelectorAll<SVGGElement>('g.node')];
    const outlines = nodes.map((node) => node.querySelector<SVGRectElement>('.class-box-outline'));
    const members = [
      ...element.querySelectorAll<SVGTextElement>('.members-group text, .methods-group text'),
    ];
    const outside = members.flatMap((member) => {
      const outline = member
        .closest<SVGGElement>('g.node')
        ?.querySelector<SVGRectElement>('.class-box-outline');
      if (!outline) return [member.textContent?.trim() ?? 'missing outline'];
      const memberBounds = member.getBoundingClientRect();
      const outlineBounds = outline.getBoundingClientRect();
      const tolerance = 1;
      return memberBounds.left >= outlineBounds.left - tolerance &&
        memberBounds.top >= outlineBounds.top - tolerance &&
        memberBounds.right <= outlineBounds.right + tolerance &&
        memberBounds.bottom <= outlineBounds.bottom + tolerance
        ? []
        : [member.textContent?.trim() ?? 'unknown member'];
    });
    const overlaps: string[] = [];
    for (let left = 0; left < outlines.length; left += 1) {
      for (let right = left + 1; right < outlines.length; right += 1) {
        const a = outlines[left]?.getBoundingClientRect();
        const b = outlines[right]?.getBoundingClientRect();
        if (!a || !b) continue;
        if (
          a.right > b.left + 1 &&
          b.right > a.left + 1 &&
          a.bottom > b.top + 1 &&
          b.bottom > a.top + 1
        ) {
          overlaps.push(`${left}:${right}`);
        }
      }
    }
    const classText = [...element.querySelectorAll<SVGTextElement>('g.node text')].map((text) => ({
      text: text.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      bounds: text.getBoundingClientRect(),
    }));
    const compartmentResults = nodes.map((node) => {
      const matrix = node.getScreenCTM();
      const scaleY = matrix ? Math.hypot(matrix.c, matrix.d) || 1 : 1;
      const name = node.querySelector('.label-group')?.textContent?.trim() ?? 'unknown';
      const memberTexts = [
        ...node.querySelectorAll<SVGTextElement>('.members-group text, .methods-group text'),
      ];
      const dividers = [...node.querySelectorAll<SVGLineElement>('.class-box-divider')];
      const dividerYs = dividers.flatMap((divider) => {
        const matrix = divider.getScreenCTM();
        if (!matrix) return [];
        return [new DOMPoint(0, Number(divider.getAttribute('y1'))).matrixTransform(matrix).y];
      });
      const textBounds = memberTexts.map((text) => ({
        text: text.textContent?.trim() ?? '',
        bounds: text.getBoundingClientRect(),
      }));
      const crossings = dividerYs.flatMap((dividerY, dividerIndex) =>
        textBounds.flatMap(({ text, bounds }) =>
          dividerY > bounds.top - 1 && dividerY < bounds.bottom + 1
            ? [`${dividerIndex}:${text}`]
            : [],
        ),
      );
      const gaps = dividerYs.flatMap((dividerY) =>
        textBounds.map(({ bounds }) =>
          Math.max(bounds.top - dividerY, dividerY - bounds.bottom, 0),
        ),
      );
      const membersBounds = node
        .querySelector<SVGGElement>('.members-group')
        ?.getBoundingClientRect();
      const methodsBounds = node
        .querySelector<SVGGElement>('.methods-group')
        ?.getBoundingClientRect();
      return {
        name,
        dividerCount: dividers.length,
        crossings,
        minimumDividerGap: gaps.length ? Math.min(...gaps) / scaleY : null,
        fieldMethodGap:
          membersBounds && methodsBounds && membersBounds.height && methodsBounds.height
            ? (methodsBounds.top - membersBounds.bottom) / scaleY
            : null,
      };
    });
    const svgBounds = element.querySelector('svg')?.getBoundingClientRect();
    const viewportOverflow = [...outlines, ...members].flatMap((item, index) => {
      if (!item || !svgBounds) return [`${index}:missing`];
      const bounds = item.getBoundingClientRect();
      return bounds.left >= svgBounds.left - 1 &&
        bounds.top >= svgBounds.top - 1 &&
        bounds.right <= svgBounds.right + 1 &&
        bounds.bottom <= svgBounds.bottom + 1
        ? []
        : [String(index)];
    });
    const edgeTextCrossings: string[] = [];
    for (const [edgeIndex, path] of [
      ...element.querySelectorAll<SVGPathElement>('.edgePaths path[data-edge="true"]'),
    ].entries()) {
      const matrix = path.getScreenCTM();
      if (!matrix) continue;
      const length = path.getTotalLength();
      for (let distance = 0; distance <= length; distance += 2) {
        const point = path.getPointAtLength(distance).matrixTransform(matrix);
        const crossed = classText.find(
          ({ bounds }) =>
            point.x > bounds.left + 1 &&
            point.x < bounds.right - 1 &&
            point.y > bounds.top + 1 &&
            point.y < bounds.bottom - 1,
        );
        if (crossed) {
          edgeTextCrossings.push(`${edgeIndex}:${crossed.text}`);
          break;
        }
      }
    }
    return {
      memberTexts: members.map((member) => member.textContent?.trim()),
      outlineHeights: outlines.map((outline) => outline?.getBBox().height ?? 0),
      outside,
      overlaps,
      viewportOverflow,
      edgeTextCrossings,
      compartmentResults,
    };
  });
  expect(result.memberTexts, `${context} class members`).toEqual([
    '+string id',
    '+string defaultState',
    '+resolveState()',
    '+string title',
    '+render()',
  ]);
  expect(result.outlineHeights[0], `${context} populated outline height`).toBeGreaterThan(100);
  expect(result.outlineHeights[1], `${context} empty outline height`).toBeGreaterThanOrEqual(32);
  expect(result.outlineHeights[1], `${context} empty outline height`).toBeLessThanOrEqual(42);
  expect(result.outlineHeights[2], `${context} populated outline height`).toBeGreaterThan(100);
  expect(result.outside, `${context} member containment`).toEqual([]);
  expect(result.overlaps, `${context} class overlaps`).toEqual([]);
  expect(result.viewportOverflow, `${context} SVG viewport containment`).toEqual([]);
  expect(result.edgeTextCrossings, `${context} edge/text crossings`).toEqual([]);
  expect(result.compartmentResults, `${context} class compartments`).toEqual([
    {
      name: 'PreviewDefinition',
      dividerCount: 2,
      crossings: [],
      minimumDividerGap: expect.any(Number),
      fieldMethodGap: expect.any(Number),
    },
    {
      name: 'DiagramPreview',
      dividerCount: 0,
      crossings: [],
      minimumDividerGap: null,
      fieldMethodGap: null,
    },
    {
      name: 'DiagramFixture',
      dividerCount: 2,
      crossings: [],
      minimumDividerGap: expect.any(Number),
      fieldMethodGap: expect.any(Number),
    },
  ]);
  for (const classResult of result.compartmentResults) {
    if (classResult.minimumDividerGap !== null) {
      expect(
        classResult.minimumDividerGap,
        `${context}/${classResult.name} divider gap`,
      ).toBeGreaterThanOrEqual(8);
    }
    if (classResult.fieldMethodGap !== null) {
      expect(
        classResult.fieldMethodGap,
        `${context}/${classResult.name} field/method gap`,
      ).toBeGreaterThanOrEqual(18);
    }
  }
}

async function expectActionsClearGeometry(
  page: Page,
  actionSelector: string | Locator,
  contentSelector: string,
  context: string,
) {
  const actionLocator =
    typeof actionSelector === 'string' ? page.locator(actionSelector) : actionSelector;
  const collisions = await actionLocator.evaluate((action, selector) => {
    const actionBounds = action.getBoundingClientRect();
    return [...document.querySelectorAll<SVGGraphicsElement | HTMLElement>(selector)]
      .map((element, index) => ({ element, index, bounds: element.getBoundingClientRect() }))
      .filter(
        ({ element, bounds }) =>
          getComputedStyle(element).visibility !== 'hidden' &&
          bounds.width > 0 &&
          bounds.height > 0,
      )
      .flatMap(({ element, index, bounds }) => {
        const overlapWidth =
          Math.min(actionBounds.right, bounds.right) - Math.max(actionBounds.left, bounds.left);
        const overlapHeight =
          Math.min(actionBounds.bottom, bounds.bottom) - Math.max(actionBounds.top, bounds.top);
        return overlapWidth > 1 && overlapHeight > 1
          ? [`${index}:${element.getAttribute('class') ?? element.tagName}`]
          : [];
      });
  }, contentSelector);
  expect(collisions, `${context} action collisions`).toEqual([]);
}

async function expectStableScreenshot(page: Page, state: string) {
  const stage = page.locator(`#${state} .diagram-stage`);
  let previous = await stage.screenshot({ animations: 'disabled' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(100);
    const current = await stage.screenshot({ animations: 'disabled' });
    if (current.equals(previous)) return;
    previous = current;
  }
  expect(false, `${state} did not produce two consecutive stable frames`).toBe(true);
}

test('discovers and renders all registered diagram states without application startup', async ({
  page,
}) => {
  test.setTimeout(720_000);
  await page.setViewportSize({ width: 1800, height: 1200 });
  const unexpectedConsoleErrors: string[] = [];
  const expectedInvalidErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: string[] = [];
  const webSockets: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (/mermaid|parse|syntax|lexical/i.test(message.text())) {
      expectedInvalidErrors.push(message.text());
    } else {
      unexpectedConsoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('websocket', (socket) => webSockets.push(socket.url()));

  await openState(page, states[0], 960, 'light');
  const discovery = await page.evaluate(async () => ({
    list: window.__INTENT_PREVIEW__?.list(),
    states: await window.__INTENT_PREVIEW__?.states('diagram-workbench'),
  }));
  expect(discovery.list).toContain('diagram-workbench');
  expect(discovery.states).toEqual(states);
  expect(discovery.states).toHaveLength(states.length);

  for (const [index, state] of states.entries()) {
    const width = widths[index % widths.length];
    const theme = index % 2 === 0 ? 'light' : 'dark';
    await openState(page, state, width, theme);
    const fixture = DIAGRAM_WORKBENCH_CASES[state as keyof typeof DIAGRAM_WORKBENCH_CASES];
    const section = page.locator(`#${state}`);
    const stage = section.locator('.diagram-stage');
    await expect(section.getByRole('heading', { name: fixture.title })).toBeVisible();

    if (fixture.kind === 'mermaid') {
      if (state === 'mermaid-invalid-source') {
        const alert = section.getByRole('alert');
        await expect(alert).toContainText(/Failed to render diagram/i);
        await expect(alert).toContainText(/Check the Mermaid syntax/i);
        await expect(alert).not.toContainText(/Expecting|Missing close/i);
        expect((await alert.textContent())?.length).toBeLessThan(120);
        await section.getByText('Technical details', { exact: true }).click();
        await expect(section.locator('.error-message')).toContainText('Missing close');
        await expect(section.locator('.error-source-code')).toContainText('flowchart LR');
      } else if (state === 'mermaid-empty-content') {
        await expect(stage.getByRole('status')).toContainText(/No diagram code/i);
      } else {
        const svg = stage.locator('.mermaid-svg > svg');
        await expect(svg).toBeVisible();
        expect((await svg.boundingBox())?.width).toBeGreaterThan(0);
      }
    } else if (fixture.kind === 'loading') {
      await expect(stage.getByRole('status')).toBeVisible();
    } else if (state === 'custom-empty-content') {
      await expect(stage.getByRole('status')).toContainText(/no nodes/i);
    } else {
      await expectCustomGeometry(page, state);
    }

    if (state === 'mermaid-groups') {
      expect(await section.locator('.mermaid-svg .cluster').count()).toBeGreaterThanOrEqual(2);
    }
    if (state === 'mermaid-dense-graph') {
      expect(await section.locator('.mermaid-svg .edgeLabel').count()).toBeGreaterThanOrEqual(6);
    }
    if (state === 'custom-architecture') {
      expect(await section.locator('.diagram-group').count()).toBeGreaterThanOrEqual(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  }

  await openState(page, 'mermaid-class', 420, 'light');
  const directTarget = page.locator('#mermaid-class');
  await expect(directTarget).toHaveAttribute('data-targeted', 'true');
  await expect
    .poll(async () => (await directTarget.boundingBox())?.y ?? Number.POSITIVE_INFINITY)
    .toBeLessThan(80);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true');
  await expect(directTarget.locator('.mermaid-svg > svg')).toBeVisible();

  const runtime = await page.evaluate(() => ({
    electronApi: 'electronAPI' in window,
    appReady: document.querySelectorAll('[data-testid="app-ready"]').length,
  }));
  expect(runtime).toEqual({ electronApi: false, appReady: 0 });
  expect(
    requests.filter((url) => /\/src\/(?:store\/renderer\/sagas|lib\/client\/live)\//.test(url)),
  ).toEqual([]);
  expect(
    requests.filter((url) => {
      const parsed = new URL(url);
      return (
        parsed.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(parsed.hostname)
      );
    }),
  ).toEqual([]);
  expect(webSockets.length).toBeGreaterThan(0);
  expect(
    webSockets.every((url) => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname)),
  ).toBe(true);
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(expectedInvalidErrors.length).toBeGreaterThan(0);
});

test('keeps token themes, reduced motion, and representative screenshots stable', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openState(page, 'mermaid-dense-graph', 960, 'light');
  const initial = await page.evaluate(() => ({
    background: getComputedStyle(document.documentElement).getPropertyValue('--background'),
    foreground: getComputedStyle(document.documentElement).getPropertyValue('--foreground'),
    svgId: document.querySelector('#mermaid-dense-graph .mermaid-svg > svg')?.id,
  }));
  await expectStableScreenshot(page, 'mermaid-dense-graph');

  await page.getByTestId('catalog-color-theme-control').click();
  await page.getByRole('option', { name: 'Nord', exact: true }).click();
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
    'data-catalog-color-theme',
    'nord',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--background'),
      ),
    )
    .not.toBe(initial.background);
  await expect
    .poll(() => page.locator('#mermaid-dense-graph .mermaid-svg > svg').getAttribute('id'))
    .not.toBe(initial.svgId);

  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const themed = await page.evaluate(() => ({
    background: getComputedStyle(document.documentElement).getPropertyValue('--background'),
    foreground: getComputedStyle(document.documentElement).getPropertyValue('--foreground'),
  }));
  expect(themed).not.toEqual({ background: initial.background, foreground: initial.foreground });

  await openState(page, 'custom-network', 320, 'dark');
  await expect(page.locator('#custom-network .edge-animated .edge-path').first()).toHaveCSS(
    'animation-name',
    'none',
  );
  await openState(page, 'custom-long-multiline-labels', 420, 'dark');
  await expectCustomGeometry(page, 'custom-long-multiline-labels');
  await expectStableScreenshot(page, 'custom-long-multiline-labels');
});

test('keeps flowchart edge-label content inside Mermaid viewports in every theme', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  const cases = [
    { state: 'mermaid-flow', labels: ['Yes', 'No'] },
    {
      state: 'mermaid-dense-graph',
      labels: [
        'parse',
        'lint',
        'index',
        'layout',
        'annotate',
        'select',
        'capture',
        'inspect',
        'feedback',
        'record',
        'review',
      ],
    },
    { state: 'mermaid-multiline-labels', labels: ['lazy import no daemon'] },
  ];

  for (const theme of ['light', 'dark'] as const) {
    for (const { state, labels } of cases) {
      await openState(page, state, 960, theme);
      await expectMermaidEdgeLabelGeometry(page, state, labels);
    }
  }

  await openState(page, cases[0].state, 960, 'light');
  await page.getByTestId('catalog-color-theme-control').click();
  await page.getByRole('option', { name: 'Nord', exact: true }).click();
  for (const { state, labels } of cases) {
    await openState(page, state, 960, 'light');
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
      'data-catalog-color-theme',
      'nord',
    );
    await expectMermaidEdgeLabelGeometry(page, state, labels);
  }
});

for (const appearance of [
  { name: 'light', mode: 'light' as const, colorTheme: 'Default' },
  { name: 'dark', mode: 'dark' as const, colorTheme: 'Default' },
  { name: 'nord', mode: 'light' as const, colorTheme: 'Nord' },
]) {
  for (const width of [420, 960] as const) {
    test(`separates Source feedback and forward ports in ${appearance.name} at ${width}px`, async ({
      page,
    }) => {
      await openState(page, 'mermaid-dense-graph', width, appearance.mode);
      const colorTheme = page.getByTestId('catalog-color-theme-control');
      if (!(await colorTheme.textContent())?.includes(appearance.colorTheme)) {
        await colorTheme.click();
        await page.getByRole('option', { name: appearance.colorTheme, exact: true }).click();
      }
      const geometry = await page
        .locator('#mermaid-dense-graph svg.flowchart[data-layout-settled="true"]')
        .evaluate((svg) => {
          const route = (source: string, target: string) =>
            [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find((path) =>
              new RegExp(`-L_${source}_${target}_[0-9]+$`).test(path.id),
            )!;
          const points = (path: SVGPathElement) =>
            path.dataset.manhattanPoints!.split(' ').map((value) => {
              const [x, y] = value.split(',').map(Number);
              return new DOMPoint(x, y).matrixTransform(path.getScreenCTM()!);
            });
          const sourceShape = [...svg.querySelectorAll<SVGGElement>('g.node')]
            .find((node) => node.textContent?.trim() === 'Source')!
            .querySelector<SVGGraphicsElement>(':scope > .label-container')!;
          const source = sourceShape.getBoundingClientRect();
          const parse = points(route('A', 'B'));
          const lint = points(route('A', 'C'));
          const index = points(route('A', 'D'));
          const feedbackPath = route('G', 'A');
          const feedback = points(feedbackPath);
          const capture = points(route('E', 'F'));
          const inspect = points(route('E', 'G'));
          const outgoing = [parse[0], lint[0], index[0]].toSorted(
            (left, right) => left.x - right.x,
          );
          return {
            feedbackFraction: (feedback.at(-1)!.x - source.left) / source.width,
            feedbackBeforeParse: feedback.at(-1)!.x < parse[0].x,
            feedbackParseGap: Math.abs(feedback.at(-1)!.x - parse[0].x),
            feedbackStub: Math.hypot(
              feedback.at(-1)!.x - feedback.at(-2)!.x,
              feedback.at(-1)!.y - feedback.at(-2)!.y,
            ),
            parseStub: Math.hypot(parse[1].x - parse[0].x, parse[1].y - parse[0].y),
            sharedParseFeedbackColumn: Math.abs(feedback.at(-1)!.x - parse[0].x) <= 1,
            outgoingGaps: outgoing.slice(1).map((point, i) => point.x - outgoing[i].x),
            framePortGap: Math.abs(capture[0].x - inspect[0].x),
            marker: feedbackPath.getAttribute('marker-end'),
          };
        });
      expect(geometry.feedbackFraction).toBeGreaterThan(0.15);
      expect(geometry.feedbackFraction).toBeLessThan(0.3);
      expect(geometry.feedbackBeforeParse).toBe(true);
      expect(geometry.feedbackParseGap).toBeGreaterThanOrEqual(4);
      expect(geometry.feedbackStub).toBeGreaterThanOrEqual(6);
      expect(geometry.parseStub).toBeGreaterThanOrEqual(8);
      expect(geometry.sharedParseFeedbackColumn).toBe(false);
      expect(Math.min(...geometry.outgoingGaps)).toBeGreaterThanOrEqual(8);
      expect(geometry.framePortGap).toBeGreaterThanOrEqual(8);
      expect(geometry.marker).toContain('pointEnd');
    });

    test(`preserves the manual column center in ${appearance.name} at ${width}px`, async ({
      page,
    }) => {
      await openState(page, 'custom-disconnected-extremes', width, appearance.mode);
      const colorTheme = page.getByTestId('catalog-color-theme-control');
      if (!(await colorTheme.textContent())?.includes(appearance.colorTheme)) {
        await colorTheme.click();
        await page.getByRole('option', { name: appearance.colorTheme, exact: true }).click();
      }
      const geometry = await page.locator('#custom-disconnected-extremes').evaluate((root) => {
        const unicode = root
          .querySelector<SVGGraphicsElement>('[data-node-id="unicode"]')!
          .getBoundingClientRect();
        const measured = root
          .querySelector<SVGGraphicsElement>('[data-node-id="multiline"]')!
          .getBoundingClientRect();
        const route = root.querySelector<SVGPathElement>('.diagram-edge[data-edge-id="x2"] path')!;
        const length = route.getTotalLength();
        const end = route.getPointAtLength(length).matrixTransform(route.getScreenCTM()!);
        const label = root
          .querySelector<SVGGraphicsElement>('.edge-label-container[data-edge-id="x2"]')!
          .getBoundingClientRect();
        const stage = root.querySelector<HTMLElement>('.diagram-stage')!.getBoundingClientRect();
        return {
          centerDelta: Math.abs(
            (unicode.left + unicode.right) / 2 - (measured.left + measured.right) / 2,
          ),
          targetGap: measured.top - end.y,
          bends: (route.getAttribute('d')?.match(/ Q /g) ?? []).length,
          labelContained: label.left >= stage.left - 1 && label.right <= stage.right + 1,
        };
      });
      expect(geometry.centerDelta).toBeLessThanOrEqual(1);
      expect(geometry.targetGap).toBeGreaterThanOrEqual(4.5);
      expect(geometry.targetGap).toBeLessThanOrEqual(6);
      if (width === 960) expect(geometry.bends).toBe(0);
      expect(geometry.labelContained).toBe(true);
    });
  }
}

for (const appearance of [
  { name: 'light', mode: 'light' as const, colorTheme: 'Default' },
  { name: 'dark', mode: 'dark' as const, colorTheme: 'Default' },
  { name: 'nord', mode: 'light' as const, colorTheme: 'Nord' },
]) {
  for (const width of [320, 420, 640, 960] as const) {
    test(`keeps the Client request lane clear in ${appearance.name} at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openState(page, 'mermaid-nested-groups', width, appearance.mode);
      const colorTheme = page.getByRole('button', { name: /Color theme/ });
      const renderer = page.locator('#mermaid-nested-groups .mermaid-renderer');
      if (!(await colorTheme.textContent())?.includes(appearance.colorTheme)) {
        const previousGeneration = Number(await renderer.getAttribute('data-render-generation'));
        await colorTheme.click();
        await page.getByRole('option', { name: appearance.colorTheme, exact: true }).click();
        await expect
          .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
          .toBeGreaterThan(previousGeneration);
      }
      await expect(colorTheme).toContainText(appearance.colorTheme);
      await expect(renderer).toHaveAttribute('data-render-settled', 'true');
      await expectClientRequestLane(page, `${appearance.name}/${width}/mermaid-nested-groups`);
      await expectStoreNodeGeometry(
        page,
        'mermaid-nested-groups',
        `${appearance.name}/${width}/mermaid-nested-groups`,
      );
    });
  }
}

test('terminal arrow tips keep an exact five-pixel gap from the correct target', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const mermaidTargets = {
    '0': 'Idle',
    '1': 'Starting',
    '2': 'Streaming',
    '3': 'RunningTool',
    '4': 'Streaming',
    '5': 'NeedsInput',
    '6': 'Streaming',
    '7': 'Complete',
    '8': 'Failed',
    '9': 'Failed',
    '10': 'Starting',
  };
  const customTargets = { st1: 'Loading', st2: 'Ready', st3: 'Invalid source', st4: 'Idle' };
  const appearances = [
    { mode: 'light' as const, colorTheme: 'Default' },
    { mode: 'dark' as const, colorTheme: 'Default' },
    { mode: 'light' as const, colorTheme: 'Nord' },
  ];

  for (const appearance of appearances) {
    for (const width of [960, 640, 420, 320]) {
      await openState(page, 'mermaid-state', width, appearance.mode);
      const colorTheme = page.getByRole('button', { name: /Color theme/ });
      const mermaidRenderer = page.locator('#mermaid-state .mermaid-renderer');
      const previousGeneration = Number(
        await mermaidRenderer.getAttribute('data-render-generation'),
      );
      if (!(await colorTheme.textContent())?.includes(appearance.colorTheme)) {
        await colorTheme.click();
        await page.getByRole('option', { name: appearance.colorTheme, exact: true }).click();
        await expect
          .poll(async () => Number(await mermaidRenderer.getAttribute('data-render-generation')))
          .toBeGreaterThan(previousGeneration);
      }
      await expect(colorTheme).toContainText(appearance.colorTheme);
      await expect(mermaidRenderer).toHaveAttribute('data-render-settled', 'true');
      await expect(async () => {
        await expectTerminalArrowGeometry(page, 'mermaid-state', mermaidTargets);
      }).toPass({ timeout: 10_000 });
      await expectRunningToolClearance(page, `${appearance.colorTheme}/${width}/mermaid-state`);

      await openState(page, 'custom-state-machine', width, appearance.mode);
      await expect(async () => {
        await expectTerminalArrowGeometry(page, 'custom-state-machine', customTargets);
      }).toPass({ timeout: 10_000 });
    }
  }
});

for (const appearance of [
  { name: 'light', mode: 'light' as const, colorTheme: 'Default' },
  { name: 'dark', mode: 'dark' as const, colorTheme: 'Default' },
  { name: 'nord', mode: 'light' as const, colorTheme: 'Nord' },
]) {
  for (const width of [320, 960] as const) {
    test(`keeps the custom Store borderless and balanced in ${appearance.name} at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openState(page, 'custom-data-flow', width, appearance.mode);
      const colorTheme = page.getByRole('button', { name: /Color theme/ });
      if (!(await colorTheme.textContent())?.includes(appearance.colorTheme)) {
        await colorTheme.click();
        await page.getByRole('option', { name: appearance.colorTheme, exact: true }).click();
      }
      await expect(colorTheme).toContainText(appearance.colorTheme);
      await expectStoreNodeGeometry(
        page,
        'custom-data-flow',
        `${appearance.name}/${width}/custom-data-flow`,
      );
    });
  }
}

test('keeps Mermaid class members and relations inside repaired geometry', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  const narrowWidths = [240, 320, 420] as const;

  await openState(page, 'mermaid-class', narrowWidths[0], 'light');
  await page.getByTestId('catalog-color-theme-control').click();
  await page.getByRole('option', { name: 'Default', exact: true }).click();
  for (const theme of ['light', 'dark'] as const) {
    for (const width of narrowWidths) {
      await openState(page, 'mermaid-class', width, theme);
      await expectMermaidClassGeometry(page, `${theme}/${width}`);
    }
  }

  await page.getByTestId('catalog-color-theme-control').click();
  await page.getByRole('option', { name: 'Nord', exact: true }).click();
  for (const width of narrowWidths) {
    await openState(page, 'mermaid-class', width, 'light');
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
      'data-catalog-color-theme',
      'nord',
    );
    await expectMermaidClassGeometry(page, `nord/${width}`);
  }
});

test('keeps actions outside content and frames compact diagrams at every supported width', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1900, height: 1200 });

  for (const [index, width] of widths.entries()) {
    const theme = index % 2 === 0 ? 'light' : 'dark';
    await openState(page, 'mermaid-long-labels', width, theme);
    await expectActionsClearGeometry(
      page,
      '#mermaid-long-labels .mermaid-actions',
      '#mermaid-long-labels .mermaid-svg .node, #mermaid-long-labels .mermaid-svg .edgeLabel, #mermaid-long-labels .mermaid-svg .edgePaths path, #mermaid-long-labels .mermaid-svg .cluster',
      `Mermaid ${theme}/${width}`,
    );

    await openState(page, 'custom-timeline', width, theme);
    await expectActionsClearGeometry(
      page,
      '#custom-timeline .diagram-actions',
      '#custom-timeline .diagram-node-html, #custom-timeline .edge-label-container, #custom-timeline .edge-path, #custom-timeline .diagram-group',
      `custom ${theme}/${width}`,
    );
  }

  for (const state of ['mermaid-class', 'custom-timeline'] as const) {
    await openState(page, state, 960, 'light');
    const metrics = await page.locator(`#${state} .diagram-stage`).evaluate((stage) => {
      const scene = stage.closest<HTMLElement>('[data-testid="catalog-scene"]');
      const renderer = stage.querySelector<HTMLElement>('.mermaid-renderer, .diagram-renderer');
      const text = stage.querySelector<HTMLElement | SVGTextElement>('.node-label, svg text');
      return {
        sceneWidth: scene?.getBoundingClientRect().width ?? 0,
        stageWidth: stage.getBoundingClientRect().width,
        rendererWidth: renderer?.getBoundingClientRect().width ?? 0,
        fontSize: text ? getComputedStyle(text).fontSize : '',
      };
    });
    expect(metrics.stageWidth, `${state} compact stage`).toBeLessThan(metrics.sceneWidth * 0.6);
    expect(metrics.rendererWidth, `${state} compact renderer`).toBeLessThanOrEqual(
      metrics.stageWidth,
    );
    expect(metrics.fontSize, `${state} natural text size`).toBe('13px');
  }

  await openState(page, 'mermaid-long-labels', 420, 'dark');
  await page.locator('#mermaid-long-labels .mermaid-svg-container').hover();
  await page
    .locator('#mermaid-long-labels')
    .getByRole('button', { name: 'Expand diagram to fullscreen' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Fullscreen diagram view' })).toBeVisible();
  await expectActionsClearGeometry(
    page,
    page
      .getByRole('dialog', { name: 'Fullscreen diagram view' })
      .getByRole('button', { name: 'Close fullscreen view' }),
    '.fullscreen-diagram .node, .fullscreen-diagram .edgeLabel, .fullscreen-diagram .edgePaths path, .fullscreen-diagram .cluster',
    'fullscreen Mermaid',
  );
});

for (const { name, theme, nord } of [
  { name: 'Light', theme: 'light', nord: false },
  { name: 'Dark', theme: 'dark', nord: false },
  { name: 'Nord', theme: 'light', nord: true },
] as const) {
  for (const width of [320, 960] as const) {
    test(`masks state routes with opaque ${name} label surfaces at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await openState(page, 'mermaid-state', width, theme);
      if (nord) {
        await page.getByTestId('catalog-color-theme-control').click();
        await page.getByRole('option', { name: 'Nord', exact: true }).click();
        await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
          'data-catalog-color-theme',
          'nord',
        );
        await expect(page.locator('#mermaid-state .mermaid-renderer')).toHaveAttribute(
          'data-render-settled',
          'true',
        );
      }
      await expectOpaqueStateLabelPaint(page);
    });
  }
}

test('keeps the reported state labels and group header bands clear', async ({ page }) => {
  test.setTimeout(300_000);
  for (const width of [320, 960]) {
    await openState(page, 'mermaid-state', width, 'light');
    await expect(page.locator('#mermaid-state .mermaid-svg > svg')).toBeVisible({
      timeout: 30_000,
    });
    const stateGeometry = await page.locator('#mermaid-state').evaluate((root) => {
      const labels = [...root.querySelectorAll<SVGGElement>('.edgeLabel')].filter((label) =>
        label.textContent?.trim(),
      );
      const byText = (text: string) => labels.find((label) => label.textContent?.trim() === text)!;
      const retries = byText('User retries').getBoundingClientRect();
      const fails = byText('Request fails').getBoundingClientRect();
      const finishes = byText('Agent finishes').getBoundingClientRect();
      const streamFails = byText('Stream fails').getBoundingClientRect();
      const complete = [...root.querySelectorAll<SVGGElement>('g.node')]
        .find((node) => node.textContent?.trim() === 'Complete')!
        .getBoundingClientRect();
      const svg = root.querySelector('.mermaid-svg > svg')!.getBoundingClientRect();
      const viewport = root.querySelector<HTMLElement>('.mermaid-svg-viewport')!;
      const viewportBounds = viewport.getBoundingClientRect();
      const visibleGeometry = [...root.querySelectorAll<SVGGElement>('g.node'), ...labels].map(
        (element) => element.getBoundingClientRect(),
      );
      const routeMisses = labels.flatMap((label) => {
        const path = document.getElementById(
          label.dataset.routePathId ?? '',
        ) as SVGPathElement | null;
        if (!path) return [label.textContent?.trim() ?? 'missing'];
        const bounds = label.getBoundingClientRect();
        const matrix = path.getScreenCTM();
        const length = path.getTotalLength();
        const ownsSegment = Array.from({ length: 101 }, (_, index) => {
          const point = path.getPointAtLength((length * index) / 100);
          return matrix ? point.matrixTransform(matrix) : point;
        }).some(
          (point) =>
            point.x >= bounds.left &&
            point.x <= bounds.right &&
            point.y >= bounds.top &&
            point.y <= bounds.bottom,
        );
        return ownsSegment ? [] : [label.textContent?.trim() ?? 'unknown'];
      });
      const labelOverlaps = labels.flatMap((label, index) => {
        const bounds = label.getBoundingClientRect();
        return labels.slice(index + 1).flatMap((other) => {
          const otherBounds = other.getBoundingClientRect();
          const overlaps =
            bounds.left < otherBounds.right &&
            bounds.right > otherBounds.left &&
            bounds.top < otherBounds.bottom &&
            bounds.bottom > otherBounds.top;
          return overlaps ? [`${label.textContent?.trim()}/${other.textContent?.trim()}`] : [];
        });
      });
      return {
        pairOverlaps:
          retries.left < fails.right &&
          retries.right > fails.left &&
          retries.top < fails.bottom &&
          retries.bottom > fails.top,
        finishStreamClearance: Math.hypot(
          Math.max(finishes.left - streamFails.right, streamFails.left - finishes.right, 0),
          Math.max(finishes.top - streamFails.bottom, streamFails.top - finishes.bottom, 0),
        ),
        routeMisses,
        labelOverlaps,
        completeContained: complete.left >= svg.left - 1 && complete.right <= svg.right + 1,
        viewportContained: visibleGeometry.every(
          (bounds) =>
            bounds.left >= viewportBounds.left - 1 && bounds.right <= viewportBounds.right + 1,
        ),
        horizontalOverflow: viewport.scrollWidth - viewport.clientWidth,
        effectiveFontSize:
          Number.parseFloat(getComputedStyle(root.querySelector('.mermaid-svg > svg')!).fontSize) *
          (svg.width /
            root.querySelector<SVGSVGElement>('.mermaid-svg > svg')!.viewBox.baseVal.width),
      };
    });
    expect(stateGeometry.pairOverlaps, `${width}px state label separation`).toBe(false);
    expect(
      stateGeometry.finishStreamClearance,
      `${width}px Agent finishes/Stream fails clearance`,
    ).toBeGreaterThanOrEqual(8);
    expect(stateGeometry.routeMisses, `${width}px state label route ownership`).toEqual([]);
    expect(stateGeometry.labelOverlaps, `${width}px state label lane overlaps`).toEqual([]);
    expect(stateGeometry.completeContained, `${width}px Complete containment`).toBe(true);
    expect(stateGeometry.viewportContained, `${width}px viewport containment`).toBe(true);
    expect(stateGeometry.horizontalOverflow, `${width}px horizontal overflow`).toBeLessThanOrEqual(
      1,
    );
    expect(
      stateGeometry.effectiveFontSize,
      `${width}px effective state font`,
    ).toBeGreaterThanOrEqual(12);

    await openState(page, 'mermaid-nested-groups', width, 'light');
    await expect(page.locator('#mermaid-nested-groups .mermaid-svg > svg')).toBeVisible({
      timeout: 30_000,
    });
    const groups = await page.locator('#mermaid-nested-groups').evaluate((root) =>
      [...root.querySelectorAll<SVGGElement>('g.cluster')].map((group) => {
        const label = group.querySelector<SVGGElement>(':scope > .cluster-label')!;
        const background = group.querySelector<SVGRectElement>(':scope > rect')!;
        const labelBounds = label.getBoundingClientRect();
        const groupBounds = background.getBoundingClientRect();
        const children = [...group.querySelectorAll<SVGGElement>('g.node')].map((node) =>
          node.getBoundingClientRect(),
        );
        const routeCrossesTitle = [
          ...group.querySelectorAll<SVGPathElement>('.edgePaths path'),
        ].some((path) => {
          const matrix = path.getScreenCTM();
          const length = path.getTotalLength();
          return Array.from({ length: 101 }, (_, index) => {
            const point = path.getPointAtLength((length * index) / 100);
            return matrix ? point.matrixTransform(matrix) : point;
          }).some(
            (point) =>
              point.x > labelBounds.left &&
              point.x < labelBounds.right &&
              point.y > labelBounds.top &&
              point.y < labelBounds.bottom,
          );
        });
        return {
          contained:
            labelBounds.left >= groupBounds.left - 1 &&
            labelBounds.top >= groupBounds.top - 1 &&
            labelBounds.right <= groupBounds.right + 1,
          childGap: Math.min(...children.map((child) => child.top - labelBounds.bottom)),
          routeCrossesTitle,
          measuredHeader: Number(group.dataset.headerHeight),
        };
      }),
    );
    for (const group of groups) {
      expect(group.contained, `${width}px group title containment`).toBe(true);
      expect(group.childGap, `${width}px group header clearance`).toBeGreaterThanOrEqual(6);
      expect(group.routeCrossesTitle, `${width}px group route clearance`).toBe(false);
      expect(group.measuredHeader, `${width}px measured group header`).toBeGreaterThan(24);
    }
  }
});

test('keeps data-flow feedback continuous from Preview source to Capture evidence', async ({
  page,
}) => {
  test.setTimeout(240_000);
  for (const width of [960, 640, 420, 320]) {
    await openState(page, 'custom-data-flow', width, 'light');
    await expectTerminalArrowGeometry(page, 'custom-data-flow', {
      d1: 'Parse deterministic fixture',
      d2: 'Compute stable layout',
      d3: 'Render semantic output',
      d4: 'Capture evidence',
      d5: 'Capture evidence',
    });
    const geometry = await page.locator('#custom-data-flow').evaluate((root) => {
      const path = root.querySelector<SVGPathElement>('.diagram-edge[data-edge-id="d5"] path')!;
      const source = [...root.querySelectorAll<HTMLElement>('.diagram-node-html')].find(
        (node) => node.querySelector('.node-label')?.textContent?.trim() === 'Preview source',
      )!;
      const length = path.getTotalLength();
      const start = path.getPointAtLength(0);
      const sourceLead = path.getPointAtLength(31.5);
      const targetLead = path.getPointAtLength(length - 31.5);
      const end = path.getPointAtLength(length);
      const matrix = path.getScreenCTM()!;
      const startScreen = new DOMPoint(start.x, start.y).matrixTransform(matrix);
      const sourceBounds = source.getBoundingClientRect();
      const pathBounds = path.getBoundingClientRect();
      const svgBounds = root
        .querySelector<SVGSVGElement>('.diagram-svg-layer')!
        .getBoundingClientRect();
      const viewport = root.querySelector<HTMLElement>('.diagram-scroll-container')!;
      return {
        sourceDistance: Math.hypot(
          startScreen.x - sourceBounds.right,
          startScreen.y - (sourceBounds.top + sourceBounds.bottom) / 2,
        ),
        sourceLead: sourceLead.x - start.x,
        sourceLeadDrift: Math.abs(sourceLead.y - start.y),
        targetLead: targetLead.x - end.x,
        targetLeadDrift: Math.abs(targetLead.y - end.y),
        moveCommands: (path.getAttribute('d')?.match(/M/g) ?? []).length,
        marker: path.getAttribute('marker-end'),
        contained: pathBounds.left >= svgBounds.left - 1 && pathBounds.right <= svgBounds.right + 1,
        noScrollbar: viewport.scrollWidth <= viewport.clientWidth + 1,
      };
    });
    expect(geometry.sourceDistance, `${width}px source port`).toBeLessThanOrEqual(1);
    expect(geometry.sourceLead, `${width}px source lead`).toBeGreaterThanOrEqual(31);
    expect(geometry.sourceLeadDrift, `${width}px source tangent`).toBeLessThanOrEqual(0.01);
    expect(geometry.targetLead, `${width}px target lead`).toBeGreaterThanOrEqual(31);
    expect(geometry.targetLeadDrift, `${width}px target tangent`).toBeLessThanOrEqual(0.01);
    expect(geometry.moveCommands, `${width}px continuous shaft`).toBe(1);
    expect(geometry.marker, `${width}px target marker`).toContain('arrowhead');
    expect(geometry.contained, `${width}px route containment`).toBe(true);
    expect(geometry.noScrollbar, `${width}px horizontal overflow`).toBe(true);
  }
});

test('discovers grouped fan-out semantically and keeps wide routes centered', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  for (const theme of ['light', 'dark', 'nord'] as const) {
    for (const width of widths) {
      await openState(page, 'mermaid-groups', width, theme === 'nord' ? 'dark' : theme);
      const mermaidRenderer = page.locator('#mermaid-groups .mermaid-renderer');
      if (theme === 'nord') {
        const previousGeneration = Number(
          await mermaidRenderer.getAttribute('data-render-generation'),
        );
        await page.getByRole('button', { name: 'Color theme' }).click();
        const nordOption = page.getByRole('option', { name: 'Nord', exact: true });
        const alreadyNord = (await nordOption.getAttribute('aria-selected')) === 'true';
        await nordOption.click();
        if (!alreadyNord) {
          await expect
            .poll(async () => Number(await mermaidRenderer.getAttribute('data-render-generation')))
            .toBeGreaterThan(previousGeneration);
        }
      }
      await expect(mermaidRenderer).toHaveAttribute('data-render-settled', 'true');
      const geometry = await page.locator('#mermaid-groups .mermaid-svg svg').evaluate((svg) => {
        const nodeShapes = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
          const shape = node.querySelector<SVGGraphicsElement>(':scope > .label-container');
          return shape ? [shape] : [];
        });
        const boundsInPath = (shape: SVGGraphicsElement, path: SVGPathElement) => {
          const bounds = shape.getBBox();
          const matrix = path.getCTM()!.inverse().multiply(shape.getCTM()!);
          const corners = [
            new DOMPoint(bounds.x, bounds.y),
            new DOMPoint(bounds.x + bounds.width, bounds.y),
            new DOMPoint(bounds.x, bounds.y + bounds.height),
            new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height),
          ].map((point) => point.matrixTransform(matrix));
          const xs = corners.map((point) => point.x);
          const ys = corners.map((point) => point.y);
          return {
            left: Math.min(...xs),
            right: Math.max(...xs),
            top: Math.min(...ys),
            bottom: Math.max(...ys),
          };
        };
        const distanceToBounds = (
          point: { x: number; y: number },
          bounds: ReturnType<typeof boundsInPath>,
        ) =>
          Math.hypot(
            Math.max(bounds.left - point.x, 0, point.x - bounds.right),
            Math.max(bounds.top - point.y, 0, point.y - bounds.bottom),
          );
        const routes = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap(
          (path) => {
            const logical = (path.dataset.manhattanPoints ?? '').split(' ').map((value) => {
              const [x, y] = value.split(',').map(Number);
              return { x, y };
            });
            if (logical.length < 2 || logical.some(({ x, y }) => !Number.isFinite(x + y)))
              return [];
            const nodes = nodeShapes.map((shape, index) => ({
              index,
              bounds: boundsInPath(shape, path),
            }));
            const nearest = (point: { x: number; y: number }) =>
              nodes.toSorted(
                (left, right) =>
                  distanceToBounds(point, left.bounds) - distanceToBounds(point, right.bounds),
              )[0];
            const source = nearest(logical[0]);
            const target = nearest(logical.at(-1)!);
            return source && target ? [{ path, logical, source, target }] : [];
          },
        );
        const bySource = new Map<number, typeof routes>();
        for (const route of routes) {
          bySource.set(route.source.index, [...(bySource.get(route.source.index) ?? []), route]);
        }
        const fanout = [...bySource.values()].find(
          (group) =>
            group.length === 2 && new Set(group.map(({ target }) => target.index)).size === 2,
        );
        if (!fanout) return { routeCount: 0, targetCount: 0, centeredRouteCount: 0, routes: [] };
        const sideCenters = (bounds: ReturnType<typeof boundsInPath>) => [
          { x: bounds.left + (bounds.right - bounds.left) / 2, y: bounds.top, vertical: true },
          { x: bounds.right, y: bounds.top + (bounds.bottom - bounds.top) / 2, vertical: false },
          { x: bounds.left + (bounds.right - bounds.left) / 2, y: bounds.bottom, vertical: true },
          { x: bounds.left, y: bounds.top + (bounds.bottom - bounds.top) / 2, vertical: false },
        ];
        const centeredRoutes = fanout.filter(({ path }) => path.dataset.fanoutSource);
        return {
          routeCount: fanout.length,
          targetCount: new Set(fanout.map(({ target }) => target.index)).size,
          centeredRouteCount: centeredRoutes.length,
          routes: centeredRoutes.map(({ logical, source, target }) => {
            const sourcePort = sideCenters(source.bounds).toSorted(
              (left, right) =>
                Math.hypot(logical[0].x - left.x, logical[0].y - left.y) -
                Math.hypot(logical[0].x - right.x, logical[0].y - right.y),
            )[0];
            const targetPort = sideCenters(target.bounds).toSorted(
              (left, right) =>
                Math.hypot(logical.at(-1)!.x - left.x, logical.at(-1)!.y - left.y) -
                Math.hypot(logical.at(-1)!.x - right.x, logical.at(-1)!.y - right.y),
            )[0];
            return {
              sourceMidpointDistance: Math.hypot(
                logical[0].x - sourcePort.x,
                logical[0].y - sourcePort.y,
              ),
              targetMidpointDistance: Math.hypot(
                logical.at(-1)!.x - targetPort.x,
                logical.at(-1)!.y - targetPort.y,
              ),
              sourcePerpendicular: sourcePort.vertical
                ? Math.abs(logical[1].x - logical[0].x)
                : Math.abs(logical[1].y - logical[0].y),
              targetPerpendicular: targetPort.vertical
                ? Math.abs(logical.at(-1)!.x - logical.at(-2)!.x)
                : Math.abs(logical.at(-1)!.y - logical.at(-2)!.y),
              trunk: logical.slice(0, 2),
              junctionClearance: Math.hypot(
                logical[1].x - logical[0].x,
                logical[1].y - logical[0].y,
              ),
            };
          }),
        };
      });
      expect(geometry.routeCount, `${theme} ${width}px semantic fan-out routes`).toBe(2);
      expect(geometry.targetCount, `${theme} ${width}px distinct fan-out targets`).toBe(2);
      if (width < 960) continue;
      expect(geometry.centeredRouteCount, `${theme} ${width}px centered fan-out routes`).toBe(2);
      expect(
        geometry.routes.every((edge) => edge.sourceMidpointDistance <= 1),
        `${theme} ${width}px source midpoint`,
      ).toBe(true);
      expect(
        geometry.routes.every((edge) => edge.targetMidpointDistance <= 1),
        `${theme} ${width}px target midpoint`,
      ).toBe(true);
      expect(geometry.routes.every((edge) => edge.sourcePerpendicular <= 1)).toBe(true);
      expect(geometry.routes.every((edge) => edge.targetPerpendicular <= 1)).toBe(true);
      expect(geometry.routes.every((edge) => edge.junctionClearance >= 16)).toBe(true);
      expect(geometry.routes[0].trunk).toEqual(geometry.routes[1].trunk);
    }
  }
});

test('uses one continuous centered-port route for the dense primary request', async ({ page }) => {
  await openState(page, 'custom-topology-stress', 320, 'light');
  const root = page.locator('#custom-topology-stress');
  const fit = root.locator('.diagram-fit-button');
  if ((await fit.getAttribute('aria-pressed')) !== 'true') await fit.click({ force: true });
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  const geometry = await root.evaluate((section) => {
    const path = section.querySelector<SVGPathElement>('.diagram-edge[data-edge-id="z1"] path')!;
    const nodes = [...section.querySelectorAll<HTMLElement>('.diagram-node-html')];
    const nodeBounds = (label: string) =>
      nodes
        .find((node) => node.querySelector('.node-label')?.textContent?.trim() === label)!
        .parentElement!.getBoundingClientRect();
    const source = nodeBounds('Input');
    const target = nodeBounds('Validation gate');
    const matrix = path.getScreenCTM()!;
    const length = path.getTotalLength();
    const point = (distance: number) => path.getPointAtLength(distance).matrixTransform(matrix);
    const start = point(0);
    const startTangent = point(0.25);
    const end = point(length);
    const endTangent = point(length - 0.25);
    const sideCenters = (bounds: DOMRect) => [
      { x: (bounds.left + bounds.right) / 2, y: bounds.top, vertical: true },
      { x: bounds.right, y: (bounds.top + bounds.bottom) / 2, vertical: false },
      { x: (bounds.left + bounds.right) / 2, y: bounds.bottom, vertical: true },
      { x: bounds.left, y: (bounds.top + bounds.bottom) / 2, vertical: false },
    ];
    const closest = (routePoint: DOMPoint, bounds: DOMRect) =>
      sideCenters(bounds)
        .map((port) => ({
          ...port,
          distance: Math.hypot(routePoint.x - port.x, routePoint.y - port.y),
        }))
        .sort((left, right) => left.distance - right.distance)[0];
    const sourcePort = closest(start, source);
    const targetPort = closest(end, target);
    const viewport = section.querySelector<HTMLElement>('.diagram-scroll-container')!;
    const svgElement = section.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
    const svg = svgElement.getBoundingClientRect();
    const scale = Math.hypot(svgElement.getScreenCTM()!.a, svgElement.getScreenCTM()!.b);
    const minimumPrimaryTextSize = Math.min(
      ...[...section.querySelectorAll<HTMLElement>('.node-label')].map(
        (label) => Number.parseFloat(getComputedStyle(label).fontSize) * scale,
      ),
    );
    const viewportBounds = viewport.getBoundingClientRect();
    return {
      moveCommands: (path.getAttribute('d')?.match(/(?:^|\s)M\s/g) ?? []).length,
      sourceDistance: sourcePort.distance,
      targetDistance: targetPort.distance,
      sourcePerpendicular: sourcePort.vertical
        ? Math.abs(startTangent.x - start.x)
        : Math.abs(startTangent.y - start.y),
      targetPerpendicular: targetPort.vertical
        ? Math.abs(end.x - endTangent.x)
        : Math.abs(end.y - endTangent.y),
      minimumPrimaryTextSize,
      noScrollbar: viewport.scrollWidth <= viewport.clientWidth + 1,
      contained: svg.left >= viewportBounds.left - 1 && svg.right <= viewportBounds.right + 1,
    };
  });
  expect(geometry.moveCommands).toBe(1);
  expect(geometry.sourceDistance).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.targetDistance - 0.5 - 5)).toBeLessThanOrEqual(0.35);
  expect(geometry.sourcePerpendicular).toBeLessThanOrEqual(0.5);
  expect(geometry.targetPerpendicular).toBeLessThanOrEqual(0.5);
  expect(geometry.minimumPrimaryTextSize).toBeGreaterThanOrEqual(12);
  expect(geometry.noScrollbar).toBe(true);
  expect(geometry.contained).toBe(true);
});

test('centers the topology stress self-loop on exact cardinal ports', async ({ page }) => {
  test.setTimeout(240_000);
  const appearances = [
    { mode: 'light' as const, colorTheme: 'Default' },
    { mode: 'dark' as const, colorTheme: 'Default' },
    { mode: 'light' as const, colorTheme: 'Nord' },
  ];

  for (const appearance of appearances) {
    for (const width of [960, 640, 420, 320]) {
      await openState(page, 'custom-topology-stress', width, appearance.mode);
      const colorTheme = page.getByTestId('catalog-color-theme-control');
      if (!(await colorTheme.textContent())?.includes(appearance.colorTheme)) {
        await colorTheme.click();
        await page.getByRole('option', { name: appearance.colorTheme, exact: true }).click();
      }
      const geometry = await page.locator('#custom-topology-stress').evaluate((root) => {
        const path = root.querySelector<SVGPathElement>(
          '.diagram-edge[data-edge-id="z5"] path.edge-path',
        )!;
        const node = root.querySelector<SVGForeignObjectElement>('[data-node-id="hub"]')!;
        const bounds = node.getBoundingClientRect();
        const matrix = path.getScreenCTM()!;
        const length = path.getTotalLength();
        const point = (distance: number) => path.getPointAtLength(distance).matrixTransform(matrix);
        const start = point(0);
        const next = point(Math.min(0.25, length));
        const previous = point(Math.max(0, length - 0.25));
        const end = point(length);
        const source = { x: (bounds.left + bounds.right) / 2, y: bounds.top };
        const target = { x: bounds.right, y: (bounds.top + bounds.bottom) / 2 };
        const routeOutside = Array.from({ length: 199 }, (_, index) =>
          point((length * (index + 1)) / 200),
        ).every(
          (sample) =>
            sample.x >= bounds.right - 1 ||
            sample.y <= bounds.top + 1 ||
            sample.x <= bounds.left + 1 ||
            sample.y >= bounds.bottom - 1,
        );
        return {
          sourceDistance: Math.hypot(start.x - source.x, start.y - source.y),
          targetDistance: Math.hypot(end.x - target.x, end.y - target.y),
          sourcePerpendicular: Math.abs(next.x - start.x),
          targetPerpendicular: Math.abs(end.y - previous.y),
          routeOutside,
          moveCommands: (path.getAttribute('d')?.match(/(?:^|\s)M\s/g) ?? []).length,
          hasTargetMarker: Boolean(path.getAttribute('marker-end')),
        };
      });
      const label = `${appearance.colorTheme}/${appearance.mode}/${width}`;
      expect(geometry.sourceDistance, `${label} source midpoint`).toBeLessThanOrEqual(1);
      expect(
        Math.abs(geometry.targetDistance - 0.5 - 5),
        `${label} target gap`,
      ).toBeLessThanOrEqual(0.35);
      expect(geometry.sourcePerpendicular, `${label} source tangent`).toBeLessThanOrEqual(0.5);
      expect(geometry.targetPerpendicular, `${label} target tangent`).toBeLessThanOrEqual(0.5);
      expect(geometry.routeOutside, `${label} outside route`).toBe(true);
      expect(geometry.moveCommands, `${label} continuous path`).toBe(1);
      expect(geometry.hasTargetMarker, `${label} target marker`).toBe(true);
    }
  }
});

test('animates diagram state entries and exposes a deterministic settled signal', async ({
  page,
}) => {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=960&motion=full`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 30_000,
  });
  const root = page.locator('#custom-architecture');
  const motion = await root.evaluate(async (section) => {
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const read = () => {
      const node = [...section.querySelectorAll<HTMLElement>('.diagram-node-html')].find(
        (element) => element.textContent?.includes('Intent daemon'),
      )!.parentElement!;
      const edgePath = section.querySelector<SVGPathElement>(
        '.diagram-edge[data-edge-id="a2"] path.edge-path',
      );
      return {
        opacity: Number(getComputedStyle(node).opacity),
        transform: getComputedStyle(node).transform,
        settled: section.querySelector<HTMLElement>('.diagram-renderer')!.dataset.diagramSettled,
        edgeDrawIn: Boolean(edgePath?.closest('.edge-draw-in')),
        edgeAnimation: edgePath ? getComputedStyle(edgePath).animationName : null,
        edgeDashOffset: edgePath ? getComputedStyle(edgePath).strokeDashoffset : null,
      };
    };
    section
      .querySelector<HTMLButtonElement>('button[aria-label="State 2: 2. Follow the data"]')!
      .click();
    await Promise.resolve();
    const initial = read();
    const deadline = performance.now() + 2_000;
    let middle = initial;
    while (!(
      middle.settled === 'false' &&
      middle.opacity > initial.opacity &&
      middle.opacity < 1
    )) {
      if (performance.now() > deadline) throw new Error('Diagram entry had no midpoint frame');
      await nextFrame();
      middle = read();
    }
    while (read().settled !== 'true') {
      if (performance.now() > deadline) throw new Error('Diagram entry did not settle');
      await nextFrame();
    }
    const final = read();
    await nextFrame();
    return { initial, middle, final, nextPaint: read() };
  });
  expect(motion.initial.opacity).toBeLessThan(1);
  expect(motion.initial.settled).toBe('false');
  expect(motion.middle.opacity).toBeGreaterThanOrEqual(motion.initial.opacity);
  expect(motion.final.opacity).toBe(1);
  expect(motion.final.transform).toBe('none');
  expect(motion.final.edgeDrawIn).toBe(false);
  expect(motion.final.edgeAnimation).toBe('none');
  expect(motion.final.edgeDashOffset).toBe('0px');
  expect(motion.nextPaint).toEqual(motion.final);

  await openState(page, 'custom-architecture', 960, 'light');
  const reducedRoot = page.locator('#custom-architecture');
  await reducedRoot.getByRole('button', { name: 'State 2: 2. Follow the data' }).click();
  const reducedDaemon = reducedRoot
    .locator('.diagram-node-html', { hasText: 'Intent daemon' })
    .locator('..');
  await expect(reducedDaemon).toHaveCSS('opacity', '1');
  await expect(reducedDaemon).toHaveCSS('transform', 'none');
  await expect(reducedRoot.locator('.diagram-edge[data-edge-id="a2"] path')).toHaveCSS(
    'animation-name',
    'none',
  );
  await expect(reducedRoot.locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-settled',
    'true',
  );
});
