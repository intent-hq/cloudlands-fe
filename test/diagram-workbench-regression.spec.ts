import { expect, test, type Locator, type Page } from '@playwright/test';
import { DIAGRAM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';
import { useDiagramPreviewServer } from './diagram-preview-server';

const preview = useDiagramPreviewServer('diagram-workbench-regression');
const states = Object.keys(DIAGRAM_WORKBENCH_CASES);

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const colorTheme = new URL(location.href).searchParams.get('colorTheme') ?? 'default';
    localStorage.setItem('component-catalog-preferences', JSON.stringify({ colorTheme }));
  });
});

async function chooseColorTheme(page: Page, name: string) {
  const control = page.getByTestId('catalog-color-theme-control');
  if ((await control.textContent())?.trim() !== name) {
    if (!(await control.isVisible()))
      await page.getByRole('button', { name: 'Customize preview', exact: true }).click();
    await control.click();
    await page.getByRole('option', { name, exact: true }).click();
  }
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
    'data-catalog-color-theme',
    name.toLowerCase(),
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 120_000,
  });
  return control;
}

async function openState(
  page: Page,
  state: string,
  width: number,
  theme: 'light' | 'dark' | 'nord',
) {
  const url = `${preview.url}/sandbox/diagram-workbench?state=${state}&theme=${theme === 'nord' ? 'light' : theme}&colorTheme=${theme === 'nord' ? 'nord' : 'default'}&width=${width}&motion=reduced`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const scene = page.getByTestId('catalog-scene');
  await expect(scene, `preview state ${state}`).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 120_000,
  });
  await expect(scene).toHaveAttribute('data-preview-stable', 'true');
  await expect(scene).toHaveAttribute('data-preview-capture-motion', 'reduced');
  await expect(scene).toHaveAttribute('data-preview-state', state);
  await expect(scene).toHaveAttribute('data-preview-width', String(width));
  await chooseColorTheme(page, theme === 'nord' ? 'Nord' : 'Default');
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

type Connection = { id: string; source: string; target: string };

// Authored IDs select the routes; browser geometry supplies the observed result.
// Native flowcharts deliberately do not emit the old manhattan/lane metadata.
function paintedRouteGeometry(root: Element, connections: Connection[]) {
  const visible = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0)
        return false;
    }
    return element.isConnected;
  };
  const custom = Boolean(root.querySelector('.diagram-renderer'));
  const nodes = [
    ...root.querySelectorAll<SVGGraphicsElement>(custom ? '[data-node-id]' : 'g.node'),
  ].map((node) => {
    const shape = custom
      ? node
      : node.querySelector<SVGGraphicsElement>(
          ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse, :scope > polygon, :scope > .outer-path',
        );
    if (!shape || !visible(shape)) throw new Error(`Missing visible node shape: ${node.id}`);
    const bounds = shape.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0)) throw new Error(`Empty node shape: ${node.id}`);
    return { name: custom ? node.dataset.nodeId! : node.textContent!.trim(), shape, bounds };
  });
  const uniqueNode = (name: string) => {
    const matches = nodes.filter((node) => node.name === name);
    if (matches.length !== 1) throw new Error(`Expected one node ${name}, got ${matches.length}`);
    return matches[0];
  };
  const inside = (point: { x: number; y: number }, bounds: DOMRect) =>
    point.x > bounds.left + 1 &&
    point.x < bounds.right - 1 &&
    point.y > bounds.top + 1 &&
    point.y < bounds.bottom - 1;
  const boundaryDistance = (point: { x: number; y: number }, node: (typeof nodes)[number]) => {
    if (node.shape instanceof SVGGeometryElement) {
      const matrix = node.shape.getScreenCTM();
      const length = node.shape.getTotalLength();
      if (!matrix || !Number.isFinite(length) || length <= 0)
        throw new Error(`Invalid boundary: ${node.name}`);
      const count = Math.max(
        4,
        Math.ceil(length * Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d) * 2),
      );
      let distance = Infinity;
      for (let index = 0; index <= count; index++) {
        const sample = node.shape
          .getPointAtLength((length * index) / count)
          .matrixTransform(matrix);
        distance = Math.min(distance, Math.hypot(point.x - sample.x, point.y - sample.y));
      }
      return distance;
    }
    const { left, right, top, bottom } = node.bounds;
    const outside = Math.hypot(
      Math.max(left - point.x, point.x - right, 0),
      Math.max(top - point.y, point.y - bottom, 0),
    );
    return outside || Math.min(point.x - left, right - point.x, point.y - top, bottom - point.y);
  };
  return connections.map(({ id, source, target }) => {
    const matches = custom
      ? [...root.querySelectorAll<SVGPathElement>(`.diagram-edge[data-edge-id="${id}"] .edge-path`)]
      : [...root.querySelectorAll<SVGPathElement>('.edgePaths path, .edges.edgePath path')].filter(
          (path) => path.id === id || path.id.endsWith(`-${id}`),
        );
    if (matches.length !== 1)
      throw new Error(`Expected one painted route ${id}, got ${matches.length}`);
    const path = matches[0];
    const matrix = path.getScreenCTM();
    const length = path.getTotalLength();
    const style = getComputedStyle(path);
    if (
      !visible(path) ||
      !matrix ||
      !path.getAttribute('d')?.trim() ||
      !Number.isFinite(length) ||
      length <= 0 ||
      style.stroke === 'none' ||
      Number(style.strokeOpacity) <= 0 ||
      Number.parseFloat(style.strokeWidth) <= 0
    )
      throw new Error(`${id}: requires visible nonempty path paint`);
    const count = Math.max(
      2,
      Math.ceil(length * Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d)),
    );
    const points = Array.from({ length: count + 1 }, (_, index) => {
      const point = path.getPointAtLength((length * index) / count).matrixTransform(matrix);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new Error(`${id}: nonfinite paint`);
      return { x: point.x, y: point.y };
    });
    const from = uniqueNode(source);
    const to = uniqueNode(target);
    const start = points[0];
    const end = points.at(-1)!;
    const frame = path.ownerSVGElement!.getBoundingClientRect();
    return {
      id,
      source,
      target,
      points,
      sourceGap: boundaryDistance(start, from),
      targetGap: boundaryDistance(end, to),
      sourceBounds: from.bounds.toJSON(),
      targetBounds: to.bounds.toJSON(),
      nodeCrossings: nodes
        .filter(
          (node) =>
            node !== from && node !== to && points.some((point) => inside(point, node.bounds)),
        )
        .map((node) => node.name),
      contained: points.every(
        (point) =>
          point.x >= frame.left - 1 &&
          point.x <= frame.right + 1 &&
          point.y >= frame.top - 1 &&
          point.y <= frame.bottom + 1,
      ),
      moves: (path.getAttribute('d')!.match(/M/gi) ?? []).length,
    };
  });
}

function expectPaintedRoutes(
  routes: ReturnType<typeof paintedRouteGeometry>,
  expected: Connection[],
) {
  expect(routes.map(({ id, source, target }) => ({ id, source, target }))).toEqual(expected);
  for (const route of routes) {
    expect(route.sourceGap, `${route.id} source attachment`).toBeLessThanOrEqual(1);
    expect(route.targetGap, `${route.id} target attachment`).toBeLessThanOrEqual(7);
    expect(route.contained, `${route.id} SVG containment`).toBe(true);
    expect(route.nodeCrossings, `${route.id} unrelated node crossings`).toEqual([]);
    expect(route.moves, `${route.id} continuous shaft`).toBe(1);
  }
}

function routeSeparation(left: { x: number; y: number }[], right: { x: number; y: number }[]) {
  expect(left.length, 'first sampled corridor').toBeGreaterThan(1);
  expect(right.length, 'second sampled corridor').toBeGreaterThan(1);
  let distance = Infinity;
  for (const a of left)
    for (const b of right) distance = Math.min(distance, Math.hypot(a.x - b.x, a.y - b.y));
  return distance;
}

