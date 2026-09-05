import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const showcaseIds = [
  'mermaid-single-node',
  'mermaid-minimal-sequence',
  'mermaid-state-recovery',
  'mermaid-minimal-state',
  'mermaid-minimal-class',
  'mermaid-minimal-entity-relationship',
  'mermaid-nested-routing',
  'custom-service-boundaries',
  'custom-delivery-walkthrough',
] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ timeout: 120_000 });

function collectUnexpectedConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Failed to render mermaid diagram:') && text.includes('Missing close'))
      return;
    errors.push(text);
  });
  return errors;
}

async function openShowcase(page: Page, width = 960, theme: 'light' | 'dark' = 'light') {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=mermaid-nested-routing&theme=${theme}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 120_000,
  });
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
    { timeout: 120_000 },
  );
}

test('renders every added showcase with its expected visual contract and no console errors', async ({
  page,
}) => {
  const consoleErrors = collectUnexpectedConsoleErrors(page);
  await openShowcase(page);

  for (const id of showcaseIds) {
    const root = page.locator(`#${id}`);
    await expect(root.locator('[data-visual-contract]')).toBeVisible();
    if (id.startsWith('custom-')) {
      await expect(root.locator('.diagram-renderer')).toHaveAttribute(
        'data-diagram-settled',
        'true',
      );
    } else {
      await expect(root.locator('.mermaid-svg > svg')).toHaveAttribute(
        'data-layout-settled',
        'true',
      );
    }
    await expect(root.locator('[role="alert"]')).toHaveCount(0);
  }
  expect(consoleErrors).toEqual([]);
});

test('contains grouped nodes, mixed-height labels, and custom route terminals', async ({
  page,
}) => {
  await openShowcase(page);

  const geometry = await page.evaluate(() => {
    const contains = (outer: DOMRect, inner: DOMRect, tolerance = 1) =>
      inner.left >= outer.left - tolerance &&
      inner.top >= outer.top - tolerance &&
      inner.right <= outer.right + tolerance &&
      inner.bottom <= outer.bottom + tolerance;
    const cardinalDistance = (point: DOMPoint, bounds: DOMRect) =>
      Math.min(
        Math.hypot(point.x - (bounds.left + bounds.right) / 2, point.y - bounds.top),
        Math.hypot(point.x - bounds.right, point.y - (bounds.top + bounds.bottom) / 2),
        Math.hypot(point.x - (bounds.left + bounds.right) / 2, point.y - bounds.bottom),
        Math.hypot(point.x - bounds.left, point.y - (bounds.top + bounds.bottom) / 2),
      );
    const service = document.querySelector('#custom-service-boundaries')!;
    const groupMembers: Record<string, string[]> = {
      ingress: ['client', 'gateway'],
      processing: ['queue', 'worker'],
      storage: ['registry', 'archive'],
      observability: ['metrics', 'dashboard'],
    };
    const groupContainment = Object.entries(groupMembers).flatMap(([groupId, nodeIds]) => {
      const group = service
        .querySelector<SVGRectElement>(`[data-group-id="${groupId}"] .group-bg`)!
        .getBoundingClientRect();
      return nodeIds.map((nodeId) =>
        contains(
          group,
          service
            .querySelector<HTMLElement>(`[data-node-id="${nodeId}"] .diagram-node-html`)!
            .getBoundingClientRect(),
        ),
      );
    });
    const labelsContained = [...service.querySelectorAll<HTMLElement>('.node-label')].map((label) =>
      contains(
        label.closest<HTMLElement>('.diagram-node-html')!.getBoundingClientRect(),
        label.getBoundingClientRect(),
      ),
    );
    const edgeMembers: Record<string, [string, string]> = {
      sb1: ['client', 'gateway'],
      sb2: ['gateway', 'queue'],
      sb3: ['queue', 'worker'],
      sb4: ['worker', 'registry'],
      sb5: ['registry', 'archive'],
      sb6: ['metrics', 'dashboard'],
    };
    const terminals = [...service.querySelectorAll<SVGPathElement>('.diagram-edge .edge-path')].map(
      (path) => {
        const edge = path.closest<SVGGElement>('.diagram-edge')!;
        const [sourceId, targetId] = edgeMembers[edge.dataset.edgeId!];
        const source = service
          .querySelector<HTMLElement>(`[data-node-id="${sourceId}"] .diagram-node-html`)!
          .getBoundingClientRect();
        const target = service
          .querySelector<HTMLElement>(`[data-node-id="${targetId}"] .diagram-node-html`)!
          .getBoundingClientRect();
        const matrix = path.getScreenCTM()!;
        const start = path.getPointAtLength(0).matrixTransform(matrix);
        const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
        return {
          source: cardinalDistance(start, source),
          target: cardinalDistance(end, target),
          marker: path.getAttribute('marker-end'),
        };
      },
    );
    const mixedHeights = [
      ...document.querySelectorAll<SVGGElement>('#mermaid-long-labels g.node'),
    ].map((node) => Math.round(node.getBoundingClientRect().height));
    const nested = document.querySelector('#mermaid-nested-routing')!;
    const cluster = (label: string) =>
      [...nested.querySelectorAll<SVGGElement>('g.cluster')]
        .find((item) =>
          item.querySelector(':scope > .cluster-label')?.textContent?.includes(label),
        )!
        .querySelector<SVGRectElement>(':scope > rect')!
        .getBoundingClientRect();
    const node = (label: string) =>
      [...nested.querySelectorAll<SVGGElement>('g.node')]
        .find((item) => item.textContent?.includes(label))!
        .getBoundingClientRect();
    return {
      groupContainment,
      labelsContained,
      terminals,
      mixedHeightCount: new Set(mixedHeights).size,
      nestedContainment: [
        contains(cluster('Checks'), node('Ready?')),
        contains(cluster('Checks'), node('Context')),
        contains(cluster('Review'), node('Decision')),
      ],
    };
  });

  expect(geometry.groupContainment.every(Boolean)).toBe(true);
  expect(geometry.labelsContained.every(Boolean)).toBe(true);
  expect(geometry.terminals.every(({ source }) => source <= 1)).toBe(true);
  expect(geometry.terminals.every(({ target }) => target <= 6)).toBe(true);
  expect(geometry.terminals.every(({ marker }) => marker?.includes('arrowhead'))).toBe(true);
  expect(geometry.mixedHeightCount).toBeGreaterThanOrEqual(3);
  expect(geometry.nestedContainment.every(Boolean)).toBe(true);
});

