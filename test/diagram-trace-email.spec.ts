import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running preview server.');

const expectedNodes = {
  U: 'Customer',
  UI: 'Console: existing Settings page',
  ST: 'Trace staff',
  WUI: 'Console: staff Waitlist',
  API: 'Trace API',
  R: 'Cluster review stores: saved visible cases',
  N: 'Case notifier inside Trace API',
  P: 'PostgreSQL: preferences, waitlist, notification records',
  C: 'Typed email client',
  E: 'trace-email: Rust service',
  Q: 'PostgreSQL: outgoing message queue',
  M: 'Mailgun',
  I: 'Recipient inbox',
};
const expectedEdges = [
  'U-->UI',
  'ST-->WUI',
  'UI-->API',
  'WUI-->API',
  'R-->N',
  'API-->P',
  'N-->P',
  'API-->C',
  'N-->C',
  'C-->E',
  'E-->Q',
  'Q-->E',
  'E-->M',
  'M-->I',
  'E-->N',
];

// Screen-space measurements deliberately use the final SVG paths and actual text
// ranges. Dagre and ELK may change bends, IDs' prefixes, and layout metadata.
function readTraceGeometry(svg: SVGSVGElement) {
  const box = (element: Element) => element.getBoundingClientRect().toJSON() as DOMRect;
  const contains = (outer: DOMRect, inner: DOMRect) =>
    inner.left >= outer.left - 0.75 &&
    inner.right <= outer.right + 0.75 &&
    inner.top >= outer.top - 0.75 &&
    inner.bottom <= outer.bottom + 0.75;
  const overlaps = (a: DOMRect, b: DOMRect) =>
    a.left < b.right - 0.5 &&
    a.right > b.left + 0.5 &&
    a.top < b.bottom - 0.5 &&
    a.bottom > b.top + 0.5;
  const frame = box(svg);
  const visible = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        return false;
      if (current === svg) break;
    }
    return true;
  };
  const labels = [
    ...svg.querySelectorAll<SVGGraphicsElement>('g.node .label, .edgeLabels > .edgeLabel'),
  ]
    .filter((label) => label.textContent?.trim())
    .map((label) => {
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      const glyphs: DOMRect[] = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        glyphs.push(...[...range.getClientRects()].filter((rect) => rect.width && rect.height));
      }
      const foreignObject = label.querySelector('foreignObject');
      const node = label.closest('g.node');
      const shape = node?.querySelector(':scope > .label-container');
      const bounds = box(label);
      const clips = [
        frame,
        bounds,
        ...(foreignObject ? [box(foreignObject)] : []),
        ...(shape ? [box(shape)] : []),
      ];
      return {
        node: node?.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? null,
        text: label.textContent!.replace(/\s+/g, ' ').trim(),
        visible: visible(label),
        bounds,
        glyphs: glyphs.map((rect) => rect.toJSON() as DOMRect),
        clipped: glyphs.filter((rect) => clips.some((clip) => !contains(clip, rect))).length,
      };
    });
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
    id: node.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? node.id,
    bounds: box(node.querySelector(':scope > .label-container') ?? node),
  }));
  const paths = [...svg.querySelectorAll<SVGPathElement>('path.flowchart-link')];
  const routes = paths.map((path) => {
    const identity = path.id.match(/(?:^|-)L_([^_]+)_([^_]+)_\d+$/);
    const source =
      [...path.classList].find((name) => name.startsWith('LS_'))?.slice(3) ?? identity?.[1];
    const target =
      [...path.classList].find((name) => name.startsWith('LE_'))?.slice(3) ?? identity?.[2];
    const length = path.getTotalLength();
    const matrix = path.getScreenCTM()!;
    const scale = Math.hypot(matrix.a, matrix.b);
    const count = Math.max(1, Math.ceil(length * scale * 2));
    const samples = Array.from({ length: count + 1 }, (_, index) => {
      const point = path.getPointAtLength((length * index) / count).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    const strokeRadius = (parseFloat(getComputedStyle(path).strokeWidth) * scale) / 2;
    const hits = (bounds: DOMRect) =>
      samples.some(
        (p) =>
          p.x > bounds.left - strokeRadius + 0.25 &&
          p.x < bounds.right + strokeRadius - 0.25 &&
          p.y > bounds.top - strokeRadius + 0.25 &&
          p.y < bounds.bottom + strokeRadius - 0.25,
      );
    return {
      edge: `${source}-->${target}`,
      d: path.getAttribute('d'),
      visible: visible(path) && getComputedStyle(path).stroke !== 'none',
      length,
      samples,
      marker: path.getAttribute('marker-end'),
      clipped: samples.some(
        (p) =>
          p.x - strokeRadius < frame.left - 0.75 ||
          p.x + strokeRadius > frame.right + 0.75 ||
          p.y - strokeRadius < frame.top - 0.75 ||
          p.y + strokeRadius > frame.bottom + 0.75,
      ),
      nodeHits: nodes
        .filter((node) => node.id !== source && node.id !== target && hits(node.bounds))
        .map((node) => node.id),
      // E-->N owns the only edge label; crossing its own knockout is allowed.
      textHits: labels
        .filter(
          (label) =>
            !(label.node === null && source === 'E' && target === 'N') && label.glyphs.some(hits),
        )
        .map((label) => label.text),
    };
  });
  const edgeLabels = labels.filter((label) => label.node === null);
  const viewport = svg.closest('.mermaid-svg-viewport') as HTMLElement;
  return {
    frame,
    nodes,
    labels,
    routes,
    labelNodeHits: edgeLabels.flatMap((label) =>
      nodes
        .filter((node) => overlaps(label.bounds, node.bounds))
        .map((node) => ({ text: label.text, node: node.id })),
    ),
    nodeOverlaps: nodes.flatMap((node, index) =>
      nodes
        .slice(index + 1)
        .filter((other) => overlaps(node.bounds, other.bounds))
        .map((other) => [node.id, other.id]),
    ),
    viewport: { clientWidth: viewport.clientWidth, scrollWidth: viewport.scrollWidth },
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

for (const width of [960, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`Trace email labels and return clearance at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(
        `${baseUrl}/sandbox/diagram-workbench?state=mermaid-trace-email&cases=target&width=${width}&theme=${theme}&motion=reduced`,
        { waitUntil: 'domcontentloaded' },
      );
      await expect(page.getByTestId('catalog-scene')).toHaveAttribute(
        'data-preview-stable',
        'true',
        { timeout: 90_000 },
      );
      const renderer = page.locator('#mermaid-trace-email .mermaid-renderer');
      await expect(renderer).toHaveAttribute('data-render-settled', 'true');
      const svg = renderer.locator('.mermaid-svg > svg[data-layout-settled="true"]');
      await expect(svg).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await svg.evaluate(readTraceGeometry);
      const geometryPath = testInfo.outputPath('trace-email-geometry.json');
      await writeFile(geometryPath, JSON.stringify({ width, theme, geometry }, null, 2));
      await testInfo.attach('trace-email-geometry', {
        path: geometryPath,
        contentType: 'application/json',
      });
      const screenshotPath = testInfo.outputPath(`trace-email-${width}-${theme}.png`);
      const originalViewport = page.viewportSize()!;
      const drawing = (await svg.boundingBox())!;
      await page.setViewportSize({
        width: Math.ceil(drawing.width * 2 + originalViewport.width),
        height: Math.ceil(drawing.height + originalViewport.height),
      });
      // Locator screenshots retain ancestor overflow clips. Temporarily expose
      // the whole drawing only after measuring the real scrollable layout.
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
        for (const { element } of saved) {
          element.style.setProperty('overflow', 'visible', 'important');
        }
        return saved;
      });
      try {
        await svg.screenshot({ path: screenshotPath });
      } finally {
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
        await page.setViewportSize(originalViewport);
      }
      await testInfo.attach('trace-email-diagram', {
        path: screenshotPath,
        contentType: 'image/png',
      });
      const viewport = renderer.locator('.mermaid-svg-viewport');
      for (const side of ['left', 'right'] as const) {
        await viewport.evaluate((element, side) => {
          element.scrollLeft = side === 'left' ? 0 : element.scrollWidth - element.clientWidth;
        }, side);
        await expect
          .poll(() =>
            viewport.evaluate(
              (element, side) =>
                Math.abs(
                  element.scrollLeft -
                    (side === 'left' ? 0 : element.scrollWidth - element.clientWidth),
                ),
              side,
            ),
          )
          .toBeLessThanOrEqual(1);
        await viewport.screenshot({ path: testInfo.outputPath(`trace-email-${side}.png`) });
      }
      expect(geometry.routes.map((route) => route.edge).sort()).toEqual([...expectedEdges].sort());
      expect(
        geometry.routes.some((route) => route.d?.includes('C')),
        'keeps curved connectors',
      ).toBe(true);
      expect(geometry.nodes.map((node) => node.id).sort()).toEqual(
        Object.keys(expectedNodes).sort(),
      );
      expect(
        Object.fromEntries(
          geometry.labels.filter((label) => label.node).map((label) => [label.node, label.text]),
        ),
      ).toEqual(expectedNodes);
      expect(geometry.labels.filter((label) => !label.node).map((label) => label.text)).toEqual([
        'Recheck recurring case messages',
      ]);
      for (const label of geometry.labels) {
        expect(label.visible, label.text).toBe(true);
        expect(label.glyphs.length, label.text).toBeGreaterThan(0);
        expect(label.clipped, `${label.text} has complete text`).toBe(0);
      }
      for (const route of geometry.routes) {
        expect(route.visible, route.edge).toBe(true);
        expect(route.length, route.edge).toBeGreaterThan(0);
        expect(route.marker, `${route.edge} keeps its arrow`).toBeTruthy();
        expect(route.clipped, route.edge).toBe(false);
        expect(route.nodeHits, `${route.edge} avoids unrelated nodes`).toEqual([]);
        expect(route.textHits, `${route.edge} avoids visible text`).toEqual([]);
      }
      expect(
        geometry.labelNodeHits,
        'return label clears every node, including Mailgun and inbox',
      ).toEqual([]);
      expect(geometry.nodeOverlaps).toEqual([]);
      expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
    });
  }
}
