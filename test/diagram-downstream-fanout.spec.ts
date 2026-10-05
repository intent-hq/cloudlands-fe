import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

for (const width of [960, 420]) {
  test(`preserves ${width === 960 ? 'clear painted downstream corridors' : 'compact downstream ports and node clearance'} through the full pipeline at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=mermaid-dense-graph&theme=light&width=${width}&motion=reduced`,
    );
    const scene = page.getByTestId('catalog-scene');
    await expect(scene).toHaveAttribute('data-preview-stable', 'true', { timeout: 90_000 });
    await page.evaluate(() => document.fonts.ready);
    const svg = page.locator('#mermaid-dense-graph svg[data-layout-settled="true"]');
    await expect(page.locator('#mermaid-dense-graph .mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    const result = await svg.evaluate((root) => {
      const paths = [...root.querySelectorAll<SVGPathElement>('.edgePaths path')];
      const nodes = [...root.querySelectorAll<SVGGElement>('g.node')];
      const labels = [...root.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
      const sample = (path: SVGPathElement) =>
        Array.from({ length: 801 }, (_, i) =>
          path
            .getPointAtLength((path.getTotalLength() * i) / 800)
            .matrixTransform(path.getScreenCTM()!),
        );
      const allSamples = new Map(paths.map((path) => [path, sample(path)]));
      const affected = paths.filter((path) => /-L_E_[FG]_0$/.test(path.id));
      const box = (element: Element) => element.getBoundingClientRect().toJSON();
      const routes = affected.map((path) => {
        const targetId = path.id.match(/-L_E_([^_]+)_/)![1];
        const target = nodes.find((node) => node.id.includes(`-flowchart-${targetId}-`))!;
        const bounds = target.getBoundingClientRect();
        const ownLabel = labels.find(
          (label) =>
            label.querySelector('[data-id]')?.getAttribute('data-id') === `L_E_${targetId}_0`,
        );
        const points = allSamples.get(path)!;
        const inside = (point: DOMPoint, b: DOMRect) =>
          point.x > b.left + 0.5 &&
          point.x < b.right - 0.5 &&
          point.y > b.top + 0.5 &&
          point.y < b.bottom - 0.5;
        const obstacles = [
          ...nodes.filter((node) => !node.id.includes('-flowchart-E-')),
          ...labels.filter((label) => label !== ownLabel && label.textContent?.trim()),
        ];
        const otherRoutes = paths.filter((other) => !affected.includes(other));
        const nearestRoute = Math.min(
          ...points.map((p) =>
            Math.min(
              ...otherRoutes.map((other) =>
                Math.min(...allSamples.get(other)!.map((q) => Math.hypot(p.x - q.x, p.y - q.y))),
              ),
            ),
          ),
        );
        const end = points.at(-1)!;
        return {
          id: path.id,
          d: path.getAttribute('d'),
          data: { ...path.dataset },
          start: { x: points[0].x, y: points[0].y },
          end: { x: end.x, y: end.y },
          nodesAndLabelsHit: obstacles
            .filter((element) => points.some((p) => inside(p, element.getBoundingClientRect())))
            .map((e) => e.textContent?.trim()),
          ownLabelOtherRouteHits: ownLabel
            ? otherRoutes
                .filter((other) =>
                  allSamples.get(other)!.some((p) => inside(p, ownLabel.getBoundingClientRect())),
                )
                .map((p) => p.id)
            : [],
          nearestRoute,
          terminalGap: Math.min(Math.abs(bounds.left - end.x), Math.abs(bounds.top - end.y)) - 0.5,
        };
      });
      const [a, b] = affected;
      let shared = 0;
      for (let i = 0; i <= 128; i++) {
        const p = a.getPointAtLength(i).matrixTransform(a.getScreenCTM()!);
        const q = b.getPointAtLength(i).matrixTransform(b.getScreenCTM()!);
        if (Math.hypot(p.x - q.x, p.y - q.y) > 0.5) break;
        shared = i * Math.hypot(a.getScreenCTM()!.a, a.getScreenCTM()!.b);
      }
      return {
        routes,
        shared,
        nodes: nodes.map((node) => ({ id: node.id, text: node.textContent, bounds: box(node) })),
        labels: labels.map((label) => ({ text: label.textContent, bounds: box(label) })),
        allRoutes: paths.map((path) => ({
          id: path.id,
          d: path.getAttribute('d'),
          data: { ...path.dataset },
        })),
        preview: { ...document.querySelector<HTMLElement>('[data-preview-ready]')!.dataset },
        fonts: document.fonts.status,
      };
    });
    await writeFile(info.outputPath('painted-geometry.json'), JSON.stringify(result, null, 2));
    await svg.screenshot({
      path: info.outputPath(`downstream-${width}.png`),
      animations: 'disabled',
    });
    expect(result.routes).toHaveLength(2);
    for (const route of result.routes) {
      expect(route.nodesAndLabelsHit, route.id).toEqual([]);
      expect(route.ownLabelOtherRouteHits, route.id).toEqual([]);
      if (width === 960) expect(route.nearestRoute, route.id).toBeGreaterThanOrEqual(8);
      expect(Math.abs(route.terminalGap - 5), route.id).toBeLessThanOrEqual(0.35);
    }
    if (width === 960) expect(result.shared).toBeGreaterThanOrEqual(8);
    else {
      expect(result.shared).toBeLessThanOrEqual(1);
      const unchanged = await svg.evaluate(async (root) => {
        const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
        const { routeFlowchartCenteredFanouts } = await import(/* @vite-ignore */ modulePath);
        const before = [...root.querySelectorAll('.edgePaths path')].map((path) =>
          path.getAttribute('d'),
        );
        routeFlowchartCenteredFanouts(root);
        return (
          JSON.stringify(before) ===
          JSON.stringify(
            [...root.querySelectorAll('.edgePaths path')].map((path) => path.getAttribute('d')),
          )
        );
      });
      expect(unchanged).toBe(true);
    }
  });
}

