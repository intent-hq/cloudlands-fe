import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running preview server.');

// Independent content contracts prevent solving collisions by dropping routes,
// labels, arrows, or difficult shapes. Repeated endpoints remain a multiset.
const fixtures = [
  {
    id: 'edge-braided-diamonds',
    nodes: ['Request', 'Identity valid?', 'Policy allows?', 'Accepted', 'Review', 'Audit'],
    edges: ['A>B', 'A>C', 'B>D', 'B>E', 'C>D', 'C>E', 'E>B', 'D>F', 'E>F'],
    labels: ['Yes', 'No', 'Yes', 'No', 'Appeal'],
  },
  {
    id: 'edge-three-parallel-labels',
    nodes: ['Client', 'Service'],
    edges: ['A>B', 'A>B', 'A>B', 'B>A'],
    labels: ['Request', 'Metadata', 'Priority', 'Response'],
  },
  {
    id: 'mermaid-retry-and-exit',
    nodes: ['Submit proof', 'Proof accepted?', 'Connect', 'Leave invitation', 'Open workspace'],
    edges: ['A>B', 'B>C', 'B>A', 'B>D', 'C>E'],
    labels: ['Yes', 'Try again', 'Cancel'],
  },
  {
    id: 'edge-two-feedback-loops',
    nodes: ['Receive', 'Validate', 'Transform', 'Write', 'Publish'],
    edges: ['A>B', 'B>C', 'C>D', 'D>E', 'C>B', 'E>D', 'E>A'],
    labels: ['Invalid mapping', 'Retry delivery', 'Replay from source'],
  },
  {
    id: 'edge-mixed-node-shapes',
    nodes: ['Start', 'Input', 'Check', 'Subroutine', 'Database', 'Event', 'Prepare', 'End'],
    edges: ['A>B', 'B>C', 'C>D', 'D>E', 'E>F', 'F>G', 'G>H'],
    labels: [],
  },
];

