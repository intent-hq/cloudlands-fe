import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running preview server.');

const fixtures = [
  {
    id: 'edge-subgraph-siblings',
    nodes: {
      A: 'Web',
      B: 'Mobile',
      C: 'Batch',
      D: 'Primary database',
      E: 'Cache',
      F: 'Metrics',
      G: 'Logs',
    },
    edges: ['A>D', 'B>E', 'C>D', 'A>F', 'B>G', 'C>F', 'E>D'],
    labels: [],
    groups: [
      { label: 'Applications', members: ['A', 'B', 'C'] },
      { label: 'Data services', members: ['D', 'E'] },
      { label: 'Operations', members: ['F', 'G'] },
    ],
  },
  {
    id: 'edge-eight-way-fanin',
    nodes: {
      A: 'Web',
      B: 'Mobile',
      C: 'Worker',
      D: 'Import',
      E: 'Webhook',
      F: 'Timer',
      G: 'CLI',
      H: 'Audit',
      Z: 'Event store',
      R: 'Read model',
    },
    edges: ['A>Z', 'B>Z', 'C>Z', 'D>Z', 'E>Z', 'F>Z', 'G>Z', 'H>Z', 'Z>R'],
    labels: [],
    groups: [],
  },
  {
    id: 'edge-mixed-node-shapes',
    nodes: {
      A: 'Start',
      B: 'Input',
      C: 'Check',
      D: 'Subroutine',
      E: 'Database',
      F: 'Event',
      G: 'Prepare',
      H: 'End',
    },
    edges: ['A>B', 'B>C', 'C>D', 'D>E', 'E>F', 'F>G', 'G>H'],
    labels: [],
    groups: [],
  },
  {
    id: 'mermaid-nested-groups',
    nodes: {
      Client: 'Client',
      Gateway: 'Gateway',
      Queue: 'Queue',
      Worker: 'Worker',
      Store: 'Store',
    },
    edges: ['Client>Gateway', 'Gateway>Queue', 'Queue>Worker', 'Worker>Store', 'Store>Client'],
    labels: ['request', 'enqueue', 'deliver', 'write', 'result'],
    groups: [
      { label: 'Runtime boundary', members: ['Gateway', 'Queue', 'Worker', 'Store'] },
      { label: 'Worker boundary', members: ['Queue', 'Worker'] },
    ],
  },
];

