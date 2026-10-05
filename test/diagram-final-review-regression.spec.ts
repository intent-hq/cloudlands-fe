import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const themes = ['light', 'dark', 'nord'] as const;
const widths = [320, 420, 640, 960] as const;
const nestedReviewRows = [
  ...widths.map((width) => ({ shard: 'pass-1-dark', theme: 'dark', width })),
  ...widths.map((width) => ({ shard: 'pass-1-nord', theme: 'nord', width })),
  ...widths.map((width) => ({ shard: 'pass-2-light', theme: 'light', width })),
  ...widths.map((width) => ({ shard: 'pass-2-dark', theme: 'dark', width })),
  ...widths.map((width) => ({ shard: 'pass-2-nord', theme: 'nord', width })),
] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ mode: 'serial' });

async function openState(page: Page, state: string, width: number, theme: string) {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=${theme}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 120_000,
  });
  await expect(
    page
      .locator(`#${state} [data-layout-settled="true"], #${state} [data-diagram-settled="true"]`)
      .first(),
  ).toBeAttached();
}

async function expectContentHuggingNodes(page: Page, identity: string) {
  const geometry = await page.evaluate(() => {
    const cases = [
      ['custom-long-multiline-labels', 'response', 1],
      ['custom-dependency-graph', 'fixtures', 2],
      ['custom-long-multiline-labels', 'tool', 3],
      ['custom-disconnected-extremes', 'multiline', 3],
    ] as const;
    const nodes = cases.map(([state, nodeId, expectedLines]) => {
      const node = document.querySelector<SVGForeignObjectElement>(
        `#${state} [data-node-id="${nodeId}"]`,
      )!;
      const body = node.querySelector<HTMLElement>('.diagram-node-html')!;
      const label = node.querySelector<HTMLElement>('.node-label')!;
      const kind = node.querySelector<HTMLElement>('.node-kind-label')!;
      const row = node.querySelector<HTMLElement>('.node-row')!;
      const nodeBounds = node.getBoundingClientRect();
      const rowBounds = row.getBoundingClientRect();
      const scale = nodeBounds.height / Number(node.getAttribute('height'));
      const style = getComputedStyle(body);
      const paddingY = Number.parseFloat(style.getPropertyValue('--padding-y'));
      const gap = Number.parseFloat(style.getPropertyValue('--gap'));
      const labelLineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
      const kindLineHeight = Number.parseFloat(getComputedStyle(kind).lineHeight);
      const range = document.createRange();
      range.selectNodeContents(label);
      const lineTops = [...range.getClientRects()]
        .filter((rect) => rect.width > 0)
        .map((rect) => Math.round(rect.top * 10) / 10);
      const uniqueLines = lineTops.filter((top, index) =>
        lineTops.slice(0, index).every((other) => Math.abs(other - top) > 1),
      ).length;
      return {
        nodeId,
        expectedLines,
        expectedHeight: Math.max(
          32,
          labelLineHeight * expectedLines + gap + kindLineHeight + paddingY * 2,
        ),
        height: Number(node.getAttribute('height')),
        uniqueLines,
        paddingY,
        topPadding: (rowBounds.top - nodeBounds.top) / scale,
        bottomPadding: (nodeBounds.bottom - rowBounds.bottom) / scale,
        contained: rowBounds.top >= nodeBounds.top && rowBounds.bottom <= nodeBounds.bottom,
      };
    });
    const routeGap = (state: string, edgeId: string, nodeId: string, end: boolean) => {
      const root = document.querySelector<HTMLElement>(`#${state}`)!;
      const path = root.querySelector<SVGPathElement>(
        `.diagram-edge[data-edge-id="${edgeId}"] path`,
      )!;
      const node = root.querySelector<SVGForeignObjectElement>(`[data-node-id="${nodeId}"]`)!;
      const length = path.getTotalLength();
      const point = path.getPointAtLength(end ? length : 0).matrixTransform(path.getScreenCTM()!);
      const bounds = node.getBoundingClientRect();
      const scale = bounds.width / Number(node.getAttribute('width'));
      const sideCenters = [
        { x: (bounds.left + bounds.right) / 2, y: bounds.top },
        { x: bounds.right, y: (bounds.top + bounds.bottom) / 2 },
        { x: (bounds.left + bounds.right) / 2, y: bounds.bottom },
        { x: bounds.left, y: (bounds.top + bounds.bottom) / 2 },
      ];
      return (
        Math.min(...sideCenters.map((side) => Math.hypot(point.x - side.x, point.y - side.y))) /
        scale
      );
    };
    return {
      nodes,
      incomingToolGap: routeGap('custom-long-multiline-labels', 'm1', 'tool', true),
      outgoingToolGap: routeGap('custom-long-multiline-labels', 'm2', 'tool', false),
      measuredGap: routeGap('custom-disconnected-extremes', 'x2', 'multiline', true),
    };
  });

  for (const node of geometry.nodes) {
    expect(node.height, `${identity}/${node.nodeId} ${JSON.stringify(node)} height`).toBeCloseTo(
      node.expectedHeight,
      2,
    );
    expect(node.uniqueLines, `${identity}/${node.nodeId} lines`).toBe(node.expectedLines);
    expect([7, 12], `${identity}/${node.nodeId} supported padding`).toContain(node.paddingY);
    expect(node.topPadding, `${identity}/${node.nodeId} top padding`).toBeCloseTo(node.paddingY, 1);
    expect(node.bottomPadding, `${identity}/${node.nodeId} bottom padding`).toBeCloseTo(
      node.paddingY,
      1,
    );
    expect(node.contained, `${identity}/${node.nodeId} containment`).toBe(true);
  }
  expect(geometry.incomingToolGap, `${identity}/tool incoming port`).toBeCloseTo(5.5, 0);
  expect(geometry.outgoingToolGap, `${identity}/tool outgoing port`).toBeCloseTo(0, 0);
  expect(geometry.measuredGap, `${identity}/Measured route incoming port`).toBeCloseTo(5.5, 0);
}