// Read narrow walkthrough paint in screen coordinates to detect hidden routes,
// detached endpoints, clipped labels and node collisions.
function narrowWalkthroughGeometry(
  root: Element,
  connections: { id: string; source: string; target: string }[],
) {
  const viewport = root.querySelector('.diagram-scroll-container')!.getBoundingClientRect();
  const nodes = [...root.querySelectorAll('[data-node-id]')].map((node) => ({
    id: node.getAttribute('data-node-id'),
    element: node,
    bounds: node.getBoundingClientRect(),
  }));
  const visible = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility !== 'visible' ||
        Number(style.opacity) < 0.01
      )
        return false;
    }
    return true;
  };
  const rectDistance = (point: { x: number; y: number }, box: DOMRect) =>
    Math.hypot(
      Math.max(box.left - point.x, point.x - box.right, 0),
      Math.max(box.top - point.y, point.y - box.bottom, 0),
    );
  const inside = (point: { x: number; y: number }, box: DOMRect) =>
    point.x > box.left + 1 &&
    point.x < box.right - 1 &&
    point.y > box.top + 1 &&
    point.y < box.bottom - 1;
  const contains = (box: DOMRect) =>
    box.left >= viewport.left - 1 &&
    box.right <= viewport.right + 1 &&
    box.top >= viewport.top - 1 &&
    box.bottom <= viewport.bottom + 1;
  const overlap = (a: DOMRect, b: DOMRect) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  type Point = { x: number; y: number };
  const crosses = (a: Point, b: Point, c: Point, d: Point) => {
    const cross = (p: Point, q: Point, r: Point) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return (
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
        Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
        Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) &&
      cross(a, b, c) * cross(a, b, d) <= 0 &&
      cross(c, d, a) * cross(c, d, b) <= 0
    );
  };
  const routes = connections.map(({ id, source, target }) => {
    const path = root.querySelector<SVGPathElement>(
      `.diagram-edge[data-edge-id="${id}"] .edge-path`,
    )!;
    const label = root.querySelector<SVGGraphicsElement>(
      `.edge-label-container[data-edge-id="${id}"]`,
    )!;
    const matrix = path.getScreenCTM()!;
    const length = path.getTotalLength() * Math.hypot(matrix.a, matrix.b);
    if (length === 0) throw new Error(`${id} visible nonempty paint: empty path`);
    const count = Math.max(1, Math.ceil(length));
    const points = Array.from({ length: count + 1 }, (_, index) => {
      const point = path
        .getPointAtLength((path.getTotalLength() * index) / count)
        .matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    const start = points[0];
    const end = points.at(-1)!;
    const sourceBox = nodes.find((node) => node.id === source)!.bounds;
    const targetBox = nodes.find((node) => node.id === target)!.bounds;
    const labelBox = label.getBoundingClientRect();
    const selfCrossing = points
      .slice(1)
      .some((end, index) =>
        points
          .slice(index + 3, -1)
          .some((otherStart, offset) =>
            crosses(points[index], end, otherStart, points[index + 4 + offset]),
          ),
      );
    const boundaryGap = (point: { x: number; y: number }, box: DOMRect) =>
      Math.min(
        Math.abs(point.x - box.left),
        Math.abs(point.x - box.right),
        Math.abs(point.y - box.top),
        Math.abs(point.y - box.bottom),
      );
    return {
      id,
      selfCrossing,
      sourceGap: inside(start, sourceBox)
        ? Infinity
        : rectDistance(start, sourceBox) + boundaryGap(start, sourceBox),
      targetGap: inside(end, targetBox) ? Infinity : rectDistance(end, targetBox),
      moves: (path.getAttribute('d')?.match(/M/g) ?? []).length,
      marker: path.getAttribute('marker-end'),
      painted:
        visible(path) &&
        visible(label) &&
        length > 0 &&
        labelBox.width > 0 &&
        labelBox.height > 0 &&
        Boolean(label.textContent?.trim()),
      finite: points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      contained: contains(path.getBoundingClientRect()) && contains(labelBox),
      nodeCrossings: nodes
        .filter((node) => points.some((point) => inside(point, node.bounds)))
        .map((node) => node.id),
      labelNodeOverlaps: nodes
        .filter((node) => overlap(labelBox, node.bounds))
        .map((node) => node.id),
      labelRouteGap: Math.min(...points.map((point) => rectDistance(point, labelBox))),
    };
  });
  return {
    routes,
    nodesContained:
      nodes.length > 0 &&
      nodes.every(
        (node) =>
          visible(node.element) &&
          node.bounds.width > 0 &&
          node.bounds.height > 0 &&
          contains(node.bounds),
      ),
  };
}

function expectNarrowWalkthrough(geometry: ReturnType<typeof narrowWalkthroughGeometry>) {
  expect(geometry.nodesContained).toBe(true);
  for (const route of geometry.routes) {
    expect(route.painted, `${route.id} visible nonempty paint`).toBe(true);
    expect(route.finite).toBe(true);
    expect(route.contained).toBe(true);
    expect(route.sourceGap, `${route.id} source boundary`).toBeLessThanOrEqual(1);
    expect(route.targetGap, `${route.id} target arrow gap`).toBeLessThanOrEqual(7);
    expect(route.marker).toContain('arrowhead');
    expect(route.moves).toBe(1);
    expect(route.selfCrossing).toBe(false);
    expect(route.nodeCrossings).toEqual([]);
    expect(route.labelNodeOverlaps).toEqual([]);
    expect(route.labelRouteGap).toBeLessThanOrEqual(1);
  }
}

for (const mutation of ['detached', 'empty', 'hidden'] as const) {
  test(`narrow walkthrough oracle rejects ${mutation} painted routes`, async ({ page }) => {
    await openState(page, 'custom-walkthrough', 420, 'light');
    const root = page.locator('#custom-walkthrough');
    const connections = [
      { id: 'w2', source: 'redux', target: 'chat' },
      { id: 'w3', source: 'chat', target: 'redux' },
    ];
    expectNarrowWalkthrough(await root.evaluate(narrowWalkthroughGeometry, connections));
    const original = await root.evaluate((root, mutation) => {
      const path = root.querySelector<SVGPathElement>(
        '.diagram-edge[data-edge-id="w2"] .edge-path',
      )!;
      const original = {
        id: path.closest('[data-edge-id]')!.getAttribute('data-edge-id')!,
        d: path.getAttribute('d')!,
        transform: path.getAttribute('transform'),
        style: path.getAttribute('style'),
      };
      if (mutation === 'detached') path.setAttribute('transform', 'translate(0 -20)');
      else if (mutation === 'empty') path.setAttribute('d', '');
      else path.style.visibility = 'hidden';
      return original;
    }, mutation);
    try {
      const reason = mutation === 'detached' ? /source boundary/ : /visible nonempty paint/;
      await expect(async () => {
        expectNarrowWalkthrough(await root.evaluate(narrowWalkthroughGeometry, connections));
      }).rejects.toThrow(reason);
    } finally {
      await root.evaluate((root, original) => {
        const path = root.querySelector(`.diagram-edge[data-edge-id="${original.id}"] .edge-path`)!;
        for (const name of ['d', 'transform', 'style'] as const) {
          const value = original[name];
          if (value === null) path.removeAttribute(name);
          else path.setAttribute(name, value);
        }
      }, original);
    }
    expectNarrowWalkthrough(await root.evaluate(narrowWalkthroughGeometry, connections));
  });
}

async function expectClientRequestLane(page: Page, identity: string) {
  const connections = [
    { id: 'L_Client_Gateway_0', source: 'Client', target: 'Gateway' },
    { id: 'L_Gateway_Queue_0', source: 'Gateway', target: 'Queue' },
    { id: 'L_Store_Client_0', source: 'Store', target: 'Client' },
  ];
  const routes = await page
    .locator('#mermaid-nested-groups')
    .evaluate(paintedRouteGeometry, connections);
  expectPaintedRoutes(routes, connections);
  expect(
    routeSeparation(routes[0].points, routes[1].points),
    `${identity} separate request/enqueue paint`,
  ).toBeGreaterThan(1);
  const result = await page
    .locator('#mermaid-nested-groups svg[data-layout-settled="true"]')
    .evaluate((svg) => {
      const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
      const node = (name: string) => nodes.find((item) => item.textContent?.trim() === name)!;
      const path = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find((item) =>
        item.id.includes('L_Client_Gateway'),
      )!;
      const label = [...svg.querySelectorAll<SVGGElement>('g.edgeLabel')].find(
        (item) => item.textContent?.trim() === 'request',
      )!;
      const client = node('Client').getBoundingClientRect();
      const labelBounds = label.getBoundingClientRect();
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      const routeSamples = Array.from({ length: 201 }, (_, index) =>
        path.getPointAtLength((length * index) / 200).matrixTransform(matrix),
      );
      const otherLabels = [...svg.querySelectorAll<SVGGElement>('g.edgeLabel')].filter(
        (item) => item !== label,
      );
      return {
        overlapsClient:
          labelBounds.left < client.right &&
          labelBounds.right > client.left &&
          labelBounds.top < client.bottom &&
          labelBounds.bottom > client.top,
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
      };
    });
  expect(result.overlapsClient, `${identity} Client label collision`).toBe(false);
  expect(result.routeOwnsLabel, `${identity} request label ownership`).toBe(true);
  expect(result.overlapsOtherText, `${identity} request text collision`).toBe(false);
}

async function expectCustomGeometry(page: Page, state: string) {
  const fixture = DIAGRAM_WORKBENCH_CASES[state as keyof typeof DIAGRAM_WORKBENCH_CASES];
  if (fixture.kind !== 'custom') throw new Error(`${state}: expected custom fixture`);
  const current = fixture.diagram.states?.find(
    (entry) => entry.id === fixture.diagram.currentStateId,
  );
  const expectedNodes = current?.visibleNodes ?? fixture.diagram.model.nodes.map(({ id }) => id);
  expect(expectedNodes.length, `${state} nonempty custom fixture`).toBeGreaterThan(0);
  const expectedEdges =
    current?.visibleEdges ??
    fixture.diagram.model.edges
      .filter(({ from, to }) => expectedNodes.includes(from) && expectedNodes.includes(to))
      .map(({ id }) => id);
  const root = page.locator(`#${state}`);
  expect(
    await root
      .locator('[data-node-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')).sort()),
    `${state} authored visible nodes`,
  ).toEqual([...expectedNodes].sort());
  expect(
    await root
      .locator('.diagram-edge')
      .evaluateAll((edges) => edges.map((edge) => edge.getAttribute('data-edge-id')).sort()),
    `${state} authored visible edges`,
  ).toEqual([...expectedEdges].sort());
  for (const id of expectedNodes) {
    await expect(root.locator(`[data-node-id="${id}"]`)).toBeVisible();
    await expect(root.locator(`[data-node-id="${id}"] .node-label`)).toHaveText(
      fixture.diagram.model.nodes.find((node) => node.id === id)!.label,
      { useInnerText: true },
    );
  }
  for (const id of expectedEdges) {
    const path = root.locator(`.diagram-edge[data-edge-id="${id}"] .edge-path`);
    expect(
      await path.evaluate((element: SVGPathElement) => {
        for (let current: Element | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (
            style.display === 'none' ||
            style.visibility !== 'visible' ||
            Number(style.opacity) <= 0
          )
            return false;
        }
        const style = getComputedStyle(element);
        return (
          Boolean(element.getScreenCTM()) &&
          element.getTotalLength() > 0 &&
          Number.isFinite(element.getTotalLength()) &&
          style.stroke !== 'none' &&
          Number(style.strokeOpacity) > 0
        );
      }),
      `${id} visible nonempty shaft`,
    ).toBe(true);
  }
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