// Failure modes: false junctions (including collinear shared segments), unrelated
// shape fill hits, foreign text hits, and missing/hidden content. All collision
// coordinates are CSS screen pixels; inverse CTMs are used only for native SVG
// fill/stroke queries. No production routing metadata supplies the geometry.
function readRoutingGeometry(svg: SVGSVGElement) {
  type Point = { x: number; y: number };
  const box = (element: Element) => element.getBoundingClientRect().toJSON() as DOMRect;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const inside = (p: Point, b: DOMRect) =>
    p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
  const visible = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
        return false;
      if (current === svg) break;
    }
    return true;
  };
  const normalize = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const nodeId = (node: Element) => node.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? node.id;
  const frame = box(svg);
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => {
    const shapes = [
      ...node.querySelectorAll<SVGGeometryElement>('path, rect, polygon, circle, ellipse'),
    ]
      .filter(
        (shape) =>
          !shape.closest('.label') && visible(shape) && getComputedStyle(shape).fill !== 'none',
      )
      .map((shape) => ({ shape, inverse: shape.getScreenCTM()!.inverse() }));
    return {
      id: nodeId(node),
      text: normalize(node),
      visible: visible(node),
      bounds: box(node),
      shapes,
    };
  });
  const labels = [...svg.querySelectorAll<SVGGElement>('g.node .label, .edgeLabels > .edgeLabel')]
    .filter((label) => normalize(label))
    .map((label) => {
      const glyphs: DOMRect[] = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.parentElement || !visible(text.parentElement)) continue;
        for (let i = 0; i < (text.textContent?.length ?? 0); i++) {
          if (!text.textContent![i].trim()) continue;
          const range = document.createRange();
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          glyphs.push(
            ...[...range.getClientRects()]
              .filter((r) => r.width > 0 && r.height > 0)
              .map((r) => r.toJSON() as DOMRect),
          );
        }
      }
      return {
        text: normalize(label),
        node: label.closest('g.node') ? nodeId(label.closest('g.node')!) : null,
        owner: label.querySelector(':scope > .label[data-id]')?.getAttribute('data-id') ?? null,
        visible: visible(label),
        bounds: box(label),
        glyphs,
      };
    });
  const routes = [...svg.querySelectorAll<SVGPathElement>('path.flowchart-link')].map((path) => {
    const identity = path.id.match(/(?:^|-)L_([^_]+)_([^_]+)_\d+$/);
    const source =
      [...path.classList].find((name) => name.startsWith('LS_'))?.slice(3) ?? identity?.[1];
    const target =
      [...path.classList].find((name) => name.startsWith('LE_'))?.slice(3) ?? identity?.[2];
    const matrix = path.getScreenCTM()!;
    const inverse = matrix.inverse();
    const length = path.getTotalLength();
    // Largest singular-value bound also handles nonuniform scaling/skew. At
    // most 0.5 screen pixels between samples, even for thick or curved paths.
    const scaleBound = Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d);
    const count = Math.max(1, Math.ceil(length * scaleBound * 2));
    const samples = Array.from({ length: count + 1 }, (_, index) => {
      const p = path.getPointAtLength((length * index) / count).matrixTransform(matrix);
      return { x: p.x, y: p.y };
    });
    const style = getComputedStyle(path);
    const radius =
      (parseFloat(style.strokeWidth) *
        (style.vectorEffect === 'non-scaling-stroke' ? 1 : scaleBound)) /
      2;
    const owner = path.id.match(/(?:^|-)(L_.+)$/)?.[1] ?? path.id;
    const ownLabel = labels.find((label) => label.owner === owner);
    const routeVisible =
      visible(path) && style.stroke !== 'none' && Number(style.strokeOpacity) > 0;
    const painted = (p: Point) =>
      routeVisible &&
      // Only this route's own label knockout may mask its stroke. Other
      // labels must still report collisions, even when their background hides it.
      !(ownLabel?.visible && inside(p, ownLabel.bounds)) &&
      path.isPointInStroke(new DOMPoint(p.x, p.y).matrixTransform(inverse));
    const marker = path.getAttribute('marker-end');
    const markerId = marker?.match(/#([^)'"\s]+)/)?.[1];
    const markerElement = markerId ? svg.querySelector(`marker[id="${markerId}"]`) : null;
    const arrowShapes = markerElement
      ? [
          ...markerElement.querySelectorAll<SVGGeometryElement>(
            'path, polygon, polyline, circle, ellipse, rect, line',
          ),
        ]
      : [];
    const arrowPresent = arrowShapes.some((shape) => {
      const s = getComputedStyle(shape);
      return (
        visible(shape) && (s.fill !== 'none' || s.stroke !== 'none') && shape.getTotalLength() > 0
      );
    });
    // Sample across stroke width as well as down the center, so grazing a
    // diamond, cylinder or glyph is caught without substituting a node AABB.
    const paintedSamples = samples.flatMap((p, i) => {
      const a = samples[Math.max(0, i - 1)];
      const b = samples[Math.min(samples.length - 1, i + 1)];
      const span = distance(a, b) || 1;
      const steps = Math.max(1, Math.ceil(radius * 4));
      return Array.from({ length: steps * 2 + 1 }, (_, n) => {
        const offset = (n / steps - 1) * radius * 0.95;
        return { x: p.x - ((b.y - a.y) / span) * offset, y: p.y + ((b.x - a.x) / span) * offset };
      }).filter(painted);
    });
    const nodeHits = nodes
      .filter((node) => node.id !== source && node.id !== target)
      .flatMap((node) => {
        const point = paintedSamples.find(
          (p) =>
            inside(p, node.bounds) &&
            node.shapes.some(({ shape, inverse }) =>
              shape.isPointInFill(new DOMPoint(p.x, p.y).matrixTransform(inverse)),
            ),
        );
        return point ? [{ node: node.id, point }] : [];
      });
    const textHits = labels
      .filter((label) => label.owner !== owner)
      .flatMap((label) => {
        const point = paintedSamples.find((p) => label.glyphs.some((glyph) => inside(p, glyph)));
        return point ? [{ text: label.text, owner: label.owner, node: label.node, point }] : [];
      });
    return {
      id: path.id,
      owner,
      source,
      target,
      edge: `${source}>${target}`,
      d: path.getAttribute('d'),
      length,
      radius,
      samples,
      marker,
      arrowPresent,
      visible: routeVisible,
      paintedSampleCount: paintedSamples.length,
      clippedSamples: paintedSamples.filter((p) => !inside(p, frame)).length,
      nodeHits,
      textHits,
      painted,
    };
  });
  // Closest segment points catch perpendicular crossings, shallow crossings,
  // exact sampled-vertex contacts and collinear overlap. Native stroke queries
  // at the candidate reject dash gaps and near misses.
  const nearest = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
    return { x: a.x + t * dx, y: a.y + t * dy };
  };
  const crossings: { routes: string[]; point: Point }[] = [];
  for (let i = 0; i < routes.length; i++) {
    const a = routes[i];
    for (const b of routes.slice(i + 1)) {
      const shared = [a.samples[0], a.samples.at(-1)!].filter((p) =>
        [b.samples[0], b.samples.at(-1)!].some((q) => distance(p, q) <= 0.1),
      );
      let hit: Point | undefined;
      for (let ai = 1; ai < a.samples.length && !hit; ai++) {
        const p = a.samples[ai - 1],
          q = a.samples[ai];
        for (let bi = 1; bi < b.samples.length && !hit; bi++) {
          const r = b.samples[bi - 1],
            s = b.samples[bi];
          const padding = a.radius + b.radius;
          if (
            Math.max(p.x, q.x) + padding < Math.min(r.x, s.x) ||
            Math.max(r.x, s.x) + padding < Math.min(p.x, q.x) ||
            Math.max(p.y, q.y) + padding < Math.min(r.y, s.y) ||
            Math.max(r.y, s.y) + padding < Math.min(p.y, q.y)
          )
            continue;
          const candidates: Point[] = [];
          const dx = q.x - p.x,
            dy = q.y - p.y;
          const ex = s.x - r.x,
            ey = s.y - r.y;
          const determinant = dx * ey - dy * ex;
          if (Math.abs(determinant) > 1e-10) {
            const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / determinant;
            const u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / determinant;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
              candidates.push({ x: p.x + t * dx, y: p.y + t * dy });
          }
          for (const [point, start, end] of [
            [p, r, s],
            [q, r, s],
            [r, p, q],
            [s, p, q],
          ]) {
            const closest = nearest(point, start, end);
            candidates.push({ x: (point.x + closest.x) / 2, y: (point.y + closest.y) / 2 });
          }
          hit = candidates.find(
            (point) =>
              // Exempt only the stroke cap at a genuinely shared endpoint,
              // never the whole source/target node or a shared route section.
              !shared.some((end) => distance(point, end) <= Math.max(a.radius, b.radius) + 0.1) &&
              a.painted(point) &&
              b.painted(point),
          );
        }
      }
      if (hit) crossings.push({ routes: [a.id, b.id], point: hit });
    }
  }
  return {
    coordinateSpace: 'CSS screen pixels',
    sampleStepMaximum: 0.5,
    frame,
    nodes: nodes.map(({ shapes, ...node }) => ({ ...node, shapeCount: shapes.length })),
    labels,
    routes: routes.map(({ painted: _painted, ...route }) => route),
    crossings,
  };
}