for (const variant of [
  'clear',
  'scaled',
  'wide-label',
  'blocked-node',
  'blocked-label',
  'blocked-route',
  'compact',
  'missing-target',
  'ambiguous-target',
  'blocked-second-label',
] as const) {
  test(`downstream fallback is atomic and repeatable with ${variant} geometry`, async ({
    page,
  }, info) => {
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=mermaid-dense-graph&theme=light&width=960&motion=reduced`,
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
      timeout: 90_000,
    });
    const result = await page.evaluate(async (variant) => {
      const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
      const geometry = await import(/* @vite-ignore */ modulePath);
      const host = document.createElement('div');
      document.body.append(host);
      const transform = variant === 'scaled' ? 'translate(83 31) scale(1.6)' : 'translate(31 17)';
      host.innerHTML = `<svg width="900" height="900" aria-roledescription="flowchart-v2"><defs><marker id="test-pointEnd"><path d="M0,0 L1,1"/></marker></defs><g transform="${transform}"><g class="nodes"></g><g class="edgePaths"></g><g class="edgeLabels"></g></g></svg>`;
      const svg = host.querySelector('svg')!;
      const node = (id: string, x: number, y: number, w = 100, h = 50) => {
        svg
          .querySelector('.nodes')!
          .insertAdjacentHTML(
            'beforeend',
            `<g class="node" id="test-flowchart-${id}-0" transform="translate(${x} ${y})"><rect class="label-container" width="${w}" height="${h}"/></g>`,
          );
      };
      node('Origin', 110, 70);
      node('First', 300, 210);
      if (variant !== 'missing-target') node('Second', 200, 430);
      if (variant === 'ambiguous-target') node('Second', 205, 435);
      const edge = (id: string, d: string) =>
        svg
          .querySelector('.edgePaths')!
          .insertAdjacentHTML(
            'beforeend',
            `<path id="test-L_${id}_0" d="${d}" fill="none" marker-end="url(#test-pointEnd)"/>`,
          );
      edge('Origin_First', 'M160,120 L160,174 L350,174 L350,210');
      edge('Origin_Second', 'M150,120 L150,398 L250,398 L250,430');
      if (variant === 'clear' || variant === 'scaled' || variant === 'wide-label')
        svg.querySelector('.edgeLabels')!.innerHTML =
          '<g class="edgeLabel"><g class="label" data-id="L_Origin_First_0"><text>first</text></g></g><g class="edgeLabel"><g class="label" data-id="L_Origin_Second_0"><text>' +
          (variant === 'wide-label' ? 'no room '.repeat(80) : 'second') +
          '</text></g></g>';
      const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
      if (variant === 'compact') paths.forEach((path) => (path.dataset.compactFlowchart = 'true'));
      if (variant === 'blocked-node') node('Obstacle', 215, 140, 24, 24);
      if (variant === 'blocked-route') edge('Other_Obstacle', 'M210,145 L255,145');
      if (variant === 'blocked-label')
        svg.querySelector('.edgeLabels')!.innerHTML =
          '<g class="edgeLabel" transform="translate(215 140)"><rect width="24" height="24"/><text y="12">blocked</text></g>';
      if (variant === 'blocked-second-label')
        svg.querySelector('.edgeLabels')!.innerHTML =
          '<g class="edgeLabel"><g class="label" data-id="L_Origin_First_0"><text>first</text></g></g><g class="edgeLabel"><g class="label" data-id="L_Origin_Second_0"><rect width="2000" height="2000"/><text>no room</text></g></g>';
      const before = svg.innerHTML;
      geometry.routeFlowchartCenteredFanouts(svg);
      const changed = before !== svg.innerHTML;
      const pipeline = () => {
        geometry.snapFlowchartPorts(svg);
        geometry.snapFlowchartFanoutPorts(svg);
        geometry.snapFlowchartDiamondPorts(svg);
        geometry.roundOrthogonalBends(svg);
        geometry.alignMermaidOpenArrowheads(svg);
        geometry.applyMermaidTerminalGaps(svg);
      };
      pipeline();
      const snapshot = () => ({
        paths: paths.map((path) => ({
          d: path.getAttribute('d'),
          base: path.dataset.terminalGapBasePath,
          points: path.dataset.manhattanPoints,
        })),
        labels: [...svg.querySelectorAll('.edgeLabels > .edgeLabel')].map((label) => ({
          text: label.textContent,
          transform: label.getAttribute('transform'),
        })),
      });
      const first = snapshot();
      for (let i = 0; i < 3; i++) {
        geometry.routeFlowchartCenteredFanouts(svg);
        pipeline();
      }
      const last = snapshot();
      const starts = paths.map((path) => {
        const p = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
        return { x: p.x, y: p.y };
      });
      const source = svg.querySelector('#test-flowchart-Origin-0 rect')!.getBoundingClientRect();
      const labelClearance = [...svg.querySelectorAll('.edgeLabels > .edgeLabel')]
        .filter((label) => label.querySelector('[data-id]'))
        .map((label) => {
          const bounds = label.getBoundingClientRect();
          const owner = label.querySelector('[data-id]')!.getAttribute('data-id')!;
          const nodeHits = [...svg.querySelectorAll('.nodes rect')].filter((node) => {
            const other = node.getBoundingClientRect();
            return (
              bounds.left < other.right &&
              bounds.right > other.left &&
              bounds.top < other.bottom &&
              bounds.bottom > other.top
            );
          }).length;
          const routeHits = paths
            .filter((path) => !path.id.endsWith(owner))
            .filter((path) =>
              Array.from({ length: 801 }, (_, i) =>
                path
                  .getPointAtLength((path.getTotalLength() * i) / 800)
                  .matrixTransform(path.getScreenCTM()!),
              ).some(
                (point) =>
                  point.x > bounds.left &&
                  point.x < bounds.right &&
                  point.y > bounds.top &&
                  point.y < bounds.bottom,
              ),
            ).length;
          return { owner, bounds: bounds.toJSON(), nodeHits, routeHits };
        });
      host.remove();
      return { changed, first, last, starts, source: source.toJSON(), labelClearance };
    }, variant);
    await writeFile(info.outputPath('synthetic-geometry.json'), JSON.stringify(result, null, 2));
    expect(result.changed).toBe(['clear', 'scaled', 'wide-label'].includes(variant));
    if (result.changed) {
      expect(result.last).toEqual(result.first);
      expect(result.labelClearance).toHaveLength(2);
      for (const label of result.labelClearance) {
        expect(label.bounds.width).toBeGreaterThan(0);
        expect(label.bounds.height).toBeGreaterThan(0);
        expect(label.nodeHits).toBe(0);
        expect(label.routeHits).toBe(0);
      }
      for (const start of result.starts) {
        expect(Math.abs(start.x - result.source.right)).toBeLessThan(0.01);
        expect(Math.abs(start.y - (result.source.top + result.source.bottom) / 2)).toBeLessThan(
          0.01,
        );
      }
    }
  });
}
