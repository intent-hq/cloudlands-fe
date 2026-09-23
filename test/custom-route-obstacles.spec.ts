import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ timeout: 120_000 });

async function openSandbox(
  page: Page,
  width: number,
  theme: 'light' | 'dark' | 'nord',
  state = 'custom-service-boundaries',
) {
  const shellTheme = theme === 'nord' ? 'dark' : theme;
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=${shellTheme}&width=${width}&motion=reduced`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 90_000,
  });
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
    { timeout: 90_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  if (theme === 'nord') {
    await page.getByRole('button', { name: 'Color theme' }).click();
    await page.getByRole('option', { name: 'Nord', exact: true }).click();
  }
}

async function expectServiceBoundaryRoute(page: Page, identity: string) {
  const geometry = await page.locator('#custom-service-boundaries').evaluate((root) => {
    const path = root.querySelector<SVGPathElement>('.diagram-edge[data-edge-id="sb2"] path')!;
    const label = root.querySelector<SVGGraphicsElement>(
      '.edge-label-container[data-edge-id="sb2"]',
    )!;
    const dashboard = root.querySelector<SVGGraphicsElement>('[data-node-id="dashboard"]')!;
    const queue = root.querySelector<SVGGraphicsElement>('[data-node-id="queue"]')!;
    const monitoring = root.querySelector<SVGGraphicsElement>(
      '[data-group-id="observability"] .group-bg',
    )!;
    const stage = root.querySelector<HTMLElement>('.diagram-stage')!;
    const viewport = root.querySelector<HTMLElement>('.diagram-scroll-container')!;
    const rectDistance = (point: DOMPoint, bounds: DOMRect) =>
      Math.hypot(
        Math.max(bounds.left - point.x, 0, point.x - bounds.right),
        Math.max(bounds.top - point.y, 0, point.y - bounds.bottom),
      );
    const samples = Array.from({ length: 1001 }, (_, index) => {
      const point = path.getPointAtLength((path.getTotalLength() * index) / 1000);
      return point.matrixTransform(path.getScreenCTM()!);
    });
    const labelBounds = label.getBoundingClientRect();
    const labelCenter = new DOMPoint(
      labelBounds.left + labelBounds.width / 2,
      labelBounds.top + labelBounds.height / 2,
    );
    const queueBounds = queue.getBoundingClientRect();
    const node = queue.querySelector<HTMLElement>('.diagram-node-html')!;
    const end = samples.at(-1)!;
    const groupBounds = [...root.querySelectorAll<SVGGraphicsElement>('.group-bg')].map((group) =>
      group.getBoundingClientRect(),
    );
    const groupContainment = [...root.querySelectorAll<SVGGraphicsElement>('[data-node-id]')].every(
      (element) => {
        const child = element.getBoundingClientRect();
        return groupBounds.some(
          (bounds) =>
            child.left >= bounds.left - 1 &&
            child.top >= bounds.top - 1 &&
            child.right <= bounds.right + 1 &&
            child.bottom <= bounds.bottom + 1,
        );
      },
    );
    return {
      dashboardGap: Math.min(
        ...samples.map((point) => rectDistance(point, dashboard.getBoundingClientRect())),
      ),
      monitoringGap: Math.min(
        ...samples.map((point) => rectDistance(point, monitoring.getBoundingClientRect())),
      ),
      labelRouteGap: Math.min(
        ...samples.map((point) => Math.hypot(point.x - labelCenter.x, point.y - labelCenter.y)),
      ),
      labelObstacleGap: Math.min(
        rectDistance(labelCenter, dashboard.getBoundingClientRect()),
        rectDistance(labelCenter, monitoring.getBoundingClientRect()),
      ),
      targetGap: rectDistance(end, queueBounds),
      groupContainment,
      stageContained: stage.scrollWidth <= stage.clientWidth + 1,
      viewportContained: viewport.scrollWidth <= viewport.clientWidth + 1,
      effectiveFontSize:
        Number.parseFloat(getComputedStyle(node.querySelector('.node-label')!).fontSize) *
        (node.getBoundingClientRect().height / node.offsetHeight),
    };
  });

  expect(geometry.dashboardGap, `${identity} dashboard clearance`).toBeGreaterThanOrEqual(8);
  expect(geometry.monitoringGap, `${identity} disconnected group clearance`).toBeGreaterThanOrEqual(
    8,
  );
  expect(geometry.labelRouteGap, `${identity} label ownership`).toBeLessThanOrEqual(1.5);
  expect(geometry.labelObstacleGap, `${identity} label clearance`).toBeGreaterThanOrEqual(8);
  expect(Math.abs(geometry.targetGap - 5.5), `${identity} target gap`).toBeLessThanOrEqual(0.35);
  expect(geometry.groupContainment, `${identity} group containment`).toBe(true);
  expect(geometry.stageContained, `${identity} stage containment`).toBe(true);
  expect(geometry.viewportContained, `${identity} viewport containment`).toBe(true);
  expect(geometry.effectiveFontSize, `${identity} readable scale`).toBeGreaterThanOrEqual(12);
}

for (const theme of ['light', 'dark', 'nord'] as const) {
  for (const width of [320, 960] as const) {
    test(`routes around disconnected monitoring in ${theme} at ${width}px`, async ({ page }) => {
      await openSandbox(page, width, theme);
      await expectServiceBoundaryRoute(page, `${theme}/${width}`);
    });
  }
}

for (const width of [320, 420, 960]) {
  test(`keeps Validation gate left routes separate at ${width}px through repeat fits`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 2400 });
    await openSandbox(page, width, width === 320 ? 'light' : 'dark', 'custom-topology-stress');
    const root = page.locator('#custom-topology-stress');
    const renderer = root.locator('.diagram-renderer');
    const fit = root.locator('.diagram-fit-button');
    const snapshots = [];
    const check = expect.configure({ soft: true });
    for (let repeat = 0; repeat < 3; repeat++) {
      await root.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      if (repeat) {
        for (let toggle = 0; toggle < 2; toggle++) {
          const pressed = await fit.getAttribute('aria-pressed');
          await fit.focus();
          await expect(fit).toBeFocused();
          await fit.press('Enter');
          await expect(fit).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
          await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
        }
      }
      await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
      await root.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const geometry = await root.evaluate((section) => {
        const nodes = [...section.querySelectorAll<SVGGraphicsElement>('[data-node-id]')].map(
          (node) => ({
            id: node.getAttribute('data-node-id'),
            bounds: node.getBoundingClientRect().toJSON(),
          }),
        );
        const labels = [
          ...section.querySelectorAll<SVGGraphicsElement>('.edge-label-container'),
        ].map((label) => ({
          id: label.getAttribute('data-edge-id'),
          bounds: label.getBoundingClientRect().toJSON(),
        }));
        const routes = [...section.querySelectorAll<SVGPathElement>('path.edge-path')].map(
          (path) => {
            const edge = path.closest<SVGGElement>('.diagram-edge')!;
            const length = path.getTotalLength();
            const matrix = path.getScreenCTM()!;
            const { x, y, width, height } = path.getBBox();
            const count = Math.ceil(length * 2);
            const points = Array.from({ length: count + 1 }, (_, index) => {
              const point = path.getPointAtLength((length * index) / count).matrixTransform(matrix);
              return { x: point.x, y: point.y };
            });
            return {
              id: edge.dataset.edgeId,
              from: edge.dataset.edgeFrom,
              to: edge.dataset.edgeTo,
              d: path.getAttribute('d'),
              dash: getComputedStyle(path).strokeDasharray,
              marker: path.getAttribute('marker-end'),
              stroke: Number.parseFloat(getComputedStyle(path).strokeWidth),
              points,
              start: points[0],
              end: points.at(-1)!,
              localBounds: { x, y, width, height },
            };
          },
        );
        const repair = routes.find((route) => route.id === 'z3')!;
        const feedback = routes.find((route) => route.id === 'z11')!;
        const rectDistance = (point: { x: number; y: number }, bounds: DOMRect) =>
          Math.hypot(
            Math.max(bounds.left - point.x, 0, point.x - bounds.right),
            Math.max(bounds.top - point.y, 0, point.y - bounds.bottom),
          );
        const routeClearances = [repair, feedback].map((route) => ({
          id: route.id,
          sourceGap: rectDistance(
            route.start,
            nodes.find((node) => node.id === route.from)!.bounds,
          ),
          targetGap: rectDistance(route.end, nodes.find((node) => node.id === route.to)!.bounds),
          nodeGap: Math.min(
            ...nodes
              .filter((node) => ![route.from, route.to].includes(node.id!))
              .flatMap((node) => route.points.map((point) => rectDistance(point, node.bounds))),
          ),
          labelGap: Math.min(
            ...labels
              .filter((label) => label.id !== route.id)
              .flatMap((label) => route.points.map((point) => rectDistance(point, label.bounds))),
          ),
          ownLabelGap: Math.min(
            ...route.points.map((point) =>
              rectDistance(point, labels.find((label) => label.id === route.id)!.bounds),
            ),
          ),
        }));
        const viewport = section
          .querySelector('.diagram-scroll-container')!
          .getBoundingClientRect();
        const contained =
          [...nodes, ...labels].every(
            ({ bounds }) =>
              bounds.left >= viewport.left - 1 &&
              bounds.right <= viewport.right + 1 &&
              bounds.top >= viewport.top - 1 &&
              bounds.bottom <= viewport.bottom + 1,
          ) &&
          routes.every((route) =>
            route.points.every(
              (point) =>
                point.x >= viewport.left - 1 &&
                point.x <= viewport.right + 1 &&
                point.y >= viewport.top - 1 &&
                point.y <= viewport.bottom + 1,
            ),
          );
        let separation = Infinity;
        for (const a of repair.points)
          for (const b of feedback.points)
            separation = Math.min(separation, Math.hypot(a.x - b.x, a.y - b.y));
        const leftRunGap = Math.abs(
          Math.min(...repair.points.map((p) => p.x)) - Math.min(...feedback.points.map((p) => p.x)),
        );
        return {
          nodes,
          labels,
          routes,
          routeClearances,
          svgWidth: section.querySelector('.diagram-svg-layer')!.getBoundingClientRect().width,
          scale: section.querySelector<SVGSVGElement>('.diagram-svg-layer')!.getScreenCTM()!.a,
          overflow:
            section.querySelector('.diagram-scroll-container')!.scrollWidth -
            section.querySelector('.diagram-scroll-container')!.clientWidth,
          labelNodeGap: Math.min(
            ...labels
              .filter((label) => ['z3', 'z11'].includes(label.id!))
              .flatMap((label) =>
                nodes.map((node) =>
                  Math.hypot(
                    Math.max(
                      label.bounds.left - node.bounds.right,
                      node.bounds.left - label.bounds.right,
                      0,
                    ),
                    Math.max(
                      label.bounds.top - node.bounds.bottom,
                      node.bounds.top - label.bounds.bottom,
                      0,
                    ),
                  ),
                ),
              ),
          ),
          contained,
          separation,
          leftRunGap,
          portGap: Math.abs(repair.start.y - feedback.end.y),
          renderer: section.querySelector('.diagram-renderer')!.getBoundingClientRect().toJSON(),
        };
      });
      snapshots.push(geometry);
      await writeFile(info.outputPath('gate-routes.json'), JSON.stringify(snapshots, null, 2));
      expect((await root.boundingBox())!.y).toBeGreaterThan(100);
      await root.screenshot({ path: info.outputPath(`gate-${width}-${repeat}.png`) });
      check(geometry.leftRunGap, 'distinct left exterior runs').toBeGreaterThanOrEqual(8);
      check(geometry.portGap, 'distinct gate attachments').toBeGreaterThanOrEqual(8);
      check(geometry.separation, 'no coincident or crossing approach').toBeGreaterThanOrEqual(8);
      if (width === 320) {
        // Independent pre-edit browser measurements; the original no-scrollbar control remains unchanged.
        check(geometry.svgWidth, 'no introduced 320px SVG envelope growth').toBeLessThanOrEqual(
          308.62,
        );
        check(
          geometry.overflow,
          'no added overflow over the existing 49px baseline',
        ).toBeLessThanOrEqual(49);
        check(geometry.scale, 'no scale reduction to hide added width').toBeCloseTo(12 / 13, 5);
      } else {
        check(geometry.contained, 'all diagram paint remains in the viewport').toBe(true);
      }
      check(geometry.labelNodeGap, 'return labels clear all nodes').toBeGreaterThanOrEqual(8);
      check(geometry.routes.find((route) => route.id === 'z3')!.dash).toBe('none');
      check(geometry.routes.find((route) => route.id === 'z11')!.dash).not.toBe('none');
      for (const clearance of geometry.routeClearances) {
        check(clearance.sourceGap, `${clearance.id} source attachment`).toBeLessThanOrEqual(0.1);
        check(
          Math.abs(clearance.targetGap - 5.5),
          `${clearance.id} target gap`,
        ).toBeLessThanOrEqual(0.35);
        check(clearance.nodeGap, `${clearance.id} unrelated node clearance`).toBeGreaterThanOrEqual(
          8,
        );
        check(clearance.labelGap, `${clearance.id} other label clearance`).toBeGreaterThanOrEqual(
          8,
        );
        check(clearance.ownLabelGap, `${clearance.id} label ownership`).toBeLessThanOrEqual(1);
      }
      check(
        geometry.routes.map(({ id, d }) => ({ id, d })),
        'repeat fits preserve every route',
      ).toEqual(snapshots[0].routes.map(({ id, d }) => ({ id, d })));
    }
  });
}