test('supports keyboard walkthrough changes and staged full-motion focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-delivery-walkthrough&theme=light&width=960&motion=full`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 120_000,
  });
  const root = page.locator('#custom-delivery-walkthrough');
  const motion = await root.evaluate(async (element) => {
    const first = element.querySelector<HTMLButtonElement>('[data-diagram-step-index="0"]')!;
    const renderer = element.querySelector<HTMLElement>('.diagram-renderer')!;
    const animationCount = () =>
      [...element.querySelectorAll<SVGElement>('.diagram-svg-layer, .diagram-geometry-motion')]
        .flatMap((target) => target.getAnimations())
        .filter((animation) => animation.playState === 'running').length;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const phaseAfterKey = renderer.dataset.diagramMotionPhase;
    let maximumAnimations = animationCount();
    for (
      let frame = 0;
      frame < 30 && renderer.dataset.diagramMotionPhase === 'camera';
      frame += 1
    ) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      maximumAnimations = Math.max(maximumAnimations, animationCount());
    }
    return { phaseAfterKey, maximumAnimations };
  });
  expect(motion.phaseAfterKey).toBe('camera');
  expect(motion.maximumAnimations).toBeGreaterThan(0);
  await expect(root.locator('[data-diagram-step-index="1"]')).toBeFocused();
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-state', 'verify');
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
  await expect(root.locator('[data-node-id="checks"]')).toBeVisible();
  await expect(root.locator('[data-node-id="artifact"]')).toHaveCount(0);
});

for (const appearance of [
  { name: 'Light', theme: 'light' as const, nord: false },
  { name: 'Dark', theme: 'dark' as const, nord: false },
  { name: 'Nord', theme: 'light' as const, nord: true },
]) {
  for (const width of [420, 960] as const) {
    test(`${appearance.name} keeps showcase fixtures readable at ${width}px`, async ({ page }) => {
      const consoleErrors = collectUnexpectedConsoleErrors(page);
      await openShowcase(page, width, appearance.theme);
      if (appearance.nord) {
        await page.getByTestId('catalog-color-theme-control').click();
        await page.getByRole('option', { name: 'Nord', exact: true }).click();
        await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
          'data-catalog-color-theme',
          'nord',
        );
      }
      const result = await page.evaluate((ids) => {
        const roots = ids.map((id) => document.getElementById(id)!);
        const visibleText = roots.flatMap((root) => [
          ...root.querySelectorAll<HTMLElement>('.node-label, .nodeLabel, .actor, .messageText'),
        ]);
        const mermaidScale = roots.flatMap((root) =>
          [...root.querySelectorAll<SVGSVGElement>('.mermaid-svg > svg')].map(
            (svg) => svg.getBoundingClientRect().height / svg.viewBox.baseVal.height,
          ),
        );
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          minimumFont: Math.min(
            ...visibleText.map((text) => {
              const svg = text.closest<SVGSVGElement>('svg');
              const scale = svg
                ? svg.getBoundingClientRect().height / svg.viewBox.baseVal.height
                : 1;
              return Number.parseFloat(getComputedStyle(text).fontSize) * scale;
            }),
            ...mermaidScale.map((scale) => 13 * scale),
          ),
        };
      }, showcaseIds);
      expect(result.pageOverflow).toBeLessThanOrEqual(1);
      expect(result.minimumFont).toBeGreaterThanOrEqual(10);
      expect(consoleErrors).toEqual([]);
    });
  }
}
