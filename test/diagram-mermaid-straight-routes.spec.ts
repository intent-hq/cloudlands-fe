import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

for (const width of [960, 420]) {
  for (const motion of ['full', 'reduced']) {
    test(`paints clear nested routes at ${width}px with ${motion} motion`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(
        `${baseUrl}/sandbox/diagram-workbench?state=mermaid-nested-routing&theme=light&width=${width}&motion=${motion}`,
        { waitUntil: 'domcontentloaded' },
      );
      await expect(page.getByTestId('catalog-scene')).toHaveAttribute(
        'data-preview-stable',
        'true',
        {
          timeout: 90_000,
        },
      );
      await expect(page.getByTestId('catalog-scene')).toHaveAttribute(
        'data-preview-capture-motion',
        motion,
      );
      await page.evaluate(() => document.fonts.ready);
      const renderer = page.locator('#mermaid-nested-routing .mermaid-renderer');
      await expect(renderer).toHaveAttribute('data-render-settled', 'true');
      const svg = renderer.locator('svg[data-layout-settled="true"]');
      const geometry = await svg.evaluate((root) => {
        const paths = [...root.querySelectorAll<SVGPathElement>('.edgePaths path')];
        const nodes = [...root.querySelectorAll<SVGGElement>('g.node')];
        const labels = [...root.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
        const titles = [...root.querySelectorAll<SVGGElement>('g.cluster > .cluster-label')];
        const inside = (point: DOMPoint, bounds: DOMRect) =>
          point.x > bounds.left + 0.5 &&
          point.x < bounds.right - 0.5 &&
          point.y > bounds.top + 0.5 &&
          point.y < bounds.bottom - 0.5;
        const routes = paths.map((path) => {
          const matrix = path.getScreenCTM()!;
          const samples = Array.from({ length: 501 }, (_, index) =>
            path.getPointAtLength((path.getTotalLength() * index) / 500).matrixTransform(matrix),
          );
          const identity = path.id.match(/-L_([^_]+)_([^_]+)_\d+$/)!;
          const ownLabel = labels.find(
            (label) =>
              label.querySelector('[data-id]')?.getAttribute('data-id') ===
              `L_${identity[1]}_${identity[2]}_${path.id.split('_').at(-1)}`,
          );
          const obstacles = [
            ...nodes.filter(
              (node) =>
                ![identity[1], identity[2]].some((id) => node.id.includes(`-flowchart-${id}-`)),
            ),
            ...titles,
            ...labels.filter((label) => label !== ownLabel && label.textContent?.trim()),
          ];
          const logical = path.dataset.manhattanPoints!.split(' ').map((value) => {
            const [x, y] = value.split(',').map(Number);
            return new DOMPoint(x, y).matrixTransform(matrix);
          });
          const start = samples[0];
          const end = samples.at(-1)!;
          const length = Math.hypot(end.x - start.x, end.y - start.y);
          return {
            role: path.dataset.nestedDecisionRoute,
            source: identity[1],
            target: identity[2],
            d: path.getAttribute('d'),
            logical: logical.map(({ x, y }) => ({ x, y })),
            maxLineDeviation: Math.max(
              ...samples.map(
                (point) =>
                  Math.abs(
                    (end.x - start.x) * (point.y - start.y) -
                      (end.y - start.y) * (point.x - start.x),
                  ) / length,
              ),
            ),
            paintedLength: path.getTotalLength() * Math.hypot(matrix.a, matrix.b),
            directLength: length,
            obstacleHits: obstacles
              .filter((element) =>
                samples.some((point) => inside(point, element.getBoundingClientRect())),
              )
              .map((element) => element.textContent?.trim()),
            contained: samples.every((point) => {
              const frame = root.getBoundingClientRect();
              return (
                point.x >= frame.left - 1 &&
                point.x <= frame.right + 1 &&
                point.y >= frame.top - 1 &&
                point.y <= frame.bottom + 1
              );
            }),
          };
        });
        const diamond = nodes
          .find((node) => node.id.includes('-flowchart-Validate-'))!
          .getBoundingClientRect();
        const ports = routes
          .filter((route) => route.source === 'Validate' || route.target === 'Validate')
          .map((route) => {
            const point = route.source === 'Validate' ? route.logical[0] : route.logical.at(-1)!;
            return {
              key: `${point.x.toFixed(2)},${point.y.toFixed(2)}`,
              boundaryError: Math.abs(
                Math.abs(point.x - (diamond.left + diamond.right) / 2) / (diamond.width / 2) +
                  Math.abs(point.y - (diamond.top + diamond.bottom) / 2) / (diamond.height / 2) -
                  1,
              ),
            };
          });
        const noPath = paths.find(
          (path) => path.dataset.nestedDecisionRoute === 'decision-return',
        )!;
        const noLabel = labels.find((label) => label.textContent?.trim() === 'no')!;
        const noSamples = Array.from({ length: 501 }, (_, index) =>
          noPath
            .getPointAtLength((noPath.getTotalLength() * index) / 500)
            .matrixTransform(noPath.getScreenCTM()!),
        );
        let noLaneClearance = Infinity;
        const noLabelHits: string[] = [];
        for (const path of paths.filter((path) => path !== noPath)) {
          for (let index = 0; index <= 500; index++) {
            const point = path
              .getPointAtLength((path.getTotalLength() * index) / 500)
              .matrixTransform(path.getScreenCTM()!);
            noLaneClearance = Math.min(
              noLaneClearance,
              ...noSamples.map((sample) => Math.hypot(point.x - sample.x, point.y - sample.y)),
            );
            if (inside(point, noLabel.getBoundingClientRect()))
              noLabelHits.push(path.dataset.nestedDecisionRoute!);
          }
        }
        return { routes, ports, noLaneClearance, noLabelHits: [...new Set(noLabelHits)] };
      });
      await testInfo.attach('painted-geometry', {
        body: JSON.stringify(geometry, null, 2),
        contentType: 'application/json',
      });
      await writeFile(
        testInfo.outputPath('painted-geometry.json'),
        JSON.stringify(geometry, null, 2),
      );
      await renderer.screenshot({ path: testInfo.outputPath(`nested-${width}-${motion}.png`) });
      expect(geometry.ports).toHaveLength(6);
      expect(new Set(geometry.ports.map((port) => port.key)).size).toBe(6);
      expect(geometry.ports.every((port) => port.boundaryError < 0.03)).toBe(true);
      expect(geometry.routes.every((route) => route.contained)).toBe(true);
      const no = geometry.routes.find((route) => route.role === 'decision-return')!;
      expect(no.obstacleHits).toEqual([]);
      expect(geometry.noLabelHits).toEqual([]);
      expect(geometry.noLaneClearance).toBeGreaterThan(4);
      if (width === 960) {
        expect(no.logical).toHaveLength(2);
        expect(no.maxLineDeviation).toBeLessThan(0.05);
        expect(Math.abs(no.paintedLength - no.directLength)).toBeLessThan(0.05);
        expect(Math.abs(no.logical[0].y - no.logical[1].y)).toBeLessThan(0.05);
      } else {
        expect(no.logical.length).toBeGreaterThan(2);
        expect(no.maxLineDeviation).toBeGreaterThan(1);
      }
    });
  }
}