for (const theme of themes) {
  for (const width of widths) {
    test(`hugs one, two, and three line node content in ${theme} at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openState(page, 'custom-long-multiline-labels', width, theme);
      await page.evaluate(() => document.fonts.ready);
      await expectContentHuggingNodes(page, `${theme}/${width}`);
    });
  }
}

test('keeps compact dependency filenames in readable semantic units', async ({ page }) => {
  test.setTimeout(180_000);
  for (const width of [320, 420]) {
    await openState(page, 'custom-dependency-graph', width, 'light');
    const result = await page.locator('#custom-dependency-graph').evaluate((root) => {
      const expected = {
        scene: ['CatalogScene.svelte'],
        definition: ['preview-definition.ts'],
        fixtures: ['diagram-workbench.', 'preview-fixtures.ts'],
        mermaid: ['MermaidRenderer', '.svelte'],
        custom: ['DiagramRenderer', '.svelte'],
      };
      return Object.entries(expected).map(([id, units]) => {
        const node = root.querySelector<SVGGraphicsElement>(`[data-node-id="${id}"]`)!;
        const label = root.querySelector<HTMLElement>(`[data-node-id="${id}"] .node-label`)!;
        const nodeBounds = node.getBoundingClientRect();
        const parts = [...label.querySelectorAll<HTMLElement>('.semantic-filename-unit')].map(
          (part) => ({ text: part.textContent, bounds: part.getBoundingClientRect() }),
        );
        return {
          id,
          expected: units,
          actual: parts.map(({ text }) => text),
          lines: new Set(parts.map(({ bounds }) => Math.round(bounds.top))).size,
          unbroken: parts.every(({ bounds }) => bounds.height <= 18),
          contained: parts.every(
            ({ bounds }) =>
              bounds.left >= nodeBounds.left - 1 && bounds.right <= nodeBounds.right + 1,
          ),
        };
      });
    });
    expect(
      result.every(({ lines }) => lines <= 2),
      `light/${width} filename lines`,
    ).toBe(true);
    expect(
      result.every(({ unbroken, contained }) => unbroken && contained),
      `light/${width} semantic unit geometry`,
    ).toBe(true);
    expect(
      result.map(({ actual }) => actual),
      `light/${width} semantic units`,
    ).toEqual(result.map(({ expected }) => expected));
  }
});

test('keeps the disconnected observer card and content inside the 640px light frame', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openState(page, 'custom-disconnected-extremes', 640, 'light');
  const result = await page.locator('#custom-disconnected-extremes').evaluate((root) => {
    const frame = root.querySelector<HTMLElement>('.diagram-stage')!.getBoundingClientRect();
    const inside = (bounds: DOMRect) =>
      bounds.left >= frame.left - 1 &&
      bounds.top >= frame.top - 1 &&
      bounds.right <= frame.right + 1 &&
      bounds.bottom <= frame.bottom + 1;
    const labels = [...root.querySelectorAll<SVGGraphicsElement>('.edge-label-container')].map(
      (label) => {
        const bounds = label.getBoundingClientRect();
        const edge = root.querySelector<SVGPathElement>(
          `.diagram-edge[data-edge-id="${label.dataset.edgeId}"] path`,
        )!;
        const matrix = edge.getScreenCTM();
        const length = edge.getTotalLength();
        const ownsLane = Array.from({ length: 101 }, (_, index) => {
          const point = edge.getPointAtLength((length * index) / 100);
          return matrix ? point.matrixTransform(matrix) : point;
        }).some(
          (point) =>
            point.x >= bounds.left &&
            point.x <= bounds.right &&
            point.y >= bounds.top &&
            point.y <= bounds.bottom,
        );
        return {
          contained: inside(bounds),
          ownsLane,
        };
      },
    );
    const isolated = root.querySelector<SVGGraphicsElement>('[data-node-id="isolated"]')!;
    const isolatedContent = isolated.querySelector<HTMLElement>('.diagram-node-html')!;
    return {
      labels,
      isolatedText: isolatedContent.textContent?.replace(/\s+/g, ' ').trim(),
      isolatedContained: inside(isolated.getBoundingClientRect()),
      contentContained: inside(isolatedContent.getBoundingClientRect()),
    };
  });
  expect(
    result.labels.every(({ contained }) => contained),
    'light/640 label containment',
  ).toBe(true);
  expect(
    result.labels.every(({ ownsLane }) => ownsLane),
    'light/640 route ownership',
  ).toBe(true);
  expect(result.isolatedText).toContain('Disconnected observer');
  expect(result.isolatedContained, 'light/640 isolated card containment').toBe(true);
  expect(result.contentContained, 'light/640 isolated content containment').toBe(true);
});

test('reserves final measured nested Mermaid group header bands', async ({ page }) => {
  test.setTimeout(360_000);
  expect(nestedReviewRows).toHaveLength(20);
  for (const { shard, theme, width } of nestedReviewRows) {
    const identity = `${shard}/${width}/mermaid-nested-groups`;
    await openState(page, 'mermaid-nested-groups', width, theme);
    const result = await page
      .locator('#mermaid-nested-groups svg[data-layout-settled="true"]')
      .evaluate((svg) => {
        const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
        const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
        const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')];
        return [...svg.querySelectorAll<SVGGElement>('g.cluster')].map((cluster) => {
          const frame = cluster
            .querySelector<SVGRectElement>(':scope > rect')!
            .getBoundingClientRect();
          const title = cluster
            .querySelector<SVGGElement>(':scope > .cluster-label')!
            .getBoundingClientRect();
          const members = nodes
            .map((node) => node.getBoundingClientRect())
            .filter(
              (node) =>
                node.left >= frame.left - 1 &&
                node.right <= frame.right + 1 &&
                node.top >= frame.top - 1 &&
                node.bottom <= frame.bottom + 1,
            );
          const routeCrosses = paths.some((path) => {
            const matrix = path.getScreenCTM();
            const length = path.getTotalLength();
            return Array.from({ length: 201 }, (_, index) => {
              const point = path.getPointAtLength((length * index) / 200);
              return matrix ? point.matrixTransform(matrix) : point;
            }).some(
              (point) =>
                point.x > title.left &&
                point.x < title.right &&
                point.y > title.top &&
                point.y < title.bottom,
            );
          });
          const labelCrosses = labels.some((label) => {
            const bounds = label.getBoundingClientRect();
            return (
              bounds.left < title.right &&
              bounds.right > title.left &&
              bounds.top < title.bottom &&
              bounds.bottom > title.top
            );
          });
          return {
            header: Number(cluster.dataset.headerHeight),
            gap: Math.min(...members.map((member) => member.top - title.bottom)),
            routeCrosses,
            labelCrosses,
          };
        });
      });
    expect(
      width > 420 || result.every(({ header }) => header >= 52),
      `${identity} measured header`,
    ).toBe(true);
    expect(
      result.every(({ gap }) => gap >= 10),
      `${identity} header gap`,
    ).toBe(true);
    expect(
      result.some(({ routeCrosses, labelCrosses }) => routeCrosses || labelCrosses),
      `${identity} header collision`,
    ).toBe(false);
    const returnRoute = await page
      .locator('#mermaid-nested-groups svg[data-layout-settled="true"]')
      .evaluate((svg) => {
        const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
        const path = paths.find((item) => item.id.includes('-L_Store_Client_'))!;
        const node = (id: string) =>
          [...svg.querySelectorAll<SVGGElement>('g.node')].find((item) =>
            item.id.includes(`flowchart-${id}-`),
          )!;
        const source = node('Store').getBoundingClientRect();
        const target = node('Client').getBoundingClientRect();
        const label = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].find(
          (item) => item.textContent?.trim() === 'result',
        )!;
        const labelBounds = label.getBoundingClientRect();
        const matrix = path.getScreenCTM()!;
        const length = path.getTotalLength();
        const point = (offset: number) => path.getPointAtLength(offset).matrixTransform(matrix);
        const start = point(0);
        const end = point(length);
        const tangent = point(length - 0.25);
        const pathBounds = path.getBoundingClientRect();
        const frame = svg.getBoundingClientRect();
        const samples = Array.from({ length: 201 }, (_, index) => point((length * index) / 200));
        const ownsLabel = Array.from({ length: 201 }, (_, index) =>
          point((length * index) / 200),
        ).some(
          (sample) =>
            sample.x >= labelBounds.left &&
            sample.x <= labelBounds.right &&
            sample.y >= labelBounds.top &&
            sample.y <= labelBounds.bottom,
        );
        const otherNodes = [...svg.querySelectorAll<SVGGElement>('g.node')].filter(
          (item) => item !== node('Store') && item !== node('Client'),
        );
        const crossesNode = samples.slice(2, -2).some((sample) =>
          otherNodes.some((item) => {
            const bounds = item.getBoundingClientRect();
            return (
              sample.x > bounds.left - 1 &&
              sample.x < bounds.right + 1 &&
              sample.y > bounds.top - 1 &&
              sample.y < bounds.bottom + 1
            );
          }),
        );
        const markerId = path.getAttribute('marker-end')!.match(/#([^)'"]+)/)![1];
        const labelCrossesNode = [...svg.querySelectorAll<SVGGElement>('g.node')].some((item) => {
          const bounds = item.getBoundingClientRect();
          return (
            labelBounds.left < bounds.right &&
            labelBounds.right > bounds.left &&
            labelBounds.top < bounds.bottom &&
            labelBounds.bottom > bounds.top
          );
        });
        const crossesRoute = paths
          .filter((item) => item !== path)
          .some((otherPath) => {
            const otherMatrix = otherPath.getScreenCTM();
            const otherLength = otherPath.getTotalLength();
            if (!otherMatrix || otherLength === 0) return false;
            const otherSamples = Array.from({ length: 121 }, (_, index) =>
              otherPath.getPointAtLength((otherLength * index) / 120).matrixTransform(otherMatrix),
            );
            return samples
              .slice(4, -4)
              .some((sample) =>
                otherSamples.some(
                  (other) => Math.hypot(sample.x - other.x, sample.y - other.y) < 2,
                ),
              );
          });
        const marker = svg.querySelector<SVGMarkerElement>(`#${CSS.escape(markerId)}`)!;
        const markerPath = marker.querySelector<SVGPathElement>('path')!;
        const terminalGap = Number(path.dataset.terminalGapCss);
        const markerStroke = Number.parseFloat(getComputedStyle(markerPath).strokeWidth);
        return {
          sourceDistance: Math.hypot(
            start.x - source.right,
            start.y - (source.top + source.bottom) / 2,
          ),
          targetDistance: Math.hypot(
            end.x - target.right,
            end.y - (target.top + target.bottom) / 2,
          ),
          perpendicular: Math.abs(end.y - tangent.y),
          contained:
            pathBounds.left >= frame.left - 1 &&
            pathBounds.top >= frame.top - 1 &&
            pathBounds.right <= frame.right + 1 &&
            pathBounds.bottom <= frame.bottom + 1,
          ownsLabel,
          visibleShaft: length > 20 && Math.max(pathBounds.width, pathBounds.height) > 10,
          crossesNode,
          labelCrossesNode,
          crossesRoute,
          markerWidth: Number(marker.getAttribute('markerWidth')),
          expectedTargetDistance: terminalGap + markerStroke / 2,
          moves: (path.getAttribute('d')?.match(/M/g) ?? []).length,
        };
      });
    expect(returnRoute.sourceDistance, `${identity} return source port`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(returnRoute.targetDistance - returnRoute.expectedTargetDistance),
      `${identity} return target arrow gap`,
    ).toBeLessThanOrEqual(0.35);
    expect(returnRoute.perpendicular, `${identity} return target tangent`).toBeLessThanOrEqual(
      0.01,
    );
    expect(returnRoute.contained, `${identity} return containment`).toBe(true);
    expect(returnRoute.ownsLabel, `${identity} result label ownership`).toBe(true);
    expect(returnRoute.visibleShaft, `${identity} visible result shaft`).toBe(true);
    expect(returnRoute.crossesNode, `${identity} result node collision`).toBe(false);
    expect(returnRoute.labelCrossesNode, `${identity} result label collision`).toBe(false);
    expect(returnRoute.crossesRoute, `${identity} result route collision`).toBe(false);
    expect(returnRoute.markerWidth, `${identity} result marker`).toBeGreaterThan(0);
    expect(returnRoute.moves, `${identity} continuous return route`).toBe(1);
  }
});

