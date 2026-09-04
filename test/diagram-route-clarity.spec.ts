import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ mode: 'serial', timeout: 360_000 });

async function openSandbox(page: Page, width: number, theme: 'light' | 'dark' | 'nord') {
  const shellTheme = theme === 'nord' ? 'dark' : theme;
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=${shellTheme}&width=${width}&motion=reduced`,
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

async function expectClearLabels(diagram: Locator) {
  const geometry = await diagram.evaluate((root) => {
    const rect = (element: Element) => element.getBoundingClientRect();
    const intersects = (a: DOMRect, b: DOMRect, padding = 1) =>
      a.left < b.right + padding &&
      a.right > b.left - padding &&
      a.top < b.bottom + padding &&
      a.bottom > b.top - padding;
    const nodes = [...root.querySelectorAll('.diagram-node-html')].map(rect);
    const labels = [...root.querySelectorAll<HTMLElement>('.edge-label-container')];

    return labels.map((label, index) => {
      const bounds = rect(label);
      const edgeId = label.dataset.edgeId;
      const path = root.querySelector<SVGGeometryElement>(
        `.diagram-edge[data-edge-id="${edgeId}"] .edge-path`,
      )!;
      const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      let routeDistance = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= 1000; step += 1) {
        const point = path.getPointAtLength((path.getTotalLength() * step) / 1000);
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
        routeDistance = Math.min(
          routeDistance,
          Math.hypot(center.x - screenPoint.x, center.y - screenPoint.y),
        );
      }
      return {
        edgeId,
        fits:
          label.scrollWidth <= label.clientWidth + 1 &&
          label.scrollHeight <= label.clientHeight + 1,
        nodeOverlap: nodes.some((node) => intersects(bounds, node)),
        labelOverlap: labels.some(
          (other, otherIndex) => otherIndex !== index && intersects(bounds, rect(other)),
        ),
        routeDistance,
      };
    });
  });

  expect(geometry.length).toBeGreaterThan(0);
  expect(geometry.every(({ fits }) => fits)).toBe(true);
  expect(geometry.every(({ nodeOverlap }) => !nodeOverlap)).toBe(true);
  expect(
    geometry.every(({ labelOverlap }) => !labelOverlap),
    JSON.stringify(geometry.filter(({ labelOverlap }) => labelOverlap)),
  ).toBe(true);
  expect(geometry.every(({ routeDistance }) => routeDistance <= 1.5)).toBe(true);
}

test('keeps custom labels and route lanes clear at supported review widths and themes', async ({
  page,
}) => {
  for (const [width, theme] of [
    [960, 'light'],
    [640, 'dark'],
    [420, 'nord'],
  ] as const) {
    await openSandbox(page, width, theme);
    const architecture = page.locator('#custom-architecture');
    await architecture.locator('[data-diagram-step-index="2"]').click();
    const walkthrough = page.locator('#custom-walkthrough');
    await walkthrough.locator('[data-diagram-step-index="1"]').click();
    await expectClearLabels(walkthrough);
    await walkthrough.locator('[data-diagram-step-index="2"]').click();

    for (const selector of [
      '#custom-architecture',
      '#custom-sequence',
      '#custom-flowchart',
      '#custom-network',
      '#custom-walkthrough',
    ]) {
      await expectClearLabels(page.locator(selector));
    }

    if (width === 960) {
      expect(
        await architecture.evaluate((root) => {
          const content = root.querySelector('.diagram-content')!.getBoundingClientRect();
          const viewport = root.querySelector('.diagram-scroll-container')!.getBoundingClientRect();
          return content.width <= viewport.width + 1;
        }),
      ).toBe(true);
    }
    expect(
      await page
        .locator('#custom-network .edge-path')
        .evaluateAll((paths) =>
          paths.every((path) => (path.getAttribute('d')?.match(/[ML]/g) ?? []).length === 2),
        ),
    ).toBe(true);
    expect(
      await walkthrough
        .locator('.edge-path')
        .evaluateAll((paths) =>
          paths.every((path) => (path.getAttribute('d')?.match(/[ML]/g) ?? []).length === 2),
        ),
    ).toBe(true);
  }
});
