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
const multilineLabelContract = [
  { text: 'Preview source update', authoredBreaks: 0 },
  { text: 'Browser-only scene\npreserves selected settings', authoredBreaks: 1 },
  {
    text: 'Capture harness waits\nfor measured layout\nbefore recording evidence',
    authoredBreaks: 2,
  },
] as const;

type Bounds = { left: number; top: number; right: number; bottom: number; height: number };
type MultilineNodeGeometry = {
  text: string;
  authoredBreaks: number;
  paintedLines: number;
  textBounds: Bounds;
  shapeBounds: Bounds;
};
type MultilineViolation = {
  text: string;
  issue:
    'label-count' | 'missing-label' | 'authored-breaks' | 'visible-rows' | 'clipped' | 'no-growth';
};

function multilineGeometryViolations(nodes: MultilineNodeGeometry[]): MultilineViolation[] {
  const violations: MultilineViolation[] = [];
  if (nodes.length !== multilineLabelContract.length) {
    violations.push({ text: 'collection', issue: 'label-count' });
  }
  const singleLine = nodes.find(({ text }) => text === multilineLabelContract[0].text);
  for (const expected of multilineLabelContract) {
    const node = nodes.find(({ text }) => text === expected.text);
    if (!node) {
      violations.push({ text: expected.text, issue: 'missing-label' });
      continue;
    }
    if (node.authoredBreaks !== expected.authoredBreaks) {
      violations.push({ text: expected.text, issue: 'authored-breaks' });
    }
    if (node.paintedLines < expected.authoredBreaks + 1) {
      violations.push({ text: expected.text, issue: 'visible-rows' });
    }
    if (
      node.textBounds.left < node.shapeBounds.left - 1 ||
      node.textBounds.top < node.shapeBounds.top - 1 ||
      node.textBounds.right > node.shapeBounds.right + 1 ||
      node.textBounds.bottom > node.shapeBounds.bottom + 1
    ) {
      violations.push({ text: expected.text, issue: 'clipped' });
    }
    if (
      expected.authoredBreaks > 0 &&
      singleLine &&
      node.shapeBounds.height <= singleLine.shapeBounds.height + 1
    ) {
      violations.push({ text: expected.text, issue: 'no-growth' });
    }
  }
  return violations;
}

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
    const multilineNodes = [
      ...document.querySelectorAll<SVGGElement>('#mermaid-long-labels g.node'),
    ].map((node) => {
      const label = node.querySelector<HTMLElement>('.nodeLabel')!;
      const range = document.createRange();
      const textRects: DOMRect[] = [];
      const textNodes = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      while (textNodes.nextNode()) {
        range.selectNodeContents(textNodes.currentNode);
        textRects.push(...range.getClientRects());
      }
      const paintedLineTops = textRects
        .filter(({ width, height }) => width > 0 && height > 0)
        .map(({ top }) => top)
        .toSorted((left, right) => left - right)
        .filter((top, index, tops) => index === 0 || top - tops[index - 1] > 1);
      const textBounds = textRects.reduce(
        (bounds, rect) => ({
          left: Math.min(bounds.left, rect.left),
          top: Math.min(bounds.top, rect.top),
          right: Math.max(bounds.right, rect.right),
          bottom: Math.max(bounds.bottom, rect.bottom),
          height: Math.max(bounds.bottom, rect.bottom) - Math.min(bounds.top, rect.top),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, height: 0 },
      );
      const shape = node
        .querySelector<SVGGraphicsElement>(':scope > .label-container')!
        .getBoundingClientRect();
      return {
        text: label.innerText,
        authoredBreaks: label.querySelectorAll('br').length,
        paintedLines: paintedLineTops.length,
        textBounds,
        shapeBounds: {
          left: shape.left,
          top: shape.top,
          right: shape.right,
          bottom: shape.bottom,
          height: shape.height,
        },
      };
    });
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
      multilineNodes,
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
  expect(multilineGeometryViolations(geometry.multilineNodes)).toEqual([]);
  expect(geometry.nestedContainment.every(Boolean)).toBe(true);
});

test('rejects lost multiline breaks, missing rows, and clipped text', () => {
  const shapeBounds = (height: number): Bounds => ({
    left: 0,
    top: 0,
    right: 100,
    bottom: height,
    height,
  });
  const nodes: MultilineNodeGeometry[] = multilineLabelContract.map((expected, index) => ({
    text: expected.text,
    authoredBreaks: expected.authoredBreaks,
    paintedLines: expected.authoredBreaks + 1,
    textBounds: { left: 10, top: 5, right: 90, bottom: 15 + index * 15, height: 10 + index * 15 },
    shapeBounds: shapeBounds(20 + index * 20),
  }));
  nodes[1] = { ...nodes[1], authoredBreaks: 0, paintedLines: 1 };
  nodes[2] = {
    ...nodes[2],
    textBounds: { ...nodes[2].textBounds, bottom: nodes[2].shapeBounds.bottom + 2 },
  };

  expect(multilineGeometryViolations(nodes)).toEqual(
    expect.arrayContaining([
      { text: multilineLabelContract[1].text, issue: 'authored-breaks' },
      { text: multilineLabelContract[1].text, issue: 'visible-rows' },
      { text: multilineLabelContract[2].text, issue: 'clipped' },
    ]),
  );
  const allEqualShapes = nodes.map((node) => ({
    ...node,
    shapeBounds: shapeBounds(80),
  }));
  expect(multilineGeometryViolations(allEqualShapes)).toEqual(
    expect.arrayContaining([
      { text: multilineLabelContract[1].text, issue: 'no-growth' },
      { text: multilineLabelContract[2].text, issue: 'no-growth' },
    ]),
  );
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