async function expectMermaidContent(page: Page, state: string) {
  const fixture = DIAGRAM_WORKBENCH_CASES[state as keyof typeof DIAGRAM_WORKBENCH_CASES];
  if (fixture.kind !== 'mermaid' || !fixture.source.trim() || state === 'mermaid-invalid-source')
    throw new Error(`${state}: expected valid Mermaid source`);
  const svg = page.locator(`#${state} .mermaid-svg > svg`);
  await expect(svg).toBeVisible();
  const compact = (value: string) => value.replace(/<br\s*\/?\s*>/gi, '').replace(/\s+/g, '');
  const text = compact(
    await svg.evaluate((element) =>
      [...element.querySelectorAll<SVGGraphicsElement>('text, foreignObject')]
        .filter((label) => {
          const bounds = label.getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0) return false;
          for (let current: Element | null = label; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (
              style.display === 'none' ||
              style.visibility !== 'visible' ||
              Number(style.opacity) <= 0
            )
              return false;
          }
          return true;
        })
        .map((label) => label.textContent ?? '')
        .join(' '),
    ),
  );
  const family = fixture.source.trim().split(/\s/)[0];
  let labels: string[];
  if (family === 'flowchart') {
    // Read authored labels, independently of Mermaid's parser/rendering helpers.
    labels = [
      ...fixture.source.matchAll(/\b\w+\s*(?:\[\[?|\(\(?|\{\{?)(?:"([^"]+)"|([^\]\)}\n]+))/g),
    ].map((match) => (match[1] ?? match[2]).replace(/^[\[(/]+|[\]/)]+$/g, ''));
  } else if (family === 'sequenceDiagram') {
    labels = [
      ...fixture.source.matchAll(/^\s*(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/gm),
    ].map((match) => match[2] ?? match[1]);
    labels.push(
      ...[...fixture.source.matchAll(/(?:->>|-->>)[^:\n]+:\s*(.+)$/gm)].map((match) => match[1]),
    );
  } else if (family === 'stateDiagram-v2') {
    const special = new Set(
      [...fixture.source.matchAll(/state\s+(\w+)\s+<<[^>]+>>/g)].map((match) => match[1]),
    );
    labels = [...fixture.source.matchAll(/(\w+|\[\*\])\s*-->\s*(\w+|\[\*\])/g)]
      .flatMap((match) => [match[1], match[2]])
      .filter((label) => label !== '[*]' && !special.has(label));
  } else if (family === 'classDiagram') {
    labels = [...fixture.source.matchAll(/^\s*class\s+(\w+)/gm)].map((match) => match[1]);
  } else if (family === 'erDiagram') {
    labels = [...fixture.source.matchAll(/^\s*(\w+)\s+(?:\{|[|}])/gm)].map((match) => match[1]);
  } else throw new Error(`${state}: add an authored content contract for ${family}`);
  expect(labels.length, `${state} authored semantic content`).toBeGreaterThan(0);
  for (const label of new Set(labels))
    expect(text, `${state} rendered ${label}`).toContain(compact(label));
  await expect(page.locator(`#${state} .mermaid-error`)).toHaveCount(0);
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
        };
      })
      .filter((label): label is NonNullable<typeof label> => label !== null);
    return {
      texts: labels.map(({ text }) => text),
      clipped: labels.filter(
        ({ labelContained, contentContained, contentOverflow }) =>
          !labelContained || !contentContained || contentOverflow,
      ),
    };
  });
  expect(result.texts, `${state} edge-label text`).toEqual(expectedLabels);
  expect(result.clipped, `${state} clipped edge labels`).toEqual([]);
}

async function expectStateLabelPaint(page: Page) {
  await page.setViewportSize({ width: 1400, height: 1400 });
  const state = page.locator('#mermaid-state');
  await state.scrollIntoViewIfNeeded();
  const result = await state.evaluate((root) => {
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
      if (
        !matrix ||
        !Number.isFinite(length) ||
        length <= 0 ||
        getComputedStyle(path).stroke === 'none'
      ) {
        failures.push(`${name}: missing painted route`);
        continue;
      }
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

      if (Number(style.opacity) <= 0 || Number(style.fillOpacity) <= 0 || style.fill === 'none') {
        failures.push(`${name}: missing painted text surface`);
      }
      if (horizontalClearance < 0 || verticalClearance < 0) {
        failures.push(`${name}: incomplete text clearance`);
      }
      if (crossing) paintedOverlapCount += 1;
      if (crossing && (backgroundLayer < 0 || routeLayer <= backgroundLayer)) {
        failures.push(`${name}: route is not painted below the label surface`);
      }
    }

    return {
      labels: labels.map((label) => label.textContent!.trim()).sort(),
      paintedOverlapCount,
      failures,
    };
  });

  expect(result.labels).toEqual(
    [
      'User sends message',
      'Agent responds',
      'Tool starts',
      'Tool completes',
      'Agent asks user',
      'User replies',
      'Agent finishes',
      'Request fails',
      'Stream fails',
      'User retries',
    ].sort(),
  );
  expect(result.paintedOverlapCount).toBeGreaterThan(0);
  expect(result.failures).toEqual([]);
}

async function expectTerminalArrowGeometry(
  page: Page,
  state: string,
  expectedTargets: Record<string, string>,
  discoveryTimeout = 30_000,
) {
  const root = page.locator(`#${state}`);
  const mermaid = state.startsWith('mermaid-');
  const pathSelector = mermaid
    ? '.edgePaths path[marker-end], .edges.edgePath path[marker-end]'
    : '.diagram-edge path[marker-end]';
  await expect(root.locator(pathSelector)).toHaveCount(Object.keys(expectedTargets).length, {
    timeout: discoveryTimeout,
  });
  const result = await root.evaluate(
    (section, args) => {
      const isMermaid = args.state.startsWith('mermaid-');
      const paths = [
        ...section.querySelectorAll<SVGPathElement>(
          isMermaid
            ? '.edgePaths path[marker-end], .edges.edgePath path[marker-end]'
            : '.diagram-edge path[marker-end]',
        ),
      ];
      const nodes = isMermaid
        ? [...section.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
            const shape = node.querySelector<SVGGraphicsElement>(
              ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse, :scope > .outer-path, :scope > .basic.label-container, :scope > polygon',
            );
            return shape ? [{ id: node.id, label: node.textContent?.trim() ?? '', shape }] : [];
          })
        : [...section.querySelectorAll<HTMLElement>('.diagram-node-html')].map((node) => ({
            id: node.parentElement?.id ?? '',
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
      const shapeDistance = (point: DOMPoint, shape: SVGGraphicsElement) => {
        if (shape instanceof SVGGeometryElement && !(shape instanceof SVGRectElement)) {
          const matrix = shape.getScreenCTM();
          const length = shape.getTotalLength();
          if (!matrix || !Number.isFinite(length) || length <= 0) return Infinity;
          const count = Math.max(
            4,
            Math.ceil(length * Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d) * 4),
          );
          let minimum = Infinity;
          for (let index = 0; index <= count; index++) {
            const sample = shape.getPointAtLength((length * index) / count).matrixTransform(matrix);
            minimum = Math.min(minimum, Math.hypot(point.x - sample.x, point.y - sample.y));
          }
          return shape.isPointInFill(
            new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse()),
          )
            ? -minimum
            : minimum;
        }
        return signedBoundaryDistance(point, shape.getBoundingClientRect());
      };
      const visible = (element: Element) => {
        for (let current: Element | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (
            style.display === 'none' ||
            style.visibility !== 'visible' ||
            Number(style.opacity) <= 0
          )
            return false;
        }
        return true;
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
        const nonempty = Boolean(path.getAttribute('d')?.trim()) && length > 0;
        const terminal = nonempty ? path.getPointAtLength(length) : new DOMPoint();
        const tangent = nonempty
          ? path.getPointAtLength(Math.max(0, length - 0.25))
          : new DOMPoint();
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
        const terminalTarget = path.dataset.terminalTarget;
        const target = terminalTarget
          ? nodes.find((node) => node.id === terminalTarget)
          : nodes.find((node) => node.label === expectedTarget);
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
            id: node.id,
            label: node.label,
            distance: Math.abs(shapeDistance(tip, node.shape)),
          }))
          .sort((left, right) => left.distance - right.distance)[0];
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
        return {
          key,
          pathId: path.id,
          terminalTarget,
          expectedTarget,
          targetId: target?.id,
          targetLabel: target?.label,
          closestTargetId: closestTarget?.id,
          painted:
            visible(path) &&
            pathStyle.stroke !== 'none' &&
            Number(pathStyle.strokeOpacity) > 0 &&
            Number.parseFloat(pathStyle.strokeWidth) > 0 &&
            markerLength > 0 &&
            Boolean(markerStyle && (markerStyle.fill !== 'none' || markerStyle.stroke !== 'none')),
          inwardDot,
          markerJoinDistance,
          tipToTerminal: Math.hypot(tip.x - terminalScreen.x, tip.y - terminalScreen.y),
          markerContained: markerPoints.every(
            (point) =>
              point.x >= frame.left - 1 &&
              point.x <= frame.right + 1 &&
              point.y >= frame.top - 1 &&
              point.y <= frame.bottom + 1,
          ),
          connected: path.isConnected && section.contains(path),
          nonempty,
          measurable: Boolean(pathMatrix),
        };
      });
    },
    { state, expectedTargets },
  );

  expect(result).toHaveLength(Object.keys(expectedTargets).length);
  for (const edge of result) {
    expect(edge.connected, `${state}/${edge.key} connected rendered path`).toBe(true);
    expect(edge.nonempty, `${state}/${edge.key} nonempty rendered path`).toBe(true);
    expect(edge.measurable, `${state}/${edge.key} measurable rendered path`).toBe(true);
    expect(edge.painted, `${state}/${edge.key} visible path and marker paint`).toBe(true);
    expect(edge.targetLabel, `${state}/${edge.key} target label`).toBe(edge.expectedTarget);
    expect(
      edge.closestTargetId,
      `${state}/${edge.key} target (${edge.pathId}, terminal ${edge.terminalTarget ?? 'unset'})`,
    ).toBe(edge.targetId);
    expect(edge.inwardDot, `${state}/${edge.key} inward tangent`).toBeGreaterThan(0);
    expect(edge.markerJoinDistance, `${state}/${edge.key} shaft continuity`).toBeLessThanOrEqual(
      0.1,
    );
    expect(edge.tipToTerminal, `${state}/${edge.key} terminal marker`).toBeLessThanOrEqual(0.1);
    expect(edge.markerContained, `${state}/${edge.key} marker containment`).toBe(true);
  }
}

async function expectStateObstacleGeometry(page: Page, context: string) {
  await expectMermaidContent(page, 'mermaid-state');
  await expectTerminalArrowGeometry(page, 'mermaid-state', mermaidTargets);
  const geometry = await page
    .locator('#mermaid-state svg[data-layout-settled=true]')
    .evaluate((svg) => {
      const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
        const shape = node.querySelector<SVGGraphicsElement>(
          ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse',
        );
        return shape ? [{ node, shape, bounds: shape.getBoundingClientRect() }] : [];
      });
      const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path[marker-end]')];
      const screenPoint = (path: SVGPathElement, ratio: number) => {
        const point = path.getPointAtLength(path.getTotalLength() * ratio);
        return point.matrixTransform(path.getScreenCTM()!);
      };
      const rectDistance = (point: DOMPoint, bounds: DOMRect) =>
        Math.hypot(
          Math.max(bounds.left - point.x, 0, point.x - bounds.right),
          Math.max(bounds.top - point.y, 0, point.y - bounds.bottom),
        );
      const crossings = paths.flatMap((path) => {
        const start = screenPoint(path, 0);
        const end = screenPoint(path, 1);
        const source = nodes.toSorted(
          (left, right) => rectDistance(start, left.bounds) - rectDistance(start, right.bounds),
        )[0]?.node;
        const target = nodes.toSorted(
          (left, right) => rectDistance(end, left.bounds) - rectDistance(end, right.bounds),
        )[0]?.node;
        return nodes.flatMap(({ node, bounds }) => {
          if (node === source || node === target) return [];
          const crosses = Array.from({ length: 199 }, (_, index) =>
            screenPoint(path, (index + 1) / 200),
          ).some(
            (point) =>
              point.x > bounds.left + 0.5 &&
              point.x < bounds.right - 0.5 &&
              point.y > bounds.top + 0.5 &&
              point.y < bounds.bottom - 0.5,
          );
          return crosses ? [`${path.id}/${node.textContent?.trim()}`] : [];
        });
      });
      return { crossings };
    });
  expect(geometry.crossings, `${context} unrelated node crossings`).toEqual([]);
}

