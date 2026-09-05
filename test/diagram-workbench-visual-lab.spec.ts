import { expect, test, type Page } from '@playwright/test';
import {
  DIAGRAM_WORKBENCH_CASE_GROUPS,
  DIAGRAM_WORKBENCH_CASES,
} from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function openSandbox(page: Page, query: string) {
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?${query}`);
  const scene = page.getByTestId('catalog-scene');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 90_000 });
  await expect(scene).toHaveAttribute('data-preview-stable', 'true');
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
    { timeout: 90_000 },
  );
  await expect(page.locator('.mermaid-svg > svg:not([data-layout-settled="true"])')).toHaveCount(0);
}

test('renders all 36 diagram cases together without the dense review shell', async ({ page }) => {
  await openSandbox(page, 'state=mermaid-flow&theme=light&width=960&motion=reduced');

  const orderedCaseIds = DIAGRAM_WORKBENCH_CASE_GROUPS.flatMap(({ caseIds }) => caseIds);
  expect(
    await page.locator('[data-diagram-case]').evaluateAll((cases) => cases.map(({ id }) => id)),
  ).toEqual(orderedCaseIds);
  await expect(page.locator('[data-diagram-case]')).toHaveCount(36);
  await expect(page.locator('[data-diagram-case] .mermaid-renderer')).toHaveCount(21);
  await expect(page.locator('[data-diagram-case] .diagram-renderer')).toHaveCount(14);
  await expect(page.locator('[data-diagram-case] .loading-state')).toHaveCount(1);

  const loading = page.locator('#mermaid-loading .loading-state');
  await expect(loading).toHaveAttribute('role', 'status');
  await expect(loading).toHaveAttribute('aria-label', 'Diagram is loading');
  await expect(loading).toHaveText('Rendering diagram…');
  await expect(loading.locator('svg, img, span, [aria-hidden="true"]')).toHaveCount(0);
  expect(
    await loading.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        childTags: [...element.children].map(({ tagName }) => tagName),
        borderWidths: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
        animationName: style.animationName,
      };
    }),
  ).toEqual({
    childTags: ['P'],
    borderWidths: ['0px', '0px', '0px', '0px'],
    animationName: 'none',
  });

  for (const id of orderedCaseIds) {
    const fixture = DIAGRAM_WORKBENCH_CASES[id];
    const diagramCase = page.locator(`[data-diagram-case="${id}"]`);
    await expect(diagramCase.getByRole('heading', { name: fixture.title })).toBeVisible();
    await expect(diagramCase.getByText(fixture.description, { exact: true })).toBeVisible();
  }

  await expect(page.locator('[data-diagram-review-lab], [data-review-overview]')).toHaveCount(0);
  await expect(page.locator('[data-review-comparison], [data-review-diagnostics]')).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('.view-switcher, .case-groups, .case-groups details')).toHaveCount(0);

  const targetedSurface = await page.locator('#mermaid-flow').evaluate((diagramCase) => ({
    host: getComputedStyle(diagramCase).backgroundColor,
    canvas: getComputedStyle(diagramCase.querySelector('.mermaid-svg > svg')!).backgroundColor,
  }));
  expect(targetedSurface.canvas).toBe(targetedSurface.host);
});

test('uses open chevrons for directed routes while preserving semantic markers', async ({
  page,
}) => {
  await openSandbox(page, 'state=mermaid-flow&theme=light&width=960&motion=reduced');

  const markers = await page.evaluate(() => {
    const markerFor = (path: Element, attribute: 'marker-start' | 'marker-end') => {
      const reference = path.getAttribute(attribute) ?? '';
      const markerId = reference.match(/#([^)'"]+)/)?.[1] ?? '';
      return document.querySelector<SVGMarkerElement>(`marker[id="${CSS.escape(markerId)}"]`);
    };
    const directed = [...document.querySelectorAll('.mermaid-svg [marker-end]')]
      .flatMap((path) => {
        const marker = markerFor(path, 'marker-end');
        return marker?.dataset.diagramChevron === 'true' ? [{ path, marker }] : [];
      })
      .concat(
        [...document.querySelectorAll('.diagram-edge [marker-end]')].flatMap((path) => {
          const marker = markerFor(path, 'marker-end');
          return marker ? [{ path, marker }] : [];
        }),
      );
    const hasRightAngleWings = (shape: SVGPathElement) => {
      const values = shape
        .getAttribute('d')
        ?.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)
        ?.map(Number);
      if (!values || values.length !== 6) return false;
      const [x1, y1, tipX, tipY, x2, y2] = values;
      const first = { x: x1 - tipX, y: y1 - tipY };
      const second = { x: x2 - tipX, y: y2 - tipY };
      return (
        Math.abs(first.x * second.x + first.y * second.y) < 0.001 &&
        Math.abs(Math.hypot(first.x, first.y) - Math.hypot(second.x, second.y)) < 0.001
      );
    };
    const failures = directed.flatMap(({ path, marker }) => {
      const shape = marker.querySelector<SVGPathElement>('path');
      const style = shape && getComputedStyle(shape);
      const pathStyle = getComputedStyle(path);
      return shape &&
        shape.getAttribute('fill') === 'none' &&
        style?.fill === 'none' &&
        shape.getAttribute('stroke') === 'context-stroke' &&
        style.strokeLinecap === 'round' &&
        style.strokeLinejoin === 'round' &&
        hasRightAngleWings(shape) &&
        Number(marker.getAttribute('markerWidth')) / Number.parseFloat(pathStyle.strokeWidth) >= 4
        ? []
        : [marker.id];
    });
    const classMarkers = [...document.querySelectorAll('#mermaid-class [marker-start]')].map(
      (path) => {
        const marker = markerFor(path, 'marker-start');
        const shape = marker?.querySelector<SVGPathElement>('path');
        return { id: marker?.id ?? '', fill: shape ? getComputedStyle(shape).fill : '' };
      },
    );
    return {
      count: directed.length,
      failures,
      inheritanceOpen: classMarkers.some(
        ({ id, fill }) => id.includes('extensionStart') && fill === 'rgba(0, 0, 0, 0)',
      ),
      compositionFilled: classMarkers.some(
        ({ id, fill }) => id.includes('compositionStart') && fill !== 'rgba(0, 0, 0, 0)',
      ),
    };
  });

  expect(markers.count).toBeGreaterThan(50);
  expect(markers.failures).toEqual([]);
  expect(markers.inheritanceOpen).toBe(true);
  expect(markers.compositionFilled).toBe(true);
});

test('uses the direct state as a stable initial scroll target without hiding cases', async ({
  page,
}) => {
  await openSandbox(
    page,
    'state=custom-bindings&review=compare&compare=mermaid-flow&theme=dark&width=960&motion=reduced',
  );

  const target = page.locator('#custom-bindings');
  await expect(target).toHaveAttribute('data-targeted', 'true');
  await expect(page.locator('[data-diagram-case]')).toHaveCount(32);
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      return box?.y ?? Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(80);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('keeps each diagram interaction scoped and usable on the long page', async ({ page }) => {
  await openSandbox(page, 'state=custom-bindings&theme=light&width=960&motion=reduced');

  const bindingCase = page.locator('#custom-bindings');
  const binding = bindingCase.getByRole('button', {
    name: /open review retry criteria note binding/i,
  });
  await expect(bindingCase.locator('.diagram-actions')).toHaveCSS('opacity', '0');
  await binding.focus();
  await expect(bindingCase.locator('.diagram-actions')).toHaveCSS('opacity', '1');
  await binding.click();
  await expect(bindingCase.locator('[data-binding-target]')).toContainText('note: bf4d5bc8');

  const walkthroughCase = page.locator('#custom-walkthrough');
  const firstStep = walkthroughCase.locator('[data-diagram-step-index="0"]');
  await firstStep.focus();
  await firstStep.press('ArrowRight');
  await expect(walkthroughCase.getByLabel('Step 2 of 3')).toBeVisible();

  const mermaidCase = page.locator('#mermaid-flow');
  const mermaidActions = mermaidCase.locator('.mermaid-actions');
  const viewSource = mermaidCase.getByRole('button', { name: 'View source' });
  await expect(mermaidActions).toHaveCSS('opacity', '0');
  await mermaidCase.locator('.mermaid-svg-container').hover();
  await expect(mermaidActions).toHaveCSS('opacity', '1');
  await viewSource.click();
  await expect(mermaidCase.getByRole('region', { name: 'View source' })).toBeVisible();
  await viewSource.click();
  await mermaidCase.getByRole('button', { name: 'Expand diagram to fullscreen' }).click();
  await expect(page.getByRole('dialog', { name: 'Fullscreen diagram view' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('keeps the complete page responsive in light, dark, wide, and narrow views', async ({
  page,
}) => {
  for (const [theme, width] of [
    ['light', 960],
    ['light', 420],
    ['dark', 320],
  ] as const) {
    await openSandbox(page, `state=mermaid-flow&theme=${theme}&width=${width}&motion=reduced`);

    await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', theme);
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
      'data-catalog-motion',
      'reduced',
    );
    await expect(page.locator('[data-diagram-case]')).toHaveCount(32);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page
        .getByTestId('catalog-scene-focus')
        .evaluate((focus, maxWidth) => focus.getBoundingClientRect().width <= maxWidth + 1, width),
    ).toBe(true);
    if (width <= 420) {
      const readability = await page.evaluate(() => {
        const mermaid = [...document.querySelectorAll<SVGSVGElement>('.mermaid-svg > svg')].map(
          (svg) =>
            (svg.getBoundingClientRect().height / svg.viewBox.baseVal.height) *
            Number.parseFloat(getComputedStyle(svg).fontSize),
        );
        const custom = [...document.querySelectorAll<SVGSVGElement>('.diagram-svg-layer')];
        const effective = (selector: string) =>
          custom.flatMap((svg) => {
            const scale = svg.getBoundingClientRect().width / svg.width.baseVal.value;
            return [...svg.querySelectorAll<HTMLElement>(selector)].map(
              (element) => Number.parseFloat(getComputedStyle(element).fontSize) * scale,
            );
          });
        return {
          primary: Math.min(...mermaid, ...effective('.node-label, .edge-label-html')),
          secondary: Math.min(...effective('.node-kind-label')),
          overflows: [...document.querySelectorAll<HTMLElement>('.mermaid-svg-viewport')].map(
            (viewport) => viewport.scrollWidth - viewport.clientWidth,
          ),
        };
      });
      expect(readability.primary).toBeGreaterThanOrEqual(11.99);
      expect(readability.secondary).toBeGreaterThanOrEqual(9.99);
      expect(Math.max(...readability.overflows)).toBeLessThanOrEqual(8);
    }
  }

  const sourceCase = page.locator('#mermaid-flow');
  await sourceCase.locator('.mermaid-svg-container').hover();
  await sourceCase.getByRole('button', { name: 'View source' }).click();
  const source = sourceCase.locator('.mermaid-source pre');
  await expect(source).toHaveText(DIAGRAM_WORKBENCH_CASES['mermaid-flow'].source!);
  expect(
    await source.evaluate((pre) => ({
      contained: pre.scrollWidth <= pre.clientWidth + 1,
      wrapping: getComputedStyle(pre).whiteSpace,
    })),
  ).toEqual({ contained: true, wrapping: 'pre-wrap' });

  await page.getByRole('button', { name: 'Color theme' }).click();
  await page.getByRole('option', { name: 'Nord', exact: true }).click();
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
    'data-catalog-color-theme',
    'nord',
  );

  const presentation = await page.locator('[data-diagram-workbench]').evaluate((workbench) => {
    const style = (selector: string) => getComputedStyle(workbench.querySelector(selector)!);
    return {
      headingFonts: ['.page-header h1', '.group-header h2', '.case-header h3'].map(
        (selector) => style(selector).fontFamily,
      ),
      headingTransforms: ['.group-header h2', '.case-header h3'].map(
        (selector) => style(selector).textTransform,
      ),
      stageBackground: style('.diagram-stage').backgroundColor,
    };
  });
  expect(presentation.headingFonts.every((font) => font.includes('Source Serif 4'))).toBe(true);
  expect(presentation.headingTransforms).toEqual(['none', 'none']);
  expect(presentation.stageBackground).toBe('rgba(0, 0, 0, 0)');
});

test('keeps custom routes, labels, markers, and group headings precise', async ({ page }) => {
  await openSandbox(page, 'state=custom-bindings&theme=light&width=960&motion=reduced');

  const architecture = page.locator('#custom-bindings');
  const fit = architecture.locator('.diagram-fit-button');
  await expect(fit).toHaveAccessibleName(/fit diagram to width/i);
  await fit.focus();
  await expect(architecture.locator('.diagram-actions')).toHaveCSS('opacity', '1');
  await fit.click();
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const geometry = await architecture.evaluate((root) => {
    const routeDistance = (path: SVGGeometryElement, x: number, y: number) => {
      const total = path.getTotalLength();
      let distance = Number.POSITIVE_INFINITY;
      for (let step = 0; step <= 2000; step += 1) {
        const point = path.getPointAtLength((total * step) / 2000);
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(
          path.getScreenCTM() ?? new DOMMatrix(),
        );
        distance = Math.min(distance, Math.hypot(x - screenPoint.x, y - screenPoint.y));
      }
      return distance;
    };

    return {
      pathWidths: [...root.querySelectorAll<SVGPathElement>('.edge-path')].map(
        (path) => getComputedStyle(path).strokeWidth,
      ),
      markerWidths: [...root.querySelectorAll('marker path')].map((path) =>
        path.getAttribute('stroke-width'),
      ),
      labelConnections: [...root.querySelectorAll('.edge-label-container')].map((label) => {
        const edgeId = label.getAttribute('data-edge-id');
        const path = root.querySelector<SVGGeometryElement>(
          `.diagram-edge[data-edge-id="${edgeId}"] .edge-path`,
        )!;
        const rect = label.getBoundingClientRect();
        return {
          pathDistance: routeDistance(path, rect.left + rect.width / 2, rect.top + rect.height / 2),
          borderWidth: getComputedStyle(label.querySelector('.edge-label-html')!).borderWidth,
        };
      }),
      groupLabels: [...root.querySelectorAll('.diagram-group')].map((group) => {
        const outline = group.querySelector('.group-bg')!.getBoundingClientRect();
        const label = group.querySelector('.group-label')!.getBoundingClientRect();
        const scale = Math.abs((group as SVGGElement).getScreenCTM()?.a ?? 1);
        return {
          horizontalOffset: Math.abs((label.left + label.right - outline.left - outline.right) / 2),
          verticalImbalance: Math.abs(
            label.top - outline.top - (outline.top + 34 * scale - label.bottom),
          ),
        };
      }),
      insideViewport: (() => {
        const viewport = root.querySelector('.diagram-scroll-container')!.getBoundingClientRect();
        return [
          ...root.querySelectorAll('.diagram-group, .diagram-node-html, .edge-label-container'),
        ].every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1;
        });
      })(),
    };
  });

  expect(
    geometry.pathWidths.every((width) => {
      const value = Number.parseFloat(width);
      return value >= 1 && value <= 1.25;
    }),
  ).toBe(true);
  expect(geometry.markerWidths.every((width) => width === '1')).toBe(true);
  expect(geometry.labelConnections.every(({ pathDistance }) => pathDistance <= 1)).toBe(true);
  expect(geometry.labelConnections.every(({ borderWidth }) => borderWidth === '0px')).toBe(true);
  expect(geometry.groupLabels.every(({ horizontalOffset }) => horizontalOffset <= 1)).toBe(true);
  expect(geometry.groupLabels.every(({ verticalImbalance }) => verticalImbalance <= 1)).toBe(true);
  expect(geometry.insideViewport).toBe(true);

  await openSandbox(page, 'state=custom-state-machine&theme=dark&width=960&motion=reduced');
  const negativeRoute = await page.locator('#custom-state-machine').evaluate((root) => {
    const label = root.querySelector<SVGForeignObjectElement>(
      '.edge-label-container[data-edge-id="st3"]',
    )!;
    const labelRect = label.getBoundingClientRect();
    const path = root.querySelector<SVGGeometryElement>(
      '.diagram-edge[data-edge-id="st3"] .edge-path',
    )!;
    const total = path.getTotalLength();
    let routeDistance = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 2000; step += 1) {
      const point = path.getPointAtLength((total * step) / 2000);
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      routeDistance = Math.min(
        routeDistance,
        Math.hypot(
          labelRect.left + labelRect.width / 2 - screenPoint.x,
          labelRect.top + labelRect.height / 2 - screenPoint.y,
        ),
      );
    }
    return {
      hasLeader: Boolean(root.querySelector('.edge-label-leader[data-edge-id="st3"]')),
      routeDistance,
      borderWidth: getComputedStyle(label.querySelector('.edge-label-html')!).borderWidth,
    };
  });
  expect(negativeRoute.hasLeader).toBe(false);
  expect(negativeRoute.routeDistance).toBeLessThanOrEqual(1);
  expect(negativeRoute.borderWidth).toBe('0px');
});

test('keeps the named dashed return routes continuous on cardinal ports', async ({ page }) => {
  await openSandbox(page, 'state=custom-sequence&theme=light&width=320&motion=reduced');
  const routes = await page.evaluate(() => {
    const cases = [
      ['custom-sequence', 's4', 'capture', 'author'],
      ['custom-state-machine', 'st4', 'error', 'idle'],
      ['custom-data-flow', 'd5', 'source', 'store'],
      ['custom-topology-stress', 'z11', 'audit', 'gate'],
    ];
    const cardinalDistance = (point: DOMPoint, bounds: DOMRect) =>
      Math.min(
        Math.hypot(point.x - (bounds.left + bounds.width / 2), point.y - bounds.top),
        Math.hypot(point.x - (bounds.left + bounds.width / 2), point.y - bounds.bottom),
        Math.hypot(point.x - bounds.left, point.y - (bounds.top + bounds.height / 2)),
        Math.hypot(point.x - bounds.right, point.y - (bounds.top + bounds.height / 2)),
      );
    return cases.map(([caseId, edgeId, sourceId, targetId]) => {
      const root = document.getElementById(caseId)!;
      const path = root.querySelector<SVGPathElement>(`[data-edge-id='${edgeId}'] .edge-path`)!;
      const matrix = path.getScreenCTM()!;
      const start = path.getPointAtLength(0).matrixTransform(matrix);
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      const node = (id: string) =>
        root
          .querySelector<HTMLElement>(`[data-node-id='${id}'] .diagram-node-html`)!
          .getBoundingClientRect();
      return {
        edgeId,
        sourceDistance: cardinalDistance(start, node(sourceId)),
        targetDistance: cardinalDistance(end, node(targetId)),
        marker: path.getAttribute('marker-end'),
        dash: getComputedStyle(path).strokeDasharray,
      };
    });
  });
  for (const route of routes) {
    expect(route.sourceDistance, `${route.edgeId} source port`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(route.targetDistance - 0.5 - 5),
      `${route.edgeId} painted target gap`,
    ).toBeLessThanOrEqual(0.35);
    expect(route.marker).toContain('arrowhead');
    expect(route.dash).not.toBe('none');
  }
});

test('keeps final diagram geometry polished across themes and widths', async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1400, height: 1000 });

  for (const colorTheme of ['default-light', 'default-dark', 'nord'] as const) {
    if (colorTheme === 'nord') {
      await openSandbox(page, 'state=mermaid-cycle-fanout&theme=light&width=960&motion=reduced');
      await page.getByTestId('catalog-color-theme-control').click();
      await page.getByRole('option', { name: 'Nord', exact: true }).click();
    }

    for (const width of [960, 640, 420] as const) {
      const theme = colorTheme === 'default-dark' ? 'dark' : 'light';
      await openSandbox(
        page,
        `state=mermaid-cycle-fanout&theme=${theme}&width=${width}&motion=reduced`,
      );
      if (colorTheme === 'nord') {
        await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
          'data-catalog-color-theme',
          'nord',
        );
      }

      await expect(page.locator('#mermaid-long-labels .mermaid-svg > svg')).toBeVisible();
      await expect(page.locator('#mermaid-cycle-fanout .mermaid-svg > svg')).toBeVisible();
      const walkthrough = page.locator('#custom-walkthrough');
      await walkthrough.locator('[data-diagram-step-index="1"]').click();

      const geometry = await page.evaluate(() => {
        const intersects = (a: DOMRect, b: DOMRect, padding = 0) =>
          a.left < b.right + padding &&
          a.right > b.left - padding &&
          a.top < b.bottom + padding &&
          a.bottom > b.top - padding;
        const routeDistance = (path: SVGGeometryElement, x: number, y: number) => {
          const total = path.getTotalLength();
          const matrix = path.getScreenCTM() ?? new DOMMatrix();
          let distance = Number.POSITIVE_INFINITY;
          for (let step = 0; step <= 2000; step += 1) {
            const point = path.getPointAtLength((total * step) / 2000).matrixTransform(matrix);
            distance = Math.min(distance, Math.hypot(x - point.x, y - point.y));
          }
          return distance;
        };
        const isStraightLinePath = (pathData: string) => {
          if (/[CQAHVST]/i.test(pathData)) return false;
          const values = pathData.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)?.map(Number) ?? [];
          const points = Array.from({ length: values.length / 2 }, (_, index) => ({
            x: values[index * 2],
            y: values[index * 2 + 1],
          }));
          const directions = points.slice(1).flatMap((point, index) => {
            const previous = points[index];
            if (point.x === previous.x && point.y === previous.y) return [];
            return [point.x === previous.x ? 'vertical' : 'horizontal'];
          });
          return new Set(directions).size <= 1;
        };
        const surfaceFailures = [
          ['#mermaid-state', '.mermaid-svg > svg', 'backgroundColor'],
          ['#mermaid-state', '.edgeLabel rect.background', 'fill'],
          ['#mermaid-nested-groups', '.mermaid-svg > svg', 'backgroundColor'],
          ['#mermaid-nested-groups', '.cluster > rect', 'fill'],
          ['#custom-bindings', '.diagram-svg-layer', 'backgroundColor'],
          ['#custom-bindings', '.edge-label-html', 'backgroundColor'],
          ['#custom-walkthrough', '.diagram-svg-layer', 'backgroundColor'],
          ['#custom-walkthrough', '.edge-label-html', 'backgroundColor'],
        ].flatMap(([rootSelector, targetSelector, property]) => {
          const root = document.querySelector<HTMLElement>(rootSelector)!;
          const probe = document.createElement('span');
          probe.style.background = 'var(--diagram-host-surface)';
          root.append(probe);
          const surface = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const targets = [...root.querySelectorAll(targetSelector)];
          return targets.length > 0 &&
            targets.every((target) => getComputedStyle(target)[property as 'fill'] === surface)
            ? []
            : [`${rootSelector} ${targetSelector}`];
        });

        const longRoot = document.querySelector('#mermaid-long-labels')!;
        const longSvg = longRoot.querySelector<SVGSVGElement>('.mermaid-svg > svg')!;
        const longSvgRect = longSvg.getBoundingClientRect();
        const longOutlines = [...longRoot.querySelectorAll<SVGRectElement>('.node > rect')].map(
          (outline) => {
            const rect = outline.getBoundingClientRect();
            const style = getComputedStyle(outline);
            return {
              inset: Math.min(
                rect.left - longSvgRect.left,
                rect.top - longSvgRect.top,
                longSvgRect.right - rect.right,
                longSvgRect.bottom - rect.bottom,
              ),
              radius: Number.parseFloat(style.rx),
              strokeWidth: Number.parseFloat(style.strokeWidth),
            };
          },
        );

        const cyclePaths = [
          ...document.querySelectorAll<SVGPathElement>('#mermaid-cycle-fanout .flowchart-link'),
        ].map((path) => ({
          data: path.getAttribute('d') ?? '',
          radius: Number(path.dataset.cornerRadius ?? 0),
          straight: isStraightLinePath(path.getAttribute('d') ?? ''),
        }));

        const customRoot = document.querySelector('#custom-walkthrough')!;
        const labels = [
          ...customRoot.querySelectorAll<SVGForeignObjectElement>('.edge-label-container'),
        ].map((label) => {
          const edgeId = label.dataset.edgeId!;
          const rect = label.getBoundingClientRect();
          const path = customRoot.querySelector<SVGGeometryElement>(
            `.diagram-edge[data-edge-id="${CSS.escape(edgeId)}"] .edge-path`,
          )!;
          const content = label.querySelector<HTMLElement>('.edge-label-html')!;
          return {
            edgeId,
            rect,
            routeDistance: routeDistance(
              path,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            ),
            borderStyle: getComputedStyle(content).borderStyle,
            borderWidth: getComputedStyle(content).borderWidth,
          };
        });
        const nodes = [...customRoot.querySelectorAll('.diagram-node-html')].map((node) =>
          node.getBoundingClientRect(),
        );
        const customPaths = [...customRoot.querySelectorAll<SVGPathElement>('.edge-path')];
        const compactCustom = Boolean(customRoot.querySelector('.compact-diagram'));
        const pathSamples = customPaths.map((path) => {
          const total = path.getTotalLength();
          const matrix = path.getScreenCTM() ?? new DOMMatrix();
          return Array.from({ length: 121 }, (_, index) =>
            path.getPointAtLength((total * index) / 120).matrixTransform(matrix),
          );
        });
        const insideNode = (point: DOMPoint) =>
          nodes.some(
            (node) =>
              point.x >= node.left - 2 &&
              point.x <= node.right + 2 &&
              point.y >= node.top - 2 &&
              point.y <= node.bottom + 2,
          );
        const cross = (a: DOMPoint, b: DOMPoint, c: DOMPoint) =>
          (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        let routeCrossings = 0;
        for (let first = 0; !compactCustom && first < pathSamples.length; first += 1) {
          for (let second = first + 1; second < pathSamples.length; second += 1) {
            for (let a = 1; a < pathSamples[first].length; a += 1) {
              const a1 = pathSamples[first][a - 1];
              const a2 = pathSamples[first][a];
              if (insideNode(a1) || insideNode(a2)) continue;
              for (let b = 1; b < pathSamples[second].length; b += 1) {
                const b1 = pathSamples[second][b - 1];
                const b2 = pathSamples[second][b];
                if (insideNode(b1) || insideNode(b2)) continue;
                if (
                  cross(a1, a2, b1) * cross(a1, a2, b2) < -0.01 &&
                  cross(b1, b2, a1) * cross(b1, b2, a2) < -0.01
                ) {
                  routeCrossings += 1;
                }
              }
            }
          }
        }
        const unrelatedRouteLabelCrossings = compactCustom
          ? []
          : customPaths.flatMap((path) => {
              const edgeId = path.closest('.diagram-edge')?.getAttribute('data-edge-id');
              return labels.filter((label) => {
                if (label.edgeId === edgeId) return false;
                const total = path.getTotalLength();
                const matrix = path.getScreenCTM() ?? new DOMMatrix();
                for (let step = 1; step < 300; step += 1) {
                  const point = path.getPointAtLength((total * step) / 300).matrixTransform(matrix);
                  if (
                    point.x > label.rect.left &&
                    point.x < label.rect.right &&
                    point.y > label.rect.top &&
                    point.y < label.rect.bottom
                  ) {
                    return true;
                  }
                }
                return false;
              });
            });
        const content = customRoot.querySelector('.diagram-content')!.getBoundingClientRect();
        const footer = customRoot.querySelector('.diagram-footer')!.getBoundingClientRect();

        return {
          surfaceFailures,
          longOutlines,
          cyclePaths,
          labelDistances: labels.map((label) => label.routeDistance),
          labelsUnbordered: labels.every(
            (label) => label.borderStyle === 'none' && label.borderWidth === '0px',
          ),
          labelsClearNodes: labels.every((label) =>
            nodes.every((node) => !intersects(label.rect, node, 1)),
          ),
          labelsClearLabels: labels.every((label, index) =>
            labels.slice(index + 1).every((other) => !intersects(label.rect, other.rect, 1)),
          ),
          unrelatedRouteLabelCrossings: unrelatedRouteLabelCrossings.length,
          routeCrossings,
          customPathsPolished: customPaths.every((path) => {
            const data = path.getAttribute('d') ?? '';
            return data.includes(' Q ') || isStraightLinePath(data);
          }),
          hasLeaders: customRoot.querySelectorAll('.edge-label-leader').length > 0,
          footerClearance: footer.top - content.bottom,
        };
      });
      expect(geometry.surfaceFailures, `${colorTheme}/${width} surfaces`).toEqual([]);
      expect(geometry.longOutlines.length, `${colorTheme}/${width} long boxes`).toBeGreaterThan(0);
      expect(
        geometry.longOutlines.every(
          ({ inset, radius, strokeWidth }) =>
            inset >= strokeWidth - 0.25 && radius >= 14 && radius <= 18 && strokeWidth === 1,
        ),
        `${colorTheme}/${width} long box containment`,
      ).toBe(true);
      expect(
        new Set(geometry.longOutlines.map(({ radius }) => radius)).size,
        `${colorTheme}/${width} long box radii`,
      ).toBe(1);
      expect(geometry.cyclePaths.some(({ data }) => data.includes(' Q '))).toBe(true);
      expect(
        geometry.cyclePaths.every(
          ({ data, radius, straight }) => (data.includes(' Q ') && radius === 6) || straight,
        ),
      ).toBe(true);
      expect(geometry.labelDistances.every((distance) => distance <= 1)).toBe(true);
      expect(geometry.labelsUnbordered).toBe(true);
      expect(geometry.labelsClearNodes).toBe(true);
      expect(geometry.labelsClearLabels).toBe(true);
      expect(geometry.unrelatedRouteLabelCrossings).toBe(0);
      expect(geometry.routeCrossings).toBe(0);
      expect(geometry.customPathsPolished).toBe(true);
      expect(geometry.hasLeaders).toBe(false);
      expect(geometry.footerClearance).toBeGreaterThanOrEqual(-1);
    }
  }
});

test('uses the editorial architecture style contract', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await openSandbox(page, `state=mermaid-flow&theme=${theme}&width=960&motion=reduced`);
    const styles = await page.locator('[data-diagram-workbench-ready="true"]').evaluate((root) => {
      const customNodes = Array.from(root.querySelectorAll<HTMLElement>('.diagram-node-html'));
      const customGroups = Array.from(root.querySelectorAll<SVGRectElement>('.group-bg'));
      const mermaidNodes = Array.from(
        root.querySelectorAll<SVGRectElement>('.mermaid-svg svg .node rect'),
      ).filter((node) => !node.classList.contains('flowchart-node-outline'));
      const mermaidGroups = Array.from(
        root.querySelectorAll<SVGRectElement>('.mermaid-svg svg .cluster rect'),
      );
      const connectors = Array.from(
        root.querySelectorAll<SVGPathElement>('.edge-path, .mermaid-svg .edgePaths path'),
      );
      const nodeStyles = [...customNodes, ...mermaidNodes].map((node) => getComputedStyle(node));
      const groupStyles = [...customGroups, ...mermaidGroups].map((group) =>
        getComputedStyle(group),
      );
      const customTitleFamilies = customNodes.map(
        (node) => getComputedStyle(node.querySelector<HTMLElement>('.node-label')!).fontFamily,
      );
      const mermaidTitleFamilies = Array.from(
        root.querySelectorAll<HTMLElement>('.mermaid-svg .node .nodeLabel'),
      ).map((label) => getComputedStyle(label).fontFamily);
      const metadataFamilies = Array.from(
        root.querySelectorAll<HTMLElement>('.node-kind-label, .edge-label-html, .edgeLabel'),
      ).map((label) => getComputedStyle(label).fontFamily);
      const numeric = (...values: string[]) =>
        values.map(Number.parseFloat).find((value) => Number.isFinite(value) && value > 0) ?? 0;
      return {
        nodeRadii: nodeStyles.map((style) =>
          numeric(style.getPropertyValue('rx'), style.borderRadius),
        ),
        groupRadii: groupStyles.map((style) => Number.parseFloat(style.getPropertyValue('rx'))),
        shadows: nodeStyles.map((style) => style.boxShadow),
        nodeBorders: nodeStyles.map((style) => numeric(style.strokeWidth, style.borderWidth)),
        filledNodeBorders: customNodes
          .filter((node) => node.dataset.semanticStyle !== 'default')
          .map((node) => Number.parseFloat(getComputedStyle(node).borderWidth)),
        connectorWidths: connectors.map((edge) =>
          Number.parseFloat(getComputedStyle(edge).strokeWidth),
        ),
        customTitleFamilies,
        mermaidTitleFamilies,
        metadataFamilies,
        activeCount: Math.max(
          ...Array.from(root.querySelectorAll<HTMLElement>('[data-diagram-case]')).map(
            (diagram) =>
              diagram.querySelectorAll(
                '.node-active, .node-highlighted, .mermaid-svg .node.active, .mermaid-svg .node.current, .mermaid-svg .node.selected',
              ).length,
          ),
        ),
      };
    });

    expect(styles.nodeRadii.length).toBeGreaterThan(0);
    expect(styles.nodeRadii.every((radius) => radius >= 14 && radius <= 18)).toBe(true);
    expect(styles.groupRadii.every((radius) => radius >= 28 && radius <= 36)).toBe(true);
    expect(styles.shadows.every((shadow) => shadow === 'none')).toBe(true);
    expect(styles.nodeBorders.every((width) => width <= 1)).toBe(true);
    expect(styles.filledNodeBorders.length).toBeGreaterThan(0);
    expect(styles.filledNodeBorders.every((width) => width === 0)).toBe(true);
    expect(styles.connectorWidths.every((width) => width >= 1 && width <= 1.25)).toBe(true);
    expect(
      styles.customTitleFamilies.every((family) =>
        /Source Serif|Iowan|Palatino|Georgia/.test(family),
      ),
    ).toBe(true);
    expect(styles.mermaidTitleFamilies.every((family) => /Inter|system-ui/.test(family))).toBe(
      true,
    );
    expect(
      styles.metadataFamilies.every(
        (family) => !/Source Serif|Iowan|Palatino|Georgia/.test(family),
      ),
    ).toBe(true);
    expect(styles.activeCount).toBeLessThanOrEqual(1);
  }
});