test('terminates compact cycle feedback on real centered cardinal ports', async ({ page }) => {
  test.setTimeout(240_000);
  for (const theme of themes) {
    for (const width of widths) {
      await openState(page, 'mermaid-cycle-fanout', width, theme);
      const result = await page
        .locator('#mermaid-cycle-fanout svg[data-layout-settled="true"]')
        .evaluate((svg) => {
          const path = svg.querySelector<SVGPathElement>('path[data-feedback-lane="outer"]')!;
          const node = (id: string) =>
            [...svg.querySelectorAll<SVGGElement>('g.node')].find((item) =>
              item.id.includes(`flowchart-${id}-`),
            )!;
          const source = node(path.dataset.feedbackSource!).getBoundingClientRect();
          const target = node(path.dataset.feedbackTarget!).getBoundingClientRect();
          const matrix = path.getScreenCTM()!;
          const length = path.getTotalLength();
          const point = (offset: number) => path.getPointAtLength(offset).matrixTransform(matrix);
          const start = point(0);
          const end = point(length);
          const tangent = point(length - 0.25);
          const bounds = path.getBoundingClientRect();
          const frame = svg.getBoundingClientRect();
          const markerId = path.getAttribute('marker-end')!.match(/#([^)'\"]+)/)![1];
          const marker = svg.querySelector<SVGMarkerElement>(`#${CSS.escape(markerId)}`)!;
          const markerPath = marker.querySelector<SVGPathElement>('path')!;
          return {
            sourceDistance: Math.hypot(
              start.x - source.right,
              start.y - (source.top + source.bottom) / 2,
            ),
            targetDistance: Math.hypot(
              end.x - (target.left + target.right) / 2,
              end.y - target.bottom,
            ),
            perpendicular: Math.abs(end.x - tangent.x),
            contained:
              bounds.left >= frame.left - 1 &&
              bounds.top >= frame.top - 1 &&
              bounds.right <= frame.right + 1 &&
              bounds.bottom <= frame.bottom + 1,
            markerWidth: Number(marker.getAttribute('markerWidth')),
            expectedTargetDistance:
              Number(path.dataset.terminalGapCss) +
              Number.parseFloat(getComputedStyle(markerPath).strokeWidth) / 2,
            moves: (path.getAttribute('d')!.match(/M/g) ?? []).length,
          };
        });
      expect(result.sourceDistance, `${theme}/${width} source port`).toBeLessThanOrEqual(1);
      expect(
        Math.abs(result.targetDistance - result.expectedTargetDistance),
        `${theme}/${width} target arrow gap`,
      ).toBeLessThanOrEqual(0.35);
      expect(result.perpendicular, `${theme}/${width} target tangent`).toBeLessThanOrEqual(0.01);
      expect(result.contained, `${theme}/${width} route containment`).toBe(true);
      expect(result.markerWidth, `${theme}/${width} marker size`).toBeLessThanOrEqual(8);
      expect(result.moves, `${theme}/${width} continuous route`).toBe(1);
    }
  }
});