async function expectStateFailureTerminal(page: Page, context: string) {
  const geometry = await page
    .locator('#mermaid-state-recovery svg[data-layout-settled=true]')
    .evaluate((svg) => {
      const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
      const failLabels = labels.filter(
        (label) => label.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() === 'fail',
      );
      const failLabel = failLabels[0];
      const paths = [
        ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, .edges.edgePath path'),
      ];
      const routePathId = failLabel?.dataset.routePathId ?? '';
      const pathMatches = routePathId
        ? paths.filter((candidate) => candidate.id === routePathId)
        : [];
      const path = pathMatches.length === 1 ? pathMatches[0] : null;
      const pathLength = path?.getTotalLength() ?? 0;
      const pathMatrix = path?.getScreenCTM() ?? null;
      const screenPoint = (candidate: SVGPathElement, ratio: number) => {
        const length = candidate.getTotalLength();
        const point = candidate.getPointAtLength(length * ratio);
        return point.matrixTransform(candidate.getScreenCTM()!);
      };
      const labelBounds = failLabel?.getBoundingClientRect();
      const labelPathIds = labelBounds
        ? paths.flatMap((candidate) => {
            const length = candidate.getTotalLength();
            if (!length || !candidate.getScreenCTM()) return [];
            const intersects = Array.from({ length: 401 }, (_, index) =>
              screenPoint(candidate, index / 400),
            ).some(
              (point) =>
                point.x >= labelBounds.left - 0.5 &&
                point.x <= labelBounds.right + 0.5 &&
                point.y >= labelBounds.top - 0.5 &&
                point.y <= labelBounds.bottom + 0.5,
            );
            return intersects ? [candidate.id] : [];
          })
        : [];
      const shapes = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
        const shape = node.querySelector<SVGGraphicsElement>(
          ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse, :scope > .outer-path, :scope > .basic.label-container, :scope > polygon',
        );
        return shape
          ? [
              {
                id: node.id,
                label: node.textContent?.trim() ?? '',
                bounds: shape.getBoundingClientRect(),
              },
            ]
          : [];
      });
      const distanceToBounds = (point: { x: number; y: number }, bounds: DOMRect) =>
        Math.hypot(
          Math.max(bounds.left - point.x, 0, point.x - bounds.right),
          Math.max(bounds.top - point.y, 0, point.y - bounds.bottom),
        );
      const start = path && pathLength && pathMatrix ? screenPoint(path, 0) : undefined;
      const end = path && pathLength && pathMatrix ? screenPoint(path, 1) : undefined;
      const endpointLabel = (point: { x: number; y: number } | undefined) =>
        point
          ? shapes.toSorted(
              (left, right) =>
                distanceToBounds(point, left.bounds) - distanceToBounds(point, right.bounds),
            )[0]?.label
          : null;
      return {
        labelCount: labels.length,
        failLabelCount: failLabels.length,
        pathCount: paths.length,
        routePathId,
        pathMatches: pathMatches.length,
        connected: path?.isConnected ?? false,
        nonempty: Boolean(path?.getAttribute('d')?.trim()) && pathLength > 0,
        marker: path?.getAttribute('marker-end'),
        moveCommands: (path?.getAttribute('d')?.match(/M/g) ?? []).length,
        nativeLabelId: failLabel
          ?.querySelector<SVGGraphicsElement>(':scope > .label[data-id]')
          ?.getAttribute('data-id'),
        nativePathId: path?.dataset.id,
        routeLabel: path?.dataset.routeLabel,
        routeLabels: paths.flatMap((candidate) =>
          candidate.dataset.routeLabel ? [candidate.dataset.routeLabel] : [],
        ),
        associatedLabels: labels.flatMap((label) =>
          label.dataset.routePathId ? [label.textContent?.trim() ?? ''] : [],
        ),
        labelPathIds,
        sourceLabel: endpointLabel(start),
        targetLabel: endpointLabel(end),
      };
    });
  expect(geometry.labelCount, `${context} authored labeled routes`).toBe(4);
  expect(geometry.failLabelCount, `${context} unique fail label`).toBe(1);
  expect(geometry.pathCount, `${context} labeled and unlabeled routes`).toBe(6);
  expect(geometry.routePathId, `${context} fail route association`).toBeTruthy();
  expect(geometry.pathMatches, `${context} unique fail route association`).toBe(1);
  expect(geometry.connected, `${context} connected fail route`).toBe(true);
  expect(geometry.nonempty, `${context} nonempty fail route`).toBe(true);
  expect(geometry.marker, `${context} fail marker`).toContain('barbEnd');
  expect(geometry.moveCommands, `${context} continuous fail route`).toBe(1);
  expect(geometry.nativePathId, `${context} native fail edge identity`).toBe(
    geometry.nativeLabelId,
  );
  expect(geometry.routeLabel, `${context} fail route metadata`).toBe('fail');
  expect(geometry.routeLabels, `${context} unrelated route metadata`).toEqual(['fail']);
  expect(geometry.associatedLabels, `${context} unrelated label associations`).toEqual(['fail']);
  expect(geometry.labelPathIds, `${context} painted fail label association`).toEqual([
    geometry.routePathId,
  ]);
  expect(geometry.sourceLabel, `${context} fail source ownership`).toBe('Running');
  expect(geometry.targetLabel, `${context} fail target ownership`).toBe('Failed');
}

async function expectEntityDividerGeometry(page: Page, state: string, context: string) {
  const expectedRows = state.includes('minimal')
    ? { WORKSPACE: ['stringidPK'] }
    : { PREVIEW: ['stringidPK', 'stringtitle'], STATE: ['stringnamePK', 'stringthemeFK'] };
  for (const [entity, rows] of Object.entries(expectedRows)) {
    const contents = await page
      .locator(`#${state} g.node`)
      .evaluateAll(
        (nodes, entity) =>
          nodes
            .filter((item) => item.id.includes(entity))
            .map((item) => item.textContent?.replace(/\s+/g, '') ?? ''),
        entity,
      );
    expect(contents, `${context} entity ${entity}`).toHaveLength(1);
    for (const row of rows) expect(contents[0], `${context}/${entity} authored row`).toContain(row);
  }
  const geometry = await page.locator(`#${state} svg[data-layout-settled=true]`).evaluate((svg) => {
    const entities = [...svg.querySelectorAll<SVGGElement>('g.node')].flatMap((node) => {
      const rows = [
        ...node.querySelectorAll<SVGGraphicsElement>(
          ':scope > .row-rect-odd, :scope > .row-rect-even',
        ),
      ];
      if (!rows.length) return [];
      const dividers = [
        ...node.querySelectorAll<SVGLineElement>(':scope > .er-negative-space-divider'),
      ];
      const textBounds = [...node.querySelectorAll<SVGGraphicsElement>('text, foreignObject')].map(
        (text) => text.getBoundingClientRect(),
      );
      const crossings = dividers.flatMap((divider) => {
        const matrix = divider.getScreenCTM()!;
        const start = new DOMPoint(
          Number(divider.getAttribute('x1')),
          Number(divider.getAttribute('y1')),
        ).matrixTransform(matrix);
        const end = new DOMPoint(
          Number(divider.getAttribute('x2')),
          Number(divider.getAttribute('y2')),
        ).matrixTransform(matrix);
        return textBounds.filter((bounds) =>
          divider.dataset.dividerKind === 'row'
            ? start.y > bounds.top + 1 &&
              start.y < bounds.bottom - 1 &&
              Math.max(start.x, end.x) > bounds.left &&
              Math.min(start.x, end.x) < bounds.right
            : start.x > bounds.left + 1 &&
              start.x < bounds.right - 1 &&
              Math.max(start.y, end.y) > bounds.top &&
              Math.min(start.y, end.y) < bounds.bottom,
        );
      });
      return [
        {
          crossings: crossings.length,
        },
      ];
    });
    return {
      entities,
      keys: [...svg.querySelectorAll<SVGGraphicsElement>('.label.attribute-keys')]
        .map((label) => label.textContent?.trim())
        .filter(Boolean),
    };
  });
  expect(geometry.entities.length, `${context} populated entities`).toBe(
    state.includes('minimal') ? 1 : 2,
  );
  expect(geometry.entities.every(({ crossings }) => crossings === 0)).toBe(true);
  expect(geometry.keys).toContain('PK');
  if (!state.includes('minimal')) expect(geometry.keys).toContain('FK');
}

async function expectServiceBoundaryRouting(page: Page) {
  await expectCustomGeometry(page, 'custom-service-boundaries');
  const connections = [
    { id: 'sb1', source: 'client', target: 'gateway' },
    { id: 'sb2', source: 'gateway', target: 'queue' },
    { id: 'sb3', source: 'queue', target: 'worker' },
    { id: 'sb4', source: 'worker', target: 'registry' },
    { id: 'sb5', source: 'registry', target: 'archive' },
    { id: 'sb6', source: 'metrics', target: 'dashboard' },
  ];
  expectPaintedRoutes(
    await page.locator('#custom-service-boundaries').evaluate(paintedRouteGeometry, connections),
    connections,
  );
}