// Failure modes: a missing marker/target; a tip too far from, inside, or facing
// away from the native fill; dropped content; displaced group members; strokes
// through nodes/text; internal labels crossing a shared group boundary. The
// sibling fixture additionally requires zero painted wire crossings.
// This intentionally does not import production routing or terminal helpers.
function groupedGeometry(svg: SVGSVGElement) {
  type Point = { x: number; y: number };
  const point = (p: Point) => ({ x: p.x, y: p.y });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const bounds = (e: Element) => e.getBoundingClientRect().toJSON() as DOMRect;
  const text = (e: Element) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const inside = (p: Point, b: DOMRect) =>
    p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
  const contains = (a: DOMRect, b: DOMRect) =>
    b.left >= a.left - 0.75 &&
    b.right <= a.right + 0.75 &&
    b.top >= a.top - 0.75 &&
    b.bottom <= a.bottom + 0.75;
  const visible = (element: Element) => {
    for (let e: Element | null = element; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0)
        return false;
      if (e === svg) break;
    }
    return true;
  };
  const scale = (m: DOMMatrix) => {
    const sum = m.a ** 2 + m.b ** 2 + m.c ** 2 + m.d ** 2;
    const det = m.a * m.d - m.b * m.c;
    return Math.sqrt((sum + Math.sqrt(Math.max(0, sum ** 2 - 4 * det ** 2))) / 2);
  };
  const strokeRadius = (shape: SVGGeometryElement, matrix: DOMMatrix) => {
    const s = getComputedStyle(shape);
    return s.stroke === 'none' || Number(s.strokeOpacity) === 0
      ? 0
      : (parseFloat(s.strokeWidth) / 2) *
          (s.vectorEffect === 'non-scaling-stroke' ? 1 : scale(matrix));
  };
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((element) => {
    const shapes = [
      ...element.querySelectorAll<SVGGeometryElement>('path,rect,polygon,polyline,circle,ellipse'),
    ]
      .filter(
        (shape) =>
          !shape.closest('.label') &&
          visible(shape) &&
          getComputedStyle(shape).fill !== 'none' &&
          Number(getComputedStyle(shape).fillOpacity) > 0,
      )
      .map((shape) => {
        const matrix = shape.getScreenCTM()!;
        const length = shape.getTotalLength();
        const count = Math.max(8, Math.ceil(length * scale(matrix) * 8));
        return {
          shape,
          inverse: matrix.inverse(),
          strokeRadius: strokeRadius(shape, matrix),
          outline: Array.from({ length: count + 1 }, (_, i) =>
            point(shape.getPointAtLength((length * i) / count).matrixTransform(matrix)),
          ),
        };
      });
    return {
      id: element.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? element.id,
      text: text(element),
      bounds: bounds(element),
      visible: visible(element),
      shapes,
    };
  });
  const filled = (node: (typeof nodes)[number], p: Point) =>
    node.shapes.some(({ shape, inverse }) =>
      shape.isPointInFill(new DOMPoint(p.x, p.y).matrixTransform(inverse)),
    );
  const labels = [
    ...svg.querySelectorAll<SVGGElement>(
      'g.node .label, .edgeLabels > .edgeLabel, g.cluster-label',
    ),
  ]
    .filter((label) => text(label))
    .map((label) => {
      const glyphs: DOMRect[] = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement || !visible(node.parentElement)) continue;
        for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
          if (!node.textContent![i].trim()) continue;
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          glyphs.push(
            ...[...range.getClientRects()]
              .filter((r) => r.width && r.height)
              .map((r) => r.toJSON() as DOMRect),
          );
        }
      }
      return {
        text: text(label),
        header: label.matches('g.cluster-label'),
        owner: label.querySelector('[data-id]')?.getAttribute('data-id') ?? null,
        visible: visible(label),
        bounds: bounds(label),
        glyphs,
      };
    });
  const groups = [...svg.querySelectorAll<SVGGElement>('g.cluster')].map((group) => {
    const rect = group.querySelector(':scope > rect');
    const label = group.querySelector(':scope > .cluster-label');
    const box = rect ? bounds(rect) : bounds(group);
    return {
      id: group.id,
      label: label ? text(label) : '',
      bounds: box,
      visible: visible(group) && !!rect,
      contained: nodes.filter((node) => contains(box, node.bounds)).map((node) => node.id),
      headerNodeHits: nodes
        .filter((node) =>
          labels
            .filter((l) => l.header && l.text === (label ? text(label) : ''))
            .some((l) =>
              l.glyphs.some(
                (g) =>
                  g.left < node.bounds.right &&
                  g.right > node.bounds.left &&
                  g.top < node.bounds.bottom &&
                  g.bottom > node.bounds.top,
              ),
            ),
        )
        .map((node) => node.id),
    };
  });
  const routes = [...svg.querySelectorAll<SVGPathElement>('path.flowchart-link')].map((path) => {
    const identity = path.id.match(/(?:^|-)L_([^_]+)_([^_]+)_\d+$/);
    const source = [...path.classList].find((c) => c.startsWith('LS_'))?.slice(3) ?? identity?.[1];
    const target = [...path.classList].find((c) => c.startsWith('LE_'))?.slice(3) ?? identity?.[2];
    const matrix = path.getScreenCTM()!;
    const inverse = matrix.inverse();
    const length = path.getTotalLength();
    const count = Math.max(1, Math.ceil(length * scale(matrix) * 2));
    const samples = Array.from({ length: count + 1 }, (_, i) =>
      point(path.getPointAtLength((length * i) / count).matrixTransform(matrix)),
    );
    const owner = path.id.match(/(?:^|-)(L_.+)$/)?.[1] ?? path.id;
    const own = labels.find((l) => l.owner === owner);
    const style = getComputedStyle(path);
    const routeVisible =
      visible(path) && style.stroke !== 'none' && Number(style.strokeOpacity) > 0;
    const painted = (p: Point) =>
      routeVisible &&
      !(own?.visible && inside(p, own.bounds)) &&
      path.isPointInStroke(new DOMPoint(p.x, p.y).matrixTransform(inverse));
    const radius = strokeRadius(path, matrix);
    const paint = samples.flatMap((p, i) => {
      const a = samples[Math.max(0, i - 1)],
        b = samples[Math.min(samples.length - 1, i + 1)];
      const span = distance(a, b) || 1;
      const steps = Math.max(1, Math.ceil(radius * 4));
      return Array.from({ length: steps * 2 + 1 }, (_, n) => {
        const offset = (n / steps - 1) * radius * 0.95;
        return { x: p.x - ((b.y - a.y) / span) * offset, y: p.y + ((b.x - a.x) / span) * offset };
      }).filter(painted);
    });
    const nodeHits = nodes
      .filter((n) => n.id !== source && n.id !== target)
      .flatMap((node) => {
        const hit = paint.find((p) => inside(p, node.bounds) && filled(node, p));
        return hit ? [{ node: node.id, point: hit }] : [];
      });
    const textHits = labels
      .filter((l) => !l.header && l.owner !== owner)
      .flatMap((label) => {
        const hit = paint.find((p) => label.glyphs.some((g) => inside(p, g)));
        return hit ? [{ text: label.text, point: hit }] : [];
      });
    const headerHits = labels
      .filter((l) => l.header)
      .flatMap((label) => {
        const hit = paint.find((p) => label.glyphs.some((g) => inside(p, g)));
        return hit ? [{ text: label.text, point: hit }] : [];
      });
    const terminal = (() => {
      const node = nodes.find((n) => n.id === target);
      const markerId = path.getAttribute('marker-end')?.match(/#([^)'"\s]+)/)?.[1];
      const marker = markerId
        ? svg.querySelector<SVGMarkerElement>(`marker[id="${markerId}"]`)
        : null;
      if (!node || !node.shapes.length || !marker || length <= 0) return null;
      const end = path.getPointAtLength(length);
      const before = path.getPointAtLength(Math.max(0, length - 0.25 / scale(matrix)));
      const orient = marker.getAttribute('orient');
      const angle =
        orient === 'auto' || orient === 'auto-start-reverse'
          ? (Math.atan2(end.y - before.y, end.x - before.x) * 180) / Math.PI
          : marker.orientAngle.baseVal.value;
      let sx = 1,
        sy = 1;
      if (marker.hasAttribute('viewBox')) {
        sx = marker.markerWidth.baseVal.value / marker.viewBox.baseVal.width;
        sy = marker.markerHeight.baseVal.value / marker.viewBox.baseVal.height;
        const align = marker.preserveAspectRatio.baseVal;
        if (align.align !== SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_NONE) {
          const uniform =
            align.meetOrSlice === SVGPreserveAspectRatio.SVG_MEETORSLICE_SLICE
              ? Math.max(sx, sy)
              : Math.min(sx, sy);
          sx = uniform;
          sy = uniform;
        }
      }
      const units =
        marker.getAttribute('markerUnits') === 'userSpaceOnUse' ? 1 : parseFloat(style.strokeWidth);
      const markerToScreen = new DOMMatrix([
        matrix.a,
        matrix.b,
        matrix.c,
        matrix.d,
        matrix.e,
        matrix.f,
      ])
        .translate(end.x, end.y)
        .rotate(angle)
        .scale(units)
        .scale(sx, sy)
        .translate(-marker.refX.baseVal.value, -marker.refY.baseVal.value);
      const endScreen = point(end.matrixTransform(matrix));
      const beforeScreen = point(before.matrixTransform(matrix));
      const span = distance(endScreen, beforeScreen) || 1;
      const direction = {
        x: (endScreen.x - beforeScreen.x) / span,
        y: (endScreen.y - beforeScreen.y) / span,
      };
      const markerSamples: { point: Point; radius: number; projection: number }[] = [];
      for (const shape of marker.querySelectorAll<SVGGeometryElement>(
        'path,polygon,polyline,circle,ellipse,rect,line',
      )) {
        const s = getComputedStyle(shape);
        if (!visible(shape) || (s.fill === 'none' && s.stroke === 'none')) continue;
        // Compose author transforms without consolidate(), which mutates SVG.
        let local = new DOMMatrix();
        const chain: SVGGraphicsElement[] = [];
        for (let e: Element | null = shape; e && e !== marker; e = e.parentElement)
          if (e instanceof SVGGraphicsElement) chain.unshift(e);
        for (const e of chain)
          for (let i = 0; i < e.transform.baseVal.numberOfItems; i++)
            local = local.multiply(e.transform.baseVal.getItem(i).matrix);
        const transform = markerToScreen.multiply(local);
        const len = shape.getTotalLength();
        const n = Math.max(64, Math.ceil(len * scale(transform) * 8));
        for (let i = 0; i <= n; i++) {
          const localPoint = shape.getPointAtLength((len * i) / n);
          const p = point(new DOMPoint(localPoint.x, localPoint.y).matrixTransform(transform));
          markerSamples.push({
            point: p,
            radius: strokeRadius(shape, transform),
            projection: (p.x - endScreen.x) * direction.x + (p.y - endScreen.y) * direction.y,
          });
        }
      }
      const tip = markerSamples.toSorted((a, b) => b.projection - a.projection)[0];
      if (!tip) return null;
      let nearest: { point: Point; distance: number; radius: number } | null = null;
      for (const shape of node.shapes)
        for (const p of shape.outline) {
          const d = distance(tip.point, p);
          if (!nearest || d < nearest.distance)
            nearest = { point: p, distance: d, radius: shape.strokeRadius };
        }
      if (!nearest) return null;
      const signed = filled(node, tip.point) ? -nearest.distance : nearest.distance;
      // Signed fill clearance includes marker stroke and target outline stroke.
      const gap = signed - tip.radius - nearest.radius;
      const towardOutline =
        (nearest.point.x - tip.point.x) * direction.x +
        (nearest.point.y - tip.point.y) * direction.y;
      const entersFill = Array.from({ length: 160 }, (_, i) => ({
        x: tip.point.x + direction.x * (i + 1) * 0.25,
        y: tip.point.y + direction.y * (i + 1) * 0.25,
      })).some((p) => filled(node, p));
      return {
        tip: tip.point,
        end: endScreen,
        tangent: direction,
        nearest: nearest.point,
        signedFillDistance: signed,
        markerStrokeRadius: tip.radius,
        targetStrokeRadius: nearest.radius,
        gap,
        towardOutline,
        entersFill,
        markerSampleCount: markerSamples.length,
        outlineSampleCount: node.shapes.reduce((sum, s) => sum + s.outline.length, 0),
      };
    })();
    return {
      id: path.id,
      edge: `${source}>${target}`,
      source,
      target,
      visible: routeVisible,
      length,
      samples,
      paintedSampleCount: paint.length,
      nodeHits,
      textHits,
      headerHits,
      terminal,
      painted,
    };
  });
  const cross = (a: { x: number; y: number }, b: typeof a, c: typeof a, d: typeof a) => {
    if (
      Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
      Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
      Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
      Math.max(c.y, d.y) < Math.min(a.y, b.y)
    )
      return null;
    const ab = { x: b.x - a.x, y: b.y - a.y },
      cd = { x: d.x - c.x, y: d.y - c.y };
    const det = ab.x * cd.y - ab.y * cd.x;
    if (Math.abs(det) < 1e-10) return null;
    const dx = c.x - a.x,
      dy = c.y - a.y;
    const t = (dx * cd.y - dy * cd.x) / det,
      u = (dx * ab.y - dy * ab.x) / det;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * ab.x, y: a.y + t * ab.y } : null;
  };
  const crossingObservations: { routes: string[]; point: Point }[] = [];
  for (let i = 0; i < routes.length; i++)
    for (const other of routes.slice(i + 1)) {
      const route = routes[i];
      let hit: Point | null = null;
      for (let a = 1; a < route.samples.length && !hit; a++)
        for (let b = 1; b < other.samples.length && !hit; b++) {
          const p = cross(
            route.samples[a - 1],
            route.samples[a],
            other.samples[b - 1],
            other.samples[b],
          );
          if (
            p &&
            route.painted(p) &&
            other.painted(p) &&
            ![route.samples[0], route.samples.at(-1)!].some(
              (end) =>
                distance(p, end) < 0.1 &&
                [other.samples[0], other.samples.at(-1)!].some((q) => distance(p, q) < 0.1),
            )
          )
            hit = p;
        }
      if (hit) crossingObservations.push({ routes: [route.id, other.id], point: hit });
    }
  return {
    coordinateSpace: 'CSS screen pixels',
    frame: bounds(svg),
    nodes: nodes.map(({ shapes, ...n }) => ({ ...n, shapeCount: shapes.length })),
    labels,
    groups,
    routes: routes.map(({ painted: _painted, ...route }) => route),
    crossingObservations,
  };
}

