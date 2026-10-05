import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

// Sample the final painted centerlines after renderer settlement, not router
// datasets: later clearance, rounding and terminal passes must retain the order.
function feedbackGeometry(svg: SVGSVGElement) {
  const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
  const route = (source: string, target: string) =>
    paths.find((path) => new RegExp(`-L_${source}_${target}_[0-9]+$`).test(path.id))!;
  const node = (name: string) =>
    [...svg.querySelectorAll<SVGGElement>('g.node')].find((n) => n.textContent?.trim() === name)!;
  const shape = (name: string) =>
    node(name).querySelector<SVGGeometryElement>(':scope > .label-container')!;
  const sample = (path: SVGPathElement) => {
    const length = path.getTotalLength();
    const matrix = path.getScreenCTM()!;
    const count = Math.ceil(length * Math.hypot(matrix.a, matrix.b) * 4);
    return Array.from({ length: count + 1 }, (_, i) =>
      path.getPointAtLength((length * i) / count).matrixTransform(matrix),
    );
  };
  const feedback = route('G', 'A');
  const annotate = route('C', 'E');
  const outer = sample(feedback);
  const inner = sample(annotate);
  const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
  const ownLabel = (path: SVGPathElement) =>
    labels.find(
      (label) =>
        label.dataset.routePathId === path.id ||
        label.querySelector('[data-id]')?.getAttribute('data-id') ===
          path.id.match(/-(L_.+)$/)?.[1],
    );
  const inside = (p: DOMPoint, box: DOMRect) =>
    p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom;
  const inspect = (path: SVGPathElement, points: DOMPoint[], ends: string[]) => ({
    id: path.id,
    d: path.getAttribute('d'),
    routingPoints: path.dataset.manhattanPoints,
    left: Math.min(...points.map((p) => p.x)),
    start: { x: points[0].x, y: points[0].y },
    end: { x: points.at(-1)!.x, y: points.at(-1)!.y },
    label: ownLabel(path)?.textContent?.trim(),
    nodeHits: [...svg.querySelectorAll<SVGGElement>('g.node')]
      .filter((n) => !ends.includes(n.textContent?.trim() ?? ''))
      .filter((n) => points.some((p) => inside(p, n.getBoundingClientRect())))
      .map((n) => n.textContent?.trim()),
    labelHits: labels
      .filter((label) => label !== ownLabel(path) && label.textContent?.trim())
      .filter((label) => points.some((p) => inside(p, label.getBoundingClientRect())))
      .map((label) => label.textContent?.trim()),
    marker: path.getAttribute('marker-end'),
  });
  const source = shape('Source').getBoundingClientRect();
  const forwardPorts = [route('A', 'B'), route('A', 'C'), route('A', 'D')]
    .map((path) => path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!))
    .toSorted((a, b) => a.x - b.x);
  const end = outer.at(-1)!;
  const previous = outer.at(-2)!;
  const direction = { x: end.x - previous.x, y: end.y - previous.y };
  const magnitude = Math.hypot(direction.x, direction.y);
  const entersSource = shape('Source').isPointInFill(
    new DOMPoint(
      end.x + (direction.x / magnitude) * 8,
      end.y + (direction.y / magnitude) * 8,
    ).matrixTransform(shape('Source').getScreenCTM()!.inverse()),
  );
  const annotateInverse = annotate.getScreenCTM()!.inverse();
  const viewport = svg.closest('.mermaid-svg-viewport') as HTMLElement;
  const bounds = svg.getBoundingClientRect();
  const nodeNames = new Map(
    [...svg.querySelectorAll<SVGGElement>('g.node')].map((n) => [
      n.id.match(/flowchart-(.+)-\d+$/)?.[1],
      n.textContent?.trim() ?? '',
    ]),
  );
  return {
    feedback: inspect(feedback, outer, ['Browser', 'Source']),
    annotate: inspect(annotate, inner, ['Diagnostics', 'Frame']),
    intersections: outer.filter((p) => annotate.isPointInStroke(p.matrixTransform(annotateInverse)))
      .length,
    source: source.toJSON(),
    nodes: [...svg.querySelectorAll<SVGGElement>('g.node')].map((n) => ({
      name: n.textContent?.trim(),
      bounds: n.getBoundingClientRect().toJSON(),
    })),
    forwardPortGaps: forwardPorts.slice(1).map((p, i) => p.x - forwardPorts[i].x),
    sourceEntryGap: Math.min(...forwardPorts.map((p) => Math.hypot(p.x - end.x, p.y - end.y))),
    entersSource,
    viewport: {
      clientWidth: viewport.clientWidth,
      scrollWidth: viewport.scrollWidth,
      overflowX: getComputedStyle(viewport).overflowX,
      leftInset: bounds.left - viewport.getBoundingClientRect().left,
      rightInset: viewport.getBoundingClientRect().right - bounds.right,
    },
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minimumFont: Math.min(
      ...[...svg.querySelectorAll<HTMLElement>('.nodeLabel, .edgeLabel p')].map(
        (text) =>
          parseFloat(getComputedStyle(text).fontSize) *
          Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b),
      ),
    ),
    paths: paths.map((path) => {
      const identity = path.id.match(/-L_([^_]+)_([^_]+)_\d+$/)!;
      return inspect(path, sample(path), [
        nodeNames.get(identity[1])!,
        nodeNames.get(identity[2])!,
      ]);
    }),
  };
}