async function expectNestedReviewGeometry(page: Page, context: string) {
  const connections = [
    { id: 'L_Intake_Validate_0', source: 'Item', target: 'Ready?' },
    { id: 'L_Intake_Validate_2', source: 'Item', target: 'Ready?' },
    { id: 'L_Validate_Enrich_0', source: 'Ready?', target: 'Context' },
    { id: 'L_Enrich_Validate_0', source: 'Context', target: 'Ready?' },
    { id: 'L_Validate_Merge_0', source: 'Ready?', target: 'Decision' },
    { id: 'L_Validate_Merge_2', source: 'Ready?', target: 'Decision' },
    { id: 'L_Enrich_Merge_0', source: 'Context', target: 'Decision' },
    { id: 'L_Merge_Registry_0', source: 'Decision', target: 'Log' },
    { id: 'L_Merge_Merge_0', source: 'Decision', target: 'Decision' },
  ];
  const painted = await page
    .locator('#mermaid-nested-routing')
    .evaluate(paintedRouteGeometry, connections);
  expectPaintedRoutes(painted, connections);
  for (const [left, right] of [
    [0, 1],
    [2, 3],
    [4, 5],
  ]) {
    expect(
      routeSeparation(painted[left].points.slice(8, -8), painted[right].points.slice(8, -8)),
      `${context} distinct painted corridors ${left}/${right}`,
    ).toBeGreaterThan(1);
  }
  const geometry = await page
    .locator('#mermaid-nested-routing svg[data-layout-settled=true]')
    .evaluate((svg) => {
      const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
        text: node.textContent?.trim() ?? '',
        bounds: node.getBoundingClientRect(),
      }));
      const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path[marker-end]')];
      const route = (source: string, target: string) =>
        paths.filter((path) => new RegExp(`-L_${source}_${target}_[0-9]+$`).test(path.id));
      const screenPoint = (path: SVGPathElement, ratio: number) => {
        const point = path.getPointAtLength(path.getTotalLength() * ratio);
        return point.matrixTransform(path.getScreenCTM()!);
      };
      const rectDistance = (point: DOMPoint, bounds: DOMRect) =>
        Math.hypot(
          Math.max(bounds.left - point.x, 0, point.x - bounds.right),
          Math.max(bounds.top - point.y, 0, point.y - bounds.bottom),
        );
      const crossings = paths.flatMap((path) => {
        const source = nodes.toSorted(
          (left, right) =>
            rectDistance(screenPoint(path, 0), left.bounds) -
            rectDistance(screenPoint(path, 0), right.bounds),
        )[0];
        const target = nodes.toSorted(
          (left, right) =>
            rectDistance(screenPoint(path, 1), left.bounds) -
            rectDistance(screenPoint(path, 1), right.bounds),
        )[0];
        return nodes.flatMap((node) => {
          if (node === source || node === target) return [];
          const crosses = Array.from({ length: 199 }, (_, index) =>
            screenPoint(path, (index + 1) / 200),
          ).some(
            (point) =>
              point.x > node.bounds.left + 0.5 &&
              point.x < node.bounds.right - 0.5 &&
              point.y > node.bounds.top + 0.5 &&
              point.y < node.bounds.bottom - 0.5,
          );
          return crosses ? [`${path.id}/${node.text}`] : [];
        });
      });
      const intake = route('Intake', 'Validate');
      const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
        .filter((label) => label.textContent?.trim())
        .map((label) => label.getBoundingClientRect());
      const labelNodeOverlaps = labels.filter((label) =>
        nodes.some(
          ({ bounds }) =>
            label.left < bounds.right &&
            label.right > bounds.left &&
            label.top < bounds.bottom &&
            label.bottom > bounds.top,
        ),
      ).length;
      return {
        progression: nodes.map(({ text, bounds }) => ({
          text,
          left: bounds.left,
        })),
        crossings,
        labelNodeOverlaps,
        intakeDashes: new Set(intake.map((path) => getComputedStyle(path).strokeDasharray)).size,
      };
    });
  const axis = new Map(geometry.progression.map(({ text, left }) => [text, left]));
  expect(axis.get('Item'), `${context} Item before Ready`).toBeLessThan(axis.get('Ready?')!);
  expect(axis.get('Ready?'), `${context} Ready before Context`).toBeLessThan(axis.get('Context')!);
  expect(axis.get('Context'), `${context} Context before Decision`).toBeLessThan(
    axis.get('Decision')!,
  );
  expect(axis.get('Decision'), `${context} Decision before Log`).toBeLessThan(axis.get('Log')!);
  expect(geometry.crossings, `${context} unrelated node crossings`).toEqual([]);
  expect(geometry.labelNodeOverlaps, `${context} label/node overlaps`).toBe(0);
  expect(geometry.intakeDashes).toBe(2);
}

async function expectStoreNodeGeometry(
  page: Page,
  state: 'mermaid-nested-groups' | 'custom-data-flow',
  context: string,
) {
  const result = await page.locator(`#${state}`).evaluate((root, renderedState) => {
    if (renderedState === 'custom-data-flow') {
      const body = [...root.querySelectorAll<HTMLElement>('.diagram-node-html')].find((node) =>
        node.textContent?.includes('Capture evidence'),
      )!;
      const content = body.querySelector<HTMLElement>('.node-row')!;
      const bounds = body.getBoundingClientRect();
      const contentBounds = content.getBoundingClientRect();
      const style = getComputedStyle(body);
      const scale = bounds.height / body.offsetHeight;
      const usableTop =
        bounds.top +
        (Number.parseFloat(style.getPropertyValue('--store-cap-top')) +
          Number.parseFloat(style.getPropertyValue('--store-cap-height'))) *
          scale;
      const usableBottom =
        bounds.bottom -
        Number.parseFloat(style.getPropertyValue('--store-bottom-curve-depth')) * scale;
      return {
        topGap: contentBounds.top - usableTop,
        bottomGap: usableBottom - contentBounds.bottom,
        clipped:
          contentBounds.left < bounds.left ||
          contentBounds.right > bounds.right ||
          contentBounds.top < bounds.top ||
          contentBounds.bottom > bounds.bottom,
      };
    }
    const svg = root.querySelector<SVGSVGElement>('svg[data-layout-settled=true]')!;
    const node = [...svg.querySelectorAll<SVGGElement>('g.node')].find(
      (candidate) => candidate.textContent?.trim() === 'Store',
    )!;
    const body = node.querySelector<SVGPathElement>('[data-diagram-cylinder="true"]')!;
    const label = node.querySelector<SVGGElement>(':scope > .label')!;
    const bounds = body.getBoundingClientRect();
    const labelBounds = label.getBoundingClientRect();
    return {
      topGap: labelBounds.top - bounds.top,
      bottomGap: bounds.bottom - labelBounds.bottom,
      clipped:
        labelBounds.left < bounds.left ||
        labelBounds.right > bounds.right ||
        labelBounds.top < bounds.top ||
        labelBounds.bottom > bounds.bottom,
    };
  }, state);
  expect(result.topGap, `${context} top text containment`).toBeGreaterThanOrEqual(0);
  expect(result.bottomGap, `${context} bottom text containment`).toBeGreaterThanOrEqual(0);
  expect(result.clipped, `${context} label containment`).toBe(false);
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
      return {
        name,
        dividerCount: dividers.length,
        crossings,
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
    const paths = [
      ...element.querySelectorAll<SVGPathElement>('.edgePaths path[data-edge="true"]'),
    ];
    const relationships: string[][] = [];
    for (const [edgeIndex, path] of paths.entries()) {
      const matrix = path.getScreenCTM();
      const length = path.getTotalLength();
      if (!matrix || !Number.isFinite(length) || length <= 0 || !path.getAttribute('d')?.trim())
        throw new Error(`Class relation ${edgeIndex} missing path geometry`);
      for (let current: Element | null = path; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === 'none' ||
          style.visibility !== 'visible' ||
          Number(style.opacity) <= 0
        )
          throw new Error(`Class relation ${edgeIndex} hidden`);
      }
      if (getComputedStyle(path).stroke === 'none')
        throw new Error(`Class relation ${edgeIndex} missing paint`);
      relationships.push(
        [0, length]
          .map((distance) => {
            const point = path.getPointAtLength(distance).matrixTransform(matrix);
            const nearest = nodes
              .map((node) => {
                const bounds = node.querySelector('.class-box-outline')!.getBoundingClientRect();
                return {
                  name: node.querySelector('.label-group')!.textContent!.trim(),
                  gap: Math.hypot(
                    Math.max(bounds.left - point.x, point.x - bounds.right, 0),
                    Math.max(bounds.top - point.y, point.y - bounds.bottom, 0),
                  ),
                };
              })
              .sort((a, b) => a.gap - b.gap)[0];
            if (!nearest || nearest.gap > 16)
              throw new Error(`Class relation ${edgeIndex} detached endpoint`);
            return nearest.name;
          })
          .sort(),
      );
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
      relationships,
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
  expect(result.relationships, `${context} authored class relationships`).toEqual([
    ['DiagramPreview', 'PreviewDefinition'],
    ['DiagramFixture', 'DiagramPreview'],
  ]);
  expect(result.outside, `${context} member containment`).toEqual([]);
  expect(result.overlaps, `${context} class overlaps`).toEqual([]);
  expect(result.viewportOverflow, `${context} SVG viewport containment`).toEqual([]);
  expect(result.edgeTextCrossings, `${context} edge/text crossings`).toEqual([]);
  expect(result.compartmentResults, `${context} class compartments`).toEqual([
    {
      name: 'PreviewDefinition',
      dividerCount: 2,
      crossings: [],
    },
    {
      name: 'DiagramPreview',
      dividerCount: 0,
      crossings: [],
    },
    {
      name: 'DiagramFixture',
      dividerCount: 2,
      crossings: [],
    },
  ]);
}

async function expectActionsClearGeometry(
  page: Page,
  actionSelector: string | Locator,
  contentSelector: string,
  context: string,
) {
  const actionLocator =
    typeof actionSelector === 'string' ? page.locator(actionSelector) : actionSelector;
  await actionLocator.locator('..').hover();
  const button = (await actionLocator.evaluate((element) => element.tagName === 'BUTTON'))
    ? actionLocator
    : actionLocator.getByRole('button').first();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click({ trial: true });
  expect(
    await page.locator(contentSelector).count(),
    `${context} rendered content`,
  ).toBeGreaterThan(0);
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

test('discovers and renders the complete catalog without application startup', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1800, height: 1200 });
  const unexpectedConsoleErrors: string[] = [];
  const expectedInvalidErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: string[] = [];
  const webSockets: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Every workbench mounts the invalid-source fixture too. Only its known
    // parser error is expected; unrelated Mermaid/syntax errors must fail.
    if (
      message.text().includes('Failed to render mermaid diagram:') &&
      message.text().includes('Missing close')
    ) {
      expectedInvalidErrors.push(message.text());
    } else {
      unexpectedConsoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('websocket', (socket) => webSockets.push(socket.url()));

  await openState(page, 'mermaid-class', 960, 'light');
  const directTarget = page.locator('#mermaid-class');
  await expect(directTarget).toHaveAttribute('data-targeted', 'true');
  await expect(directTarget.getByRole('heading')).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true');
  await expect(directTarget.locator('.mermaid-svg > svg')).toBeVisible();
  const discovery = await page.evaluate(async () => ({
    list: window.__INTENT_PREVIEW__?.list(),
    states: await window.__INTENT_PREVIEW__?.states('diagram-workbench'),
  }));
  expect(discovery.list).toContain('diagram-workbench');
  expect(discovery.states).toEqual(states);
  expect(discovery.states).toHaveLength(states.length);
  await expect(
    page.locator('.mermaid-error'),
    'only the authored invalid source may fail',
  ).toHaveCount(1);
  await expect(page.locator('#mermaid-invalid-source .mermaid-error')).toHaveCount(1);

  for (const state of states) {
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
        await expect(stage.locator('.mermaid-svg > svg')).toHaveCount(0);
      } else {
        await expectMermaidContent(page, state);
      }
    } else if (fixture.kind === 'loading') {
      await expect(stage.getByRole('status')).toBeVisible();
    } else if (state === 'custom-empty-content') {
      await expect(stage.getByRole('status')).toContainText(/no nodes/i);
      await expect(stage.locator('[data-node-id], .diagram-edge')).toHaveCount(0);
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
        parsed.protocol.startsWith('http') &&
        !['127.0.0.1', 'localhost', new URL(preview.url).hostname].includes(parsed.hostname)
      );
    }),
  ).toEqual([]);
  expect(
    requests.filter((url) =>
      /\/(?:intentd|__sandbox\/health)(?:\/|\?|$)/.test(new URL(url).pathname),
    ),
    'no daemon requests',
  ).toEqual([]);
  expect(
    webSockets.filter((url) => /\/intentd(?:\/|$)/.test(new URL(url).pathname)),
    'no daemon websocket',
  ).toEqual([]);
  expect(
    webSockets.every((url) =>
      ['127.0.0.1', 'localhost', new URL(preview.url).hostname].includes(new URL(url).hostname),
    ),
  ).toBe(true);
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(expectedInvalidErrors.length).toBeGreaterThan(0);
});

