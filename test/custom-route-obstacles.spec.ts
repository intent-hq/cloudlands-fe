import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ timeout: 120_000 });

async function openSandbox(page: Page, width: number, theme: 'light' | 'dark' | 'nord') {
  const shellTheme = theme === 'nord' ? 'dark' : theme;
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-service-boundaries&theme=${shellTheme}&width=${width}&motion=reduced`,
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