for (const fixture of fixtures)
  for (const width of [960, 320])
    for (const theme of ['light', 'dark'] as const)
      for (const motion of fixture.id === 'edge-subgraph-siblings' &&
      width === 320 &&
      theme === 'light'
        ? ['reduced', 'full']
        : ['reduced']) {
        test(`grouped routing terminal gap ${fixture.id} at ${width}px in ${theme} with ${motion} motion`, async ({
          page,
        }, testInfo) => {
          test.setTimeout(120_000);
          await page.setViewportSize({ width: 1280, height: 1000 });
          await page.emulateMedia({
            colorScheme: theme,
            reducedMotion: motion === 'full' ? 'no-preference' : 'reduce',
          });
          await page.goto(
            `${baseUrl}/sandbox/diagram-workbench?state=${fixture.id}&cases=target&width=${width}&theme=${theme}&motion=${motion}`,
            { waitUntil: 'domcontentloaded' },
          );
          await page.waitForFunction(
            (id) => {
              const root = document.getElementById(id);
              const renderer = root?.querySelector<HTMLElement>('.mermaid-renderer');
              const svg = renderer?.querySelector<SVGSVGElement>('.mermaid-svg > svg');
              return (
                document
                  .querySelector('[data-testid="catalog-scene"]')
                  ?.getAttribute('data-preview-stable') === 'true' &&
                renderer?.dataset.renderSettled === 'true' &&
                svg?.dataset.layoutSettled === 'true' &&
                svg.dataset.layoutGeneration === renderer.dataset.renderGeneration
              );
            },
            fixture.id,
            { timeout: 90_000 },
          );
          const svg = page.locator(`#${fixture.id} .mermaid-svg > svg`);
          await page.evaluate(() => document.fonts.ready);
          const geometry = await svg.evaluate(groupedGeometry);
          const jsonPath = testInfo.outputPath('grouped-routing-geometry.json');
          const svgPath = testInfo.outputPath('grouped-routing.svg');
          const pngPath = testInfo.outputPath('grouped-routing.png');
          await writeFile(
            jsonPath,
            JSON.stringify({ fixture: fixture.id, width, theme, motion, geometry }, null, 2),
          );
          const styled = await svg.evaluate((element) => {
            const clone = element.cloneNode(true) as SVGSVGElement;
            const originals = [element, ...element.querySelectorAll('*')],
              copies = [clone, ...clone.querySelectorAll('*')];
            originals.forEach((original, i) => {
              const s = getComputedStyle(original);
              copies[i].setAttribute(
                'style',
                [...s].map((key) => `${key}:${s.getPropertyValue(key)};`).join(''),
              );
            });
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            return new XMLSerializer().serializeToString(clone);
          });
          await writeFile(svgPath, styled);
          await testInfo.attach('grouped-routing-geometry', {
            path: jsonPath,
            contentType: 'application/json',
          });
          await testInfo.attach('grouped-routing-svg', {
            path: svgPath,
            contentType: 'image/svg+xml',
          });
          const originalViewport = page.viewportSize()!;
          const drawing = (await svg.boundingBox())!;
          const ancestors = await svg.evaluateHandle((element) => {
            const saved: {
              element: HTMLElement;
              style: string | null;
              left: number;
              top: number;
            }[] = [];
            for (let parent = element.parentElement; parent; parent = parent.parentElement)
              saved.push({
                element: parent,
                style: parent.getAttribute('style'),
                left: parent.scrollLeft,
                top: parent.scrollTop,
              });
            for (const { element } of saved)
              element.style.setProperty('overflow', 'visible', 'important');
            return saved;
          });
          try {
            await page.setViewportSize({
              width: Math.ceil(drawing.width * 2 + originalViewport.width),
              height: Math.ceil(drawing.height + originalViewport.height),
            });
            await svg.screenshot({ path: pngPath });
          } finally {
            await page.setViewportSize(originalViewport);
            await ancestors.evaluate((saved) => {
              for (const { element, style } of saved) {
                if (style === null) element.removeAttribute('style');
                else element.setAttribute('style', style);
              }
              for (const { element, left, top } of saved) {
                element.scrollLeft = left;
                element.scrollTop = top;
              }
            });
            await ancestors.dispose();
          }
          await testInfo.attach('grouped-routing-diagram', {
            path: pngPath,
            contentType: 'image/png',
          });

          // Every assertion follows the complete evidence bundle, even for bad gaps.
          expect(Object.fromEntries(geometry.nodes.map((n) => [n.id, n.text]))).toEqual(
            fixture.nodes,
          );
          expect(geometry.nodes).toHaveLength(Object.keys(fixture.nodes).length);
          expect(geometry.routes.map((r) => r.edge).sort()).toEqual([...fixture.edges].sort());
          expect(
            geometry.labels
              .filter((l) => l.owner)
              .map((l) => l.text)
              .sort(),
          ).toEqual([...fixture.labels].sort());
          expect(geometry.nodes.every((n) => n.visible && n.shapeCount > 0)).toBe(true);
          expect(geometry.labels.every((l) => l.visible && l.glyphs.length > 0)).toBe(true);
          expect(geometry.groups.map((g) => g.label).sort()).toEqual(
            fixture.groups.map((g) => g.label).sort(),
          );
          for (const group of fixture.groups) {
            const actual = geometry.groups.find((g) => g.label === group.label)!;
            expect(actual.visible).toBe(true);
            expect(actual.contained.sort()).toEqual([...group.members].sort());
          }
          for (const label of geometry.labels.filter((item) => item.owner)) {
            const route = geometry.routes.find((item) => item.id.endsWith(label.owner!))!;
            for (const group of geometry.groups.filter(
              (item) =>
                item.contained.includes(route.source!) && item.contained.includes(route.target!),
            )) {
              expect(
                label.glyphs.every(
                  (glyph) =>
                    glyph.left >= group.bounds.left - 0.75 &&
                    glyph.right <= group.bounds.right + 0.75 &&
                    glyph.top >= group.bounds.top - 0.75 &&
                    glyph.bottom <= group.bounds.bottom + 0.75,
                ),
                `${label.text} remains inside ${group.label}`,
              ).toBe(true);
            }
          }
          if (fixture.id === 'edge-subgraph-siblings')
            expect(geometry.crossingObservations, 'shared dependency wires stay separate').toEqual(
              [],
            );
          for (const route of geometry.routes) {
            expect(
              route.visible && route.length > 0 && route.paintedSampleCount > 0,
              route.id,
            ).toBe(true);
            expect(
              route.terminal,
              `${route.id} native target and marker must be measurable`,
            ).not.toBeNull();
            if (!route.terminal) continue;
            expect(route.terminal.gap, `${route.id} positive painted gap`).toBeGreaterThan(0);
            expect(route.terminal.gap, `${route.id} painted gap ≤8 CSS pixels`).toBeLessThanOrEqual(
              8,
            );
            expect(
              route.terminal.towardOutline,
              `${route.id} inward terminal tangent`,
            ).toBeGreaterThan(0);
            expect(route.terminal.entersFill, `${route.id} tangent enters native target fill`).toBe(
              true,
            );
            expect(route.nodeHits, `${route.id} unrelated native node fill hits`).toEqual([]);
            expect(route.textHits, `${route.id} visible text hits`).toEqual([]);
            if (fixture.id === 'edge-subgraph-siblings') {
              const source = geometry.nodes.find((node) => node.id === route.source)!;
              const target = geometry.nodes.find((node) => node.id === route.target)!;
              expect(
                source.bounds.bottom,
                `${route.id} keeps its downward reading direction`,
              ).toBeLessThan(target.bounds.top);
              for (const other of geometry.routes) {
                if (other === route || other.target !== route.target || !other.terminal) continue;
                const a = route.terminal.tip,
                  b = other.terminal.tip;
                expect(
                  Math.hypot(a.x - b.x, a.y - b.y),
                  `${route.id} and ${other.id} distinct arrow landing points`,
                ).toBeGreaterThanOrEqual(8);
              }
              const samples = route.samples;
              let turn = 0;
              for (let i = 1; i + 1 < samples.length; i++) {
                const a = samples[i - 1],
                  b = samples[i],
                  c = samples[i + 1];
                const ux = b.x - a.x,
                  uy = b.y - a.y,
                  vx = c.x - b.x,
                  vy = c.y - b.y;
                turn += Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
              }
              expect(turn, `${route.id} avoids looping around its group title`).toBeLessThanOrEqual(
                2,
              );
              const length = samples
                .slice(1)
                .reduce((sum, p, i) => sum + Math.hypot(p.x - samples[i].x, p.y - samples[i].y), 0);
              const a = samples[0],
                b = samples[samples.length - 1];
              expect(
                length / Math.hypot(b.x - a.x, b.y - a.y),
                `${route.id} route length relative to its endpoints`,
              ).toBeLessThanOrEqual(1.5);
            }
          }
          // The full header/crossing evidence remains in JSON for gallery comparison.
        });
      }