test('settles representative screenshots after theme changes and disables network motion', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openState(page, 'mermaid-dense-graph', 960, 'light');
  await expectMermaidContent(page, 'mermaid-dense-graph');
  const initial = await page.evaluate(() => ({
    background: getComputedStyle(document.documentElement).getPropertyValue('--background'),
    foreground: getComputedStyle(document.documentElement).getPropertyValue('--foreground'),
    svgId: document.querySelector('#mermaid-dense-graph .mermaid-svg > svg')?.id,
  }));
  await expectStableScreenshot(page, 'mermaid-dense-graph');

  await chooseColorTheme(page, 'Nord');
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
  await expectCustomGeometry(page, 'custom-network');
  await expect(page.locator('#custom-network .edge-animated .edge-path').first()).toHaveCSS(
    'animation-name',
    'none',
  );
  await openState(page, 'custom-long-multiline-labels', 420, 'dark');
  await expectCustomGeometry(page, 'custom-long-multiline-labels');
  await expectStableScreenshot(page, 'custom-long-multiline-labels');
});

for (const { state, labels } of [
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
]) {
  test(`keeps ${state} authored edge-label content inside Mermaid viewports`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await openState(page, state, 960, 'light');
    await expectMermaidEdgeLabelGeometry(page, state, labels);
  });
}

for (const width of [420, 960] as const) {
  test(`keeps Source feedback and forward routes connected in light at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openState(page, 'mermaid-dense-graph', width, 'light');
    await chooseColorTheme(page, 'Default');
    const connections = [
      { id: 'L_A_B_0', source: 'Source', target: 'Model' },
      { id: 'L_A_C_0', source: 'Source', target: 'Diagnostics' },
      { id: 'L_A_D_0', source: 'Source', target: 'Catalog' },
      { id: 'L_G_A_0', source: 'Browser', target: 'Source' },
      { id: 'L_E_F_0', source: 'Frame', target: 'Evidence' },
      { id: 'L_E_G_0', source: 'Frame', target: 'Browser' },
    ];
    const routes = await page
      .locator('#mermaid-dense-graph')
      .evaluate(paintedRouteGeometry, connections);
    expectPaintedRoutes(routes, connections);
  });

  test(`keeps reciprocal routes connected before and after a state change at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openState(page, 'custom-walkthrough', width, 'light');
    await chooseColorTheme(page, 'Default');
    if (width === 960) {
      const connections = [
        { id: 'w2', source: 'redux', target: 'chat' },
        { id: 'w3', source: 'chat', target: 'redux' },
      ];
      const routes = await page
        .locator('#custom-walkthrough')
        .evaluate(paintedRouteGeometry, connections);
      expectPaintedRoutes(routes, connections);
    } else {
      const narrow = await page.locator('#custom-walkthrough').evaluate(narrowWalkthroughGeometry, [
        { id: 'w2', source: 'redux', target: 'chat' },
        { id: 'w3', source: 'chat', target: 'redux' },
      ]);
      expectNarrowWalkthrough(narrow);
    }

    await page
      .locator('#custom-walkthrough')
      .getByRole('button', { name: 'State 2: 2. Follow execution' })
      .click();
    await expect(
      page.locator('#custom-walkthrough .diagram-renderer[data-diagram-settled="true"]'),
    ).toBeVisible();
    if (width === 960) {
      const connections = [{ id: 'w3', source: 'chat', target: 'redux' }];
      expectPaintedRoutes(
        await page.locator('#custom-walkthrough').evaluate(paintedRouteGeometry, connections),
        connections,
      );
    } else {
      const narrow = await page
        .locator('#custom-walkthrough')
        .evaluate(narrowWalkthroughGeometry, [{ id: 'w3', source: 'chat', target: 'redux' }]);
      expectNarrowWalkthrough(narrow);
    }
  });

  test(`keeps the native Mermaid self-loop attached and outside Router at ${width}px`, async ({
    page,
  }) => {
    await openState(page, 'mermaid-topology-stress', width, 'light');
    const connections = [{ id: 'L_B_B_0', source: 'Router', target: 'Router' }];
    const routes = await page
      .locator('#mermaid-topology-stress')
      .evaluate(paintedRouteGeometry, connections);
    expectPaintedRoutes(routes, connections);
    const loop = await page
      .locator('#mermaid-topology-stress svg.flowchart[data-layout-settled="true"]')
      .evaluate((svg) => {
        const path = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find((item) =>
          /-L_B_B_[0-9]+$/.test(item.id),
        )!;
        const router = [...svg.querySelectorAll<SVGGElement>('g.node')]
          .find((node) => node.textContent?.trim() === 'Router')!
          .querySelector<SVGGraphicsElement>(':scope > .label-container')!
          .getBoundingClientRect();
        const matrix = path.getScreenCTM()!;
        const points = Array.from({ length: 401 }, (_, index) =>
          path.getPointAtLength((path.getTotalLength() * index) / 400).matrixTransform(matrix),
        );
        return {
          entersRouter: points
            .slice(1, -1)
            .some(
              (point) =>
                point.x > router.left + 1 &&
                point.x < router.right - 1 &&
                point.y > router.top + 1 &&
                point.y < router.bottom - 1,
            ),
          marker: path.getAttribute('marker-end'),
        };
      });
    expect(loop.entersRouter).toBe(false);
    expect(loop.marker).toContain('pointEnd');
  });
}

for (const width of [320, 960] as const) {
  test(`keeps the Client request lane clear in light at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await openState(page, 'mermaid-nested-groups', width, 'light');
    const renderer = page.locator('#mermaid-nested-groups .mermaid-renderer');
    const colorTheme = await chooseColorTheme(page, 'Default');
    await expect(colorTheme).toContainText('Default');
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    await expectClientRequestLane(page, `light/${width}/mermaid-nested-groups`);
    await expectStoreNodeGeometry(
      page,
      'mermaid-nested-groups',
      `light/${width}/mermaid-nested-groups`,
    );
  });
}

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
for (const { state, targets } of [
  { state: 'mermaid-state', targets: mermaidTargets },
  { state: 'custom-state-machine', targets: customTargets },
]) {
  test(`keeps ${state} arrowheads visible and associated with authored targets`, async ({
    page,
  }) => {
    await openState(page, state, 320, 'light');
    await expectTerminalArrowGeometry(page, state, targets);
  });
}

const stateRecoveryTargets = {
  '0': 'Running',
  '1': 'Complete',
  '2': 'Failed',
  '3': 'Running',
  '4': '',
  '5': '',
};

test('terminal arrow discovery supports Mermaid flowchart rendered groups', async ({ page }) => {
  await openState(page, 'mermaid-flow', 320, 'light');
  await expectTerminalArrowGeometry(page, 'mermaid-flow', {
    '0': 'Valid?',
    '1': 'Process request',
    '2': 'Repair input',
    '3': 'Valid?',
    '4': 'Ready',
  });
});

test('terminal arrow discovery rejects missing, empty, and detached state paths', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pathSelector = '.edgePaths path[marker-end], .edges.edgePath path[marker-end]';
  const mutations = [
    { name: 'missing', apply: 'missing-marker', error: /toHaveCount|to have count/ },
    { name: 'empty', apply: 'empty-path', error: /nonempty rendered path/ },
    { name: 'detached', apply: 'detach-path', error: /toHaveCount|to have count/ },
  ] as const;

  for (const mutation of mutations) {
    await openState(page, 'mermaid-state-recovery', 320, 'light');
    const paths = page.locator('#mermaid-state-recovery').locator(pathSelector);
    await expect(paths, `${mutation.name} control precondition`).toHaveCount(6);
    await paths.first().evaluate((path, apply) => {
      if (apply === 'missing-marker') path.removeAttribute('marker-end');
      if (apply === 'empty-path') path.setAttribute('d', '');
      if (apply === 'detach-path') path.remove();
    }, mutation.apply);
    await expect(
      expectTerminalArrowGeometry(page, 'mermaid-state-recovery', stateRecoveryTargets, 250),
    ).rejects.toThrow(mutation.error);
  }
});

test('keeps state routes attached and stable through repeated auto-fit resizes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openState(page, 'mermaid-state-recovery', 320, 'light');
  const root = page.locator('#mermaid-state-recovery');
  const paths = root.locator('.edgePaths path[marker-end], .edges.edgePath path[marker-end]');
  await expect(paths).toHaveCount(6);
  await expect(root.locator('g.node[id*="root_start"]')).toHaveCount(1);
  await expect(root.locator('g.node[id*="root_end"]')).toHaveCount(1);

  const geometry = () =>
    paths.evaluateAll((edges) =>
      edges.map((edge) => ({
        d: edge.getAttribute('d'),
        base: (edge as SVGPathElement).dataset.terminalGapBasePath,
        target: (edge as SVGPathElement).dataset.terminalTarget,
      })),
    );
  await expectTerminalArrowGeometry(page, 'mermaid-state-recovery', stateRecoveryTargets);
  const initial = await geometry();
  expect(initial.every((edge) => edge.base && edge.target)).toBe(true);
  const effectiveGeometry = () =>
    root.locator('.mermaid-svg > svg').evaluate((svg) => ({
      width: svg.getBoundingClientRect().width,
      height: svg.getBoundingClientRect().height,
      routes: [
        ...svg.querySelectorAll<SVGPathElement>(
          '.edgePaths path[marker-end], .edges.edgePath path[marker-end]',
        ),
      ].map((path) => {
        const matrix = path.getScreenCTM()!;
        return { d: path.getAttribute('d'), scale: Math.hypot(matrix.a, matrix.b) };
      }),
    }));
  let previous = await effectiveGeometry();

  for (const width of [200, 320, 200, 320]) {
    await page
      .getByTestId('catalog-scene-focus')
      .evaluate((element, value) => (element.style.width = `${value}px`), width);
    await expect
      .poll(() =>
        page
          .getByTestId('catalog-scene-focus')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(width);
    await expect
      .poll(effectiveGeometry, { message: `${width}px fit must change rendered geometry` })
      .not.toEqual(previous);
    await expect(root.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expectTerminalArrowGeometry(page, 'mermaid-state-recovery', stateRecoveryTargets);
    previous = await effectiveGeometry();
  }

  expect(await geometry()).toEqual(initial);
});

test(`keeps custom Store text inside its usable body at 320px`, async ({ page }) => {
  test.setTimeout(120_000);
  await openState(page, 'custom-data-flow', 320, 'light');
  const colorTheme = await chooseColorTheme(page, 'Default');
  await expect(colorTheme).toContainText('Default');
  await expectCustomGeometry(page, 'custom-data-flow');
  await expectStoreNodeGeometry(page, 'custom-data-flow', `light/320/custom-data-flow`);
});

for (const width of [240, 960]) {
  test(`keeps Mermaid class members and relations inside repaired geometry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await openState(page, 'mermaid-class', width, 'light');
    await expectMermaidClassGeometry(page, `${width}px`);
  });
}