for (const fixture of fixtures) {
  for (const width of [960, 320]) {
    for (const theme of ['light', 'dark']) {
      test(`routing overlap ${fixture.id} at ${width}px in ${theme}`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.goto(
          `${baseUrl}/sandbox/diagram-workbench?state=${fixture.id}&cases=target&width=${width}&theme=${theme}&motion=reduced`,
          { waitUntil: 'domcontentloaded' },
        );
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="catalog-scene"]')
              ?.getAttribute('data-preview-stable') === 'true',
          null,
          { timeout: 90_000 },
        );
        const renderer = page.locator(`#${fixture.id} .mermaid-renderer`);
        await page.waitForFunction(
          (id) =>
            document
              .querySelector(`#${id} .mermaid-renderer`)
              ?.getAttribute('data-render-settled') === 'true',
          fixture.id,
        );
        await renderer.locator('[data-layout-settled="true"]').waitFor({ state: 'visible' });
        const svg = renderer.locator('.mermaid-svg > svg[data-layout-settled="true"]');
        await page.evaluate(() => document.fonts.ready);
        const geometry = await svg.evaluate(readRoutingGeometry);
        const geometryPath = testInfo.outputPath('routing-overlap-geometry.json');
        const svgPath = testInfo.outputPath('routing-overlap.svg');
        const pngPath = testInfo.outputPath('routing-overlap.png');
        await writeFile(
          geometryPath,
          JSON.stringify({ fixture: fixture.id, width, theme, geometry }, null, 2),
        );
        // Inline computed styles make the saved SVG independent of app CSS.
        const serialized = await svg.evaluate((element) => {
          const clone = element.cloneNode(true) as SVGSVGElement;
          const originals = [element, ...element.querySelectorAll('*')];
          const copies = [clone, ...clone.querySelectorAll('*')];
          originals.forEach((original, i) => {
            const style = getComputedStyle(original);
            copies[i].setAttribute(
              'style',
              [...style].map((key) => `${key}:${style.getPropertyValue(key)};`).join(''),
            );
          });
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          return new XMLSerializer().serializeToString(clone);
        });
        await writeFile(svgPath, serialized);
        await testInfo.attach('routing-overlap-geometry', {
          path: geometryPath,
          contentType: 'application/json',
        });
        await testInfo.attach('routing-overlap-svg', {
          path: svgPath,
          contentType: 'image/svg+xml',
        });
        // Measure first, then expose the whole drawing for the complete-image
        // capture. Preserve the real width constraint, styles and scroll state.
        const originalViewport = page.viewportSize()!;
        const drawing = (await svg.boundingBox())!;
        const ancestors = await svg.evaluateHandle((element) => {
          const saved: {
            element: HTMLElement;
            style: string | null;
            scrollLeft: number;
            scrollTop: number;
          }[] = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            saved.push({
              element: parent,
              style: parent.getAttribute('style'),
              scrollLeft: parent.scrollLeft,
              scrollTop: parent.scrollTop,
            });
          }
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
            for (const { element, scrollLeft, scrollTop } of saved) {
              element.scrollLeft = scrollLeft;
              element.scrollTop = scrollTop;
            }
          });
          await ancestors.dispose();
        }
        await testInfo.attach('routing-overlap-diagram', {
          path: pngPath,
          contentType: 'image/png',
        });

        // All evidence is durable before the first content/collision assertion.
        expect(geometry.nodes.map((node) => node.text).sort()).toEqual([...fixture.nodes].sort());
        expect(geometry.routes.map((route) => route.edge).sort()).toEqual(
          [...fixture.edges].sort(),
        );
        expect(
          geometry.labels
            .filter((label) => label.node === null)
            .map((label) => label.text)
            .sort(),
        ).toEqual([...fixture.labels].sort());
        expect(geometry.nodes.every((node) => node.visible && node.shapeCount > 0)).toBe(true);
        expect(geometry.labels.every((label) => label.visible && label.glyphs.length > 0)).toBe(
          true,
        );
        expect(
          geometry.labels
            .filter((label) => label.node === null)
            .every(
              (label) =>
                label.owner && geometry.routes.some((route) => route.owner === label.owner),
            ),
        ).toBe(true);
        expect(
          geometry.routes.every(
            (route) =>
              route.visible &&
              route.length > 0 &&
              route.arrowPresent &&
              route.paintedSampleCount > 0,
          ),
        ).toBe(true);
        expect(geometry.crossings, 'painted routes must not cross or share segments').toEqual([]);
        expect(
          geometry.routes.filter((route) => route.clippedSamples > 0).map((route) => route.edge),
          'painted curves must remain inside the final SVG bounds',
        ).toEqual([]);
        expect(
          geometry.routes.flatMap((route) =>
            route.nodeHits.map((hit) => ({ route: route.id, ...hit })),
          ),
          'painted strokes must clear unrelated node fills',
        ).toEqual([]);
        expect(
          geometry.routes.flatMap((route) =>
            route.textHits.map((hit) => ({ route: route.id, ...hit })),
          ),
          'painted strokes must clear glyphs outside their own data-id label knockout',
        ).toEqual([]);
      });
    }
  }
}