for (const width of [960, 320]) {
  test(`keeps final feedback outside annotate at ${width}px`, async ({ page }, testInfo) => {
    const names = ['MermaidRenderer.svelte', 'mermaid-path-geometry.ts'];
    const responses = names.map((name) =>
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.endsWith(`/markdown/${name}`) && !url.searchParams.has('type');
      }),
    );
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=mermaid-dense-graph&theme=light&width=${width}&motion=reduced`,
      { waitUntil: 'domcontentloaded' },
    );
    const hashes: Record<string, string> = {};
    for (const [index, response] of responses.entries()) {
      const body = await (await response).text();
      const encoded = body.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
      expect(encoded).toBeTruthy();
      const map = JSON.parse(Buffer.from(encoded!, 'base64').toString());
      const source =
        map.sourcesContent[map.sources.findIndex((s: string) => s.endsWith(names[index]))];
      expect(source).toBe(await readFile(`src/lib/components/markdown/${names[index]}`, 'utf8'));
      hashes[names[index]] = createHash('sha256').update(source).digest('hex');
    }
    await writeFile(testInfo.outputPath('served-hashes.json'), JSON.stringify(hashes, null, 2));
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
      timeout: 30_000,
    });
    const root = page.locator('#mermaid-dense-graph');
    await expect(root.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
    const svg = root.locator('.mermaid-svg > svg');
    await expect(svg).toHaveAttribute('data-layout-settled', 'true');
    expect(await page.evaluate(() => window.__INTENT_PREVIEW__?.current())).toEqual({
      slug: 'diagram-workbench',
      state: 'mermaid-dense-graph',
      width,
      status: 'ready',
    });
    const geometry = await svg.evaluate(feedbackGeometry);
    await writeFile(testInfo.outputPath('geometry.json'), JSON.stringify(geometry, null, 2));
    await testInfo.attach('final-feedback-geometry', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    await svg.screenshot({ path: testInfo.outputPath(`feedback-${width}.png`) });
    const viewport = root.locator('.mermaid-svg-viewport');
    if (width === 320) {
      await viewport.hover();
      await page.mouse.wheel(10000, 0);
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollLeft))
        .toBe(geometry.viewport.scrollWidth - geometry.viewport.clientWidth);
      const right = await svg.evaluate(feedbackGeometry);
      expect(right.viewport.rightInset).toBeGreaterThanOrEqual(-1);
      await viewport.screenshot({ path: testInfo.outputPath('feedback-320-right.png') });
      await page.mouse.wheel(-10000, 0);
      await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0);
    }
    expect(geometry.paths).toHaveLength(11);
    expect(
      geometry.annotate.left - geometry.feedback.left,
      'outer return lane gap in CSS px',
    ).toBeGreaterThanOrEqual(8);
    expect(geometry.intersections, 'final return routes must not cross').toBe(0);
    expect(geometry.feedback.label).toBe('feedback');
    expect(geometry.annotate.label).toBe('annotate');
    for (const route of geometry.paths) {
      expect(route.nodeHits).toEqual([]);
      expect(route.labelHits).toEqual([]);
      expect(route.marker).toContain('pointEnd');
    }
    expect(geometry.entersSource).toBe(true);
    expect(geometry.sourceEntryGap).toBeGreaterThanOrEqual(4);
    expect(Math.min(...geometry.forwardPortGaps)).toBeGreaterThanOrEqual(10);
    expect(geometry.minimumFont).toBeGreaterThanOrEqual(12 - 1 / 64);
    expect(geometry.pageOverflow).toBe(0);
    expect(geometry.viewport.overflowX).toBe('auto');
    expect(geometry.viewport.leftInset).toBeGreaterThanOrEqual(0);
    if (width === 960) {
      expect(geometry.viewport.scrollWidth).toBeLessThanOrEqual(geometry.viewport.clientWidth + 1);
      expect(geometry.viewport.rightInset).toBeGreaterThanOrEqual(-1);
    }
    if (width === 320) {
      // Deliberately move actual paint back inside annotate while leaving routing
      // metadata untouched: a metadata-only oracle must not pass this control.
      const feedback = svg.locator(`.edgePaths path[id="${geometry.feedback.id}"]`);
      const originalStyle = await feedback.evaluate(
        (path, offset) => {
          const original = path.getAttribute('style');
          const matrix = (path as SVGPathElement).getScreenCTM()!;
          (path as SVGPathElement).style.setProperty('transition', 'none', 'important');
          (path as SVGPathElement).style.setProperty(
            'transform',
            `translateX(${offset / Math.hypot(matrix.a, matrix.b)}px)`,
            'important',
          );
          return original;
        },
        geometry.annotate.left - geometry.feedback.left + 20,
      );
      try {
        const wrongOrder = await svg.evaluate(feedbackGeometry);
        await writeFile(
          testInfo.outputPath('negative-control.json'),
          JSON.stringify(wrongOrder, null, 2),
        );
        expect(wrongOrder.feedback.id).toBe(geometry.feedback.id);
        expect(wrongOrder.feedback.d).toBe(geometry.feedback.d);
        expect(wrongOrder.feedback.routingPoints).toBe(geometry.feedback.routingPoints);
        expect(wrongOrder.annotate.left - wrongOrder.feedback.left).toBeLessThan(0);
        expect(wrongOrder.intersections).toBeGreaterThan(0);
      } finally {
        await feedback.evaluate((element, original) => {
          const path = element as SVGPathElement;
          if (original === null) path.removeAttribute('style');
          else path.setAttribute('style', original);
          path.style.setProperty('transition', 'none', 'important');
          path.getScreenCTM();
          if (original === null) path.removeAttribute('style');
          else path.setAttribute('style', original);
        }, originalStyle);
      }
      const restored = await svg.evaluate(feedbackGeometry);
      expect(restored.feedback.left).toBeCloseTo(geometry.feedback.left, 2);
      expect(restored.intersections).toBe(0);
    }
  });
}