for (const width of [240, 960]) {
  test(`keeps Mermaid actions reachable outside content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1900, height: 1200 });
    await openState(page, 'mermaid-long-labels', width, 'light');
    await expectMermaidContent(page, 'mermaid-long-labels');
    await expectActionsClearGeometry(
      page,
      '#mermaid-long-labels .mermaid-actions',
      '#mermaid-long-labels .mermaid-svg .node, #mermaid-long-labels .mermaid-svg .edgeLabel, #mermaid-long-labels .mermaid-svg .edgePaths path, #mermaid-long-labels .mermaid-svg .cluster',
      `Mermaid ${width}`,
    );
  });

  test(`keeps custom actions reachable outside content at ${width}px`, async ({ page }) => {
    await openState(page, 'custom-timeline', width, 'light');
    await expectCustomGeometry(page, 'custom-timeline');
    await expectActionsClearGeometry(
      page,
      '#custom-timeline .diagram-actions',
      '#custom-timeline .diagram-node-html, #custom-timeline .edge-label-container, #custom-timeline .edge-path, #custom-timeline .diagram-group',
      `custom ${width}`,
    );
  });
}

test('keeps the fullscreen close control reachable and returns to the inline diagram', async ({
  page,
}) => {
  await openState(page, 'mermaid-long-labels', 420, 'dark');
  await expectMermaidContent(page, 'mermaid-long-labels');
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
  await page
    .getByRole('dialog', { name: 'Fullscreen diagram view' })
    .getByRole('button', { name: 'Close fullscreen view' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Fullscreen diagram view' })).toHaveCount(0);
  await expect(
    page
      .locator('#mermaid-long-labels')
      .getByRole('button', { name: 'Expand diagram to fullscreen' }),
  ).toBeFocused();
});

for (const { name, theme, nord } of [
  { name: 'Light', theme: 'light', nord: false },
  { name: 'Dark', theme: 'dark', nord: false },
  { name: 'Nord', theme: 'light', nord: true },
] as const) {
  test(`keeps state text above crossing routes with ${name} label surfaces at 320px`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openState(page, 'mermaid-state', 320, nord ? 'nord' : theme);
    if (nord) {
      await chooseColorTheme(page, 'Nord');
      await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
        'data-catalog-color-theme',
        'nord',
      );
      await expect(page.locator('#mermaid-state .mermaid-renderer')).toHaveAttribute(
        'data-render-settled',
        'true',
      );
    }
    await expectStateLabelPaint(page);
  });
}

for (const width of [320, 960]) {
  test(`keeps reported state labels readable and attached at ${width}px`, async ({ page }) => {
    await openState(page, 'mermaid-state', width, 'light');
    await expectMermaidContent(page, 'mermaid-state');
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
        labels: labels.map((label) => label.textContent!.trim()).sort(),
        pairOverlaps:
          retries.left < fails.right &&
          retries.right > fails.left &&
          retries.top < fails.bottom &&
          retries.bottom > fails.top,
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
    expect(stateGeometry.labels).toEqual(
      [
        'User sends message',
        'Agent responds',
        'Tool starts',
        'Tool completes',
        'Agent asks user',
        'User replies',
        'Agent finishes',
        'Request fails',
        'Stream fails',
        'User retries',
      ].sort(),
    );
    expect(stateGeometry.pairOverlaps, `${width}px state label separation`).toBe(false);
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
  });

  test(`keeps both nested group headers clear of authored members and routes at ${width}px`, async ({
    page,
  }) => {
    await openState(page, 'mermaid-nested-groups', width, 'light');
    await expectMermaidContent(page, 'mermaid-nested-groups');
    const connections = [
      { id: 'L_Client_Gateway_0', source: 'Client', target: 'Gateway' },
      { id: 'L_Gateway_Queue_0', source: 'Gateway', target: 'Queue' },
      { id: 'L_Queue_Worker_0', source: 'Queue', target: 'Worker' },
      { id: 'L_Worker_Store_0', source: 'Worker', target: 'Store' },
      { id: 'L_Store_Client_0', source: 'Store', target: 'Client' },
    ];
    expectPaintedRoutes(
      await page.locator('#mermaid-nested-groups').evaluate(paintedRouteGeometry, connections),
      connections,
    );
    await expect(page.locator('#mermaid-nested-groups .mermaid-svg > svg')).toBeVisible({
      timeout: 30_000,
    });
    const groups = await page.locator('#mermaid-nested-groups').evaluate((root) =>
      [...root.querySelectorAll<SVGGElement>('g.cluster')].map((group) => {
        const label = group.querySelector<SVGGElement>(':scope > .cluster-label')!;
        const background = group.querySelector<SVGRectElement>(':scope > rect')!;
        const labelBounds = label.getBoundingClientRect();
        const groupBounds = background.getBoundingClientRect();
        const title = label.textContent!.trim();
        const membership: Record<string, string[]> = {
          'Runtime boundary': ['Gateway', 'Queue', 'Worker', 'Store'],
          'Worker boundary': ['Queue', 'Worker'],
        };
        const names = membership[title];
        if (!names) throw new Error(`Unexpected cluster ${title}`);
        const children = names.map((name) => {
          const matches = [...root.querySelectorAll<SVGGElement>('g.node')].filter(
            (node) => node.textContent?.trim() === name,
          );
          if (matches.length !== 1) throw new Error(`${title}: expected member ${name}`);
          return matches[0].getBoundingClientRect();
        });
        const routeCrossesTitle = [
          ...root.querySelectorAll<SVGPathElement>('.edgePaths path'),
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
          title,
          membersContained: children.every(
            (child) =>
              child.left >= groupBounds.left - 1 &&
              child.right <= groupBounds.right + 1 &&
              child.top >= groupBounds.top - 1 &&
              child.bottom <= groupBounds.bottom + 1,
          ),
          contained:
            labelBounds.left >= groupBounds.left - 1 &&
            labelBounds.top >= groupBounds.top - 1 &&
            labelBounds.right <= groupBounds.right + 1,
          childOverlapsTitle: children.some(
            (child) =>
              child.left < labelBounds.right &&
              child.right > labelBounds.left &&
              child.top < labelBounds.bottom &&
              child.bottom > labelBounds.top,
          ),
          routeCrossesTitle,
        };
      }),
    );
    expect(groups.map((group) => group.title).sort()).toEqual([
      'Runtime boundary',
      'Worker boundary',
    ]);
    for (const group of groups) {
      expect(group.membersContained, `${width}px ${group.title} member containment`).toBe(true);
      expect(group.contained, `${width}px group title containment`).toBe(true);
      expect(group.childOverlapsTitle, `${width}px title/member collision`).toBe(false);
      expect(group.routeCrossesTitle, `${width}px group route clearance`).toBe(false);
    }
  });
}

for (const width of [420, 960] as const) {
  test(`keeps state routes clear of unrelated nodes at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await openState(page, 'mermaid-state', width, 'dark');
    const colorTheme = await chooseColorTheme(page, 'Default');
    await expect(colorTheme).toContainText('Default');
    await expect(page.locator('#mermaid-state .mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    await expectStateObstacleGeometry(page, `dark/${width}/state`);
  });

  test(`keeps state recovery routes attached to authored targets at ${width}px`, async ({
    page,
  }) => {
    await openState(page, 'mermaid-state-recovery', width, 'dark');
    await expect(async () => {
      await expectTerminalArrowGeometry(page, 'mermaid-state-recovery', stateRecoveryTargets);
    }).toPass({ timeout: 10_000 });
    await expectStateFailureTerminal(page, `dark/${width}/state-recovery`);
  });

  test(`keeps native nested review corridors clear in dark at ${width}px`, async ({ page }) => {
    await openState(page, 'mermaid-nested-routing', width, 'dark');
    await expect(page.locator('#mermaid-nested-routing .mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    await expectNestedReviewGeometry(page, `dark/${width}/nested`);
  });

  test(`keeps authored service routes attached across group boundaries at ${width}px`, async ({
    page,
  }) => {
    await openState(page, 'custom-service-boundaries', width, 'dark');
    await expectServiceBoundaryRouting(page);
  });

  for (const state of ['mermaid-entity-relationship', 'mermaid-minimal-entity-relationship']) {
    test(`keeps ${state} authored rows clear of dividers at ${width}px`, async ({ page }) => {
      await openState(page, state, width, 'dark');
      await expectEntityDividerGeometry(page, state, `dark/${width}/${state}`);
    });
  }
}

test('keeps data-flow feedback continuous from Preview source to Capture evidence', async ({
  page,
}) => {
  test.setTimeout(240_000);
  for (const width of [960, 320]) {
    await openState(page, 'custom-data-flow', width, 'light');
    await expectTerminalArrowGeometry(page, 'custom-data-flow', {
      d1: 'Parse deterministic fixture',
      d2: 'Compute stable layout',
      d3: 'Render semantic output',
      d4: 'Capture evidence',
      d5: 'Capture evidence',
    });
    const connections = [{ id: 'd5', source: 'source', target: 'store' }];
    expectPaintedRoutes(
      await page.locator('#custom-data-flow').evaluate(paintedRouteGeometry, connections),
      connections,
    );
    const geometry = await page.locator('#custom-data-flow').evaluate((root) => {
      const path = root.querySelector<SVGPathElement>(
        '.diagram-edge[data-edge-id="d5"] path.edge-path',
      )!;
      const pathBounds = path.getBoundingClientRect();
      const svgBounds = root
        .querySelector<SVGSVGElement>('.diagram-svg-layer')!
        .getBoundingClientRect();
      const viewport = root.querySelector<HTMLElement>('.diagram-scroll-container')!;
      return {
        moveCommands: (path.getAttribute('d')?.match(/M/g) ?? []).length,
        marker: path.getAttribute('marker-end'),
        contained: pathBounds.left >= svgBounds.left - 1 && pathBounds.right <= svgBounds.right + 1,
        noScrollbar: viewport.scrollWidth <= viewport.clientWidth + 1,
      };
    });
    expect(geometry.moveCommands, `${width}px continuous shaft`).toBe(1);
    expect(geometry.marker, `${width}px target marker`).toContain('arrowhead');
    expect(geometry.contained, `${width}px route containment`).toBe(true);
    expect(geometry.noScrollbar, `${width}px horizontal overflow`).toBe(true);
  }
});

for (const width of [320, 960]) {
  test(`keeps both authored grouped fan-out routes painted and attached at ${width}px`, async ({
    page,
  }) => {
    await openState(page, 'mermaid-groups', width, 'light');
    const connections = [
      { id: 'L_Scene_Mermaid_0', source: 'Named scene', target: 'Mermaid' },
      { id: 'L_Scene_Custom_0', source: 'Named scene', target: 'Interactive custom' },
    ];
    const routes = await page
      .locator('#mermaid-groups')
      .evaluate(paintedRouteGeometry, connections);
    expectPaintedRoutes(routes, connections);
    expect(routes).toHaveLength(2);
    expect(new Set(routes.map(({ target }) => target)).size).toBe(2);
    for (const route of routes)
      expect(route.targetBounds.left, `${route.id} authored forward direction`).toBeGreaterThan(
        route.sourceBounds.right,
      );
  });
}

test('keeps the dense primary request connected and readable after fitting', async ({ page }) => {
  await openState(page, 'custom-topology-stress', 320, 'light');
  const root = page.locator('#custom-topology-stress');
  const fit = root.locator('.diagram-fit-button');
  if ((await fit.getAttribute('aria-pressed')) !== 'true') await fit.click({ force: true });
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  const connections = [{ id: 'z1', source: 'input', target: 'gate' }];
  expectPaintedRoutes(await root.evaluate(paintedRouteGeometry, connections), connections);
  const geometry = await root.evaluate((section) => {
    const nodes = [...section.querySelectorAll<HTMLElement>('.diagram-node-html')];
    const svgElement = section.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
    const svg = svgElement.getBoundingClientRect();
    const scale = Math.hypot(svgElement.getScreenCTM()!.a, svgElement.getScreenCTM()!.b);
    const minimumPrimaryTextSize = Math.min(
      ...[...section.querySelectorAll<HTMLElement>('.node-label')].map(
        (label) => Number.parseFloat(getComputedStyle(label).fontSize) * scale,
      ),
    );
    return {
      minimumPrimaryTextSize,
      contained: [
        ...nodes.map((node) => node.parentElement!),
        ...section.querySelectorAll('.edge-path, .edge-label-container'),
      ].every((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= svg.left - 1 &&
          bounds.right <= svg.right + 1 &&
          bounds.top >= svg.top - 1 &&
          bounds.bottom <= svg.bottom + 1
        );
      }),
    };
  });
  expect(geometry.minimumPrimaryTextSize).toBeGreaterThanOrEqual(12);
  expect(geometry.contained).toBe(true);
  const access = await root.locator('.diagram-scroll-container').evaluate((viewport) => {
    const svg = viewport.querySelector('.diagram-svg-layer')!;
    const frame = viewport.getBoundingClientRect();
    const initial = viewport.scrollLeft;
    viewport.scrollLeft = 0;
    const first = svg.getBoundingClientRect();
    viewport.scrollLeft = viewport.scrollWidth;
    const last = svg.getBoundingClientRect();
    const result = {
      start: first.left >= frame.left - 1,
      end: last.right <= frame.right + 1,
      moved: viewport.scrollWidth <= viewport.clientWidth + 1 || last.left < first.left,
    };
    viewport.scrollLeft = initial;
    return result;
  });
  expect(access).toEqual({ start: true, end: true, moved: true });
});

test('keeps the topology self-loop connected without crossing its node', async ({ page }) => {
  await openState(page, 'custom-topology-stress', 320, 'light');
  const root = page.locator('#custom-topology-stress');
  const connections = [{ id: 'z5', source: 'hub', target: 'hub' }];
  expectPaintedRoutes(await root.evaluate(paintedRouteGeometry, connections), connections);
  const geometry = await root.evaluate((root) => {
    const path = root.querySelector<SVGPathElement>(
      '.diagram-edge[data-edge-id="z5"] path.edge-path',
    )!;
    const node = root.querySelector<SVGForeignObjectElement>('[data-node-id="hub"]')!;
    const bounds = node.getBoundingClientRect();
    const matrix = path.getScreenCTM()!;
    const length = path.getTotalLength();
    const routeOutside = Array.from({ length: 199 }, (_, index) =>
      path.getPointAtLength((length * (index + 1)) / 200).matrixTransform(matrix),
    ).every(
      (sample) =>
        sample.x >= bounds.right - 1 ||
        sample.y <= bounds.top + 1 ||
        sample.x <= bounds.left + 1 ||
        sample.y >= bounds.bottom - 1,
    );
    return { routeOutside, hasTargetMarker: Boolean(path.getAttribute('marker-end')) };
  });
  expect(geometry.routeOutside, 'self-loop does not obscure its node').toBe(true);
  expect(geometry.hasTargetMarker).toBe(true);
});

for (const policy of ['full', 'reduced'] as const) {
  test(`preserves shared nodes and settles state entries with ${policy} motion`, async ({
    page,
  }) => {
    await page.goto(
      `${preview.url}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=960&motion=${policy}`,
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 120_000,
    });
    const root = page.locator('#custom-walkthrough');
    const motion = await root.evaluate(async (section) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const read = () => {
        const node = (id: string) =>
          section.querySelector<SVGForeignObjectElement>(`[data-node-id="${id}"]`);
        const edge = (id: string) =>
          section.querySelector<SVGGElement>(`.diagram-edge[data-edge-id="${id}"]`);
        const label = (id: string) =>
          section.querySelector<SVGForeignObjectElement>(
            `.edge-label-container[data-edge-id="${id}"]`,
          );
        const opacity = (element: Element | null) => {
          if (!element) return null;
          let result = 1;
          for (let current: Element | null = element; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (style.display === 'none' || style.visibility !== 'visible') return 0;
            result *= Number(style.opacity);
          }
          return result;
        };
        const routeReveal = (id: string) => {
          const route = edge(id)?.parentElement;
          if (!route) return null;
          const value = getComputedStyle(route).getPropertyValue('--edge-reveal-progress').trim();
          return value === '' ? 1 : Number(value);
        };
        const labelOpacity = (id: string) => opacity(label(id));
        const edgePath = edge('w4')?.querySelector<SVGPathElement>('path.edge-path') ?? null;
        const visibleDetachedEdges = [...section.querySelectorAll<SVGGElement>('.diagram-edge')]
          .filter((element) => {
            const value = getComputedStyle(element.parentElement!)
              .getPropertyValue('--edge-reveal-progress')
              .trim();
            return (value === '' ? 1 : Number(value)) > 0.01 && (opacity(element) ?? 0) > 0.01;
          })
          .filter((element) => {
            const source = node(element.dataset.edgeFrom!);
            const target = node(element.dataset.edgeTo!);
            return opacity(source) === null || opacity(source)! <= 0.01 || opacity(target)! <= 0.01;
          })
          .map((element) => element.dataset.edgeId);
        const cameraRunning = [
          ...section.querySelectorAll<SVGElement>('.diagram-svg-layer, .diagram-geometry-motion'),
        ].some((element) =>
          element
            .getAnimations({ subtree: false })
            .some((animation) => animation.playState === 'running'),
        );
        const enteringNode = node('daemon');
        return {
          nodeIds: [...section.querySelectorAll<HTMLElement>('[data-node-id]')]
            .map((node) => node.dataset.nodeId)
            .sort(),
          edgeIds: [...section.querySelectorAll<HTMLElement>('.diagram-edge')]
            .map((edge) => edge.dataset.edgeId)
            .sort(),
          finiteAnimations: section
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                (animation.playState === 'running' || animation.pending) &&
                Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)) &&
                Number(animation.effect?.getComputedTiming().endTime) > 0,
            ).length,
          state: section.querySelector<HTMLElement>('.diagram-renderer')!.dataset.diagramState,
          settled: section.querySelector<HTMLElement>('.diagram-renderer')!.dataset.diagramSettled,
          cameraRunning,
          sharedRedux: opacity(node('redux')),
          sharedChat: opacity(node('chat')),
          departingNode: opacity(node('user')),
          departingRoute: routeReveal('w1'),
          departingLabel: labelOpacity('w1'),
          enteringNode: opacity(enteringNode),
          enteringRoute: routeReveal('w4'),
          enteringLabel: labelOpacity('w4'),
          enteringTransform: enteringNode ? getComputedStyle(enteringNode).transform : null,
          visibleDetachedEdges,
          edgeMask: edgePath?.parentElement?.getAttribute('mask') ?? null,
          edgeAnimation: edgePath ? getComputedStyle(edgePath).animationName : null,
          edgeDashOffset: edgePath ? getComputedStyle(edgePath).strokeDashoffset : null,
        };
      };
      const frames = [read()];
      // Observe synchronous updates too, so reduced-motion violations cannot hide
      // between the user action and the final settled frame.
      const observer = new MutationObserver(() => frames.push(read()));
      observer.observe(section, { attributes: true, childList: true, subtree: true });
      section
        .querySelector<HTMLButtonElement>('button[aria-label="State 2: 2. Follow execution"]')!
        .click();
      while (
        frames.at(-1)!.state !== 'execute' ||
        frames.at(-1)!.settled !== 'true' ||
        frames.length === 1
      ) {
        await nextFrame();
        frames.push(read());
      }
      const final = read();
      await nextFrame();
      observer.disconnect();
      return { frames, final, nextPaint: read() };
    });
    expect(motion.frames[0]).toMatchObject({
      nodeIds: ['chat', 'redux', 'user'],
      edgeIds: ['w1', 'w2', 'w3'],
      state: 'request',
      settled: 'true',
      departingNode: 1,
      enteringNode: null,
      enteringRoute: null,
      enteringLabel: null,
    });
    expect(motion.frames.length).toBeGreaterThan(1);
    if (policy === 'full') {
      expect(
        motion.frames.some((frame) => frame.finiteAnimations > 0),
        'full motion enters an animation lifecycle',
      ).toBe(true);
      expect(
        motion.frames.some((frame) => frame.settled === 'false'),
        'transition invalidates settlement',
      ).toBe(true);
    } else {
      expect(
        motion.frames.map((frame) => frame.finiteAnimations),
        'reduced motion has no finite animation throughout the transition',
      ).toEqual(motion.frames.map(() => 0));
    }
    expect(
      motion.frames.every(
        (frame) =>
          frame.sharedRedux !== null &&
          frame.sharedRedux > 0.5 &&
          frame.sharedChat !== null &&
          frame.sharedChat > 0.5,
      ),
    ).toBe(true);
    expect(motion.frames.every((frame) => frame.visibleDetachedEdges.length === 0)).toBe(true);
    expect(motion.final).toMatchObject({
      nodeIds: ['chat', 'daemon', 'redux'],
      edgeIds: ['w3', 'w4', 'w5'],
      finiteAnimations: 0,
      state: 'execute',
      settled: 'true',
      departingNode: null,
      departingRoute: null,
      departingLabel: null,
      enteringNode: 1,
      enteringRoute: 1,
      enteringLabel: 1,
    });
    expect(motion.final.enteringTransform).toBe('none');
    expect(motion.final.edgeAnimation).toBe('none');
    expect(motion.final.edgeDashOffset).toBe('0px');
    expect(motion.nextPaint).toEqual(motion.final);
    const connections = [
      { id: 'w3', source: 'chat', target: 'redux' },
      { id: 'w4', source: 'redux', target: 'daemon' },
      { id: 'w5', source: 'daemon', target: 'redux' },
    ];
    expectPaintedRoutes(await root.evaluate(paintedRouteGeometry, connections), connections);
  });
}
