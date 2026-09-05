import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ mode: 'serial' });

async function gotoPreview(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const ready = page.locator('[data-preview-ready=true]');
  if (!(await ready.isVisible({ timeout: 30_000 }).catch(() => false))) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  }
  await expect(ready).toBeVisible({ timeout: 90_000 });
  await page
    .locator('[data-diagram-workbench-ready="true"]')
    .waitFor({ state: 'attached', timeout: 90_000 });
}

test('supports keyboard diagram actions, walkthroughs, bindings, and fullscreen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await gotoPreview(
    page,
    `${baseUrl}/sandbox/diagram-workbench?state=custom-bindings&theme=dark&width=320&motion=reduced`,
  );
  const bindingsCase = page.locator('[data-diagram-case="custom-bindings"]');
  const binding = bindingsCase.getByRole('button', {
    name: /open review retry criteria note binding/i,
  });
  await expect(bindingsCase.locator('.diagram-actions')).toHaveCSS('opacity', '0');
  await binding.focus();
  await expect(binding).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bindingsCase.locator('[data-binding-target]')).toContainText('note: bf4d5bc8');
  for (const text of ['inspect', 'retry', 'resume']) {
    const label = bindingsCase.locator('.edge-label-html', { hasText: text });
    await expect(label).toBeVisible();
    expect(
      await label.evaluate(
        (element) =>
          element.scrollHeight <= element.clientHeight + 1 &&
          element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
  expect(await binding.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    'none',
  );

  const fit = bindingsCase.locator('button.diagram-fit-button');
  const initiallyFit = (await fit.getAttribute('aria-pressed')) === 'true';
  await expect(fit).toHaveAccessibleName(
    initiallyFit ? 'Show diagram at actual size' : 'Fit diagram to width',
  );
  await fit.focus();
  await expect(fit).toBeFocused();
  await expect(bindingsCase.locator('.diagram-actions')).toHaveCSS('opacity', '1');
  await fit.press('Enter');
  if (initiallyFit) await fit.press('Enter');
  await expect(fit).toHaveAttribute('aria-pressed', 'true');
  const fitZoom = Number(
    await bindingsCase.locator('.diagram-content').evaluate((el) => getComputedStyle(el).zoom),
  );
  expect(fitZoom).toBeGreaterThan(0);
  expect(fitZoom).toBeLessThanOrEqual(1.7);

  await gotoPreview(
    page,
    `${baseUrl}/sandbox/diagram-workbench?state=custom-data-flow&theme=light&width=960&motion=reduced`,
  );
  const dataFlowCase = page.locator('[data-diagram-case="custom-data-flow"]');
  const labelConnections = await dataFlowCase.evaluate((root) => {
    const distanceToPath = (path: SVGPathElement, x: number, y: number) => {
      const length = path.getTotalLength();
      const matrix = path.getScreenCTM();
      if (!matrix) return Number.POSITIVE_INFINITY;
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index <= 2000; index += 1) {
        const point = path.getPointAtLength((length * index) / 2000).matrixTransform(matrix);
        distance = Math.min(distance, Math.hypot(x - point.x, y - point.y));
      }
      return distance;
    };

    return [...root.querySelectorAll<SVGForeignObjectElement>('.edge-label-container')].map(
      (label) => {
        const edgeId = label.dataset.edgeId!;
        const path = root.querySelector<SVGPathElement>(
          `.diagram-edge[data-edge-id="${CSS.escape(edgeId)}"] .edge-path`,
        )!;
        const labelRect = label.getBoundingClientRect();
        return {
          pathDistance: distanceToPath(
            path,
            labelRect.left + labelRect.width / 2,
            labelRect.top + labelRect.height / 2,
          ),
          borderWidth: getComputedStyle(label.querySelector('.edge-label-html')!).borderWidth,
        };
      },
    );
  });
  expect(labelConnections.length).toBeGreaterThan(0);
  expect(labelConnections.every(({ pathDistance }) => pathDistance <= 1)).toBe(true);
  expect(labelConnections.every(({ borderWidth }) => borderWidth === '0px')).toBe(true);

  await gotoPreview(
    page,
    `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=dark&width=960&motion=reduced`,
  );
  const walkthroughCase = page.locator('[data-diagram-case="custom-walkthrough"]');
  const firstStep = walkthroughCase.locator('[data-diagram-step-index="0"]');
  const secondStep = walkthroughCase.locator('[data-diagram-step-index="1"]');
  await firstStep.focus();
  await page.keyboard.press('ArrowRight');
  await expect(secondStep).toBeFocused();
  await expect(secondStep).toHaveAttribute('aria-current', 'step');
  await expect(walkthroughCase.getByLabel('Step 2 of 3')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(walkthroughCase.locator('[data-diagram-step-index="2"]')).toBeFocused();
  const contextOpacity = await walkthroughCase.evaluate((root) => ({
    nodes: [...root.querySelectorAll('.node-dimmed')].map((node) =>
      Number(getComputedStyle(node).opacity),
    ),
    edges: [...root.querySelectorAll('.edge-dimmed .edge-path')].map((edge) =>
      Number(getComputedStyle(edge).opacity),
    ),
    labels: [...root.querySelectorAll('.edge-label-dimmed')].map((label) =>
      Number(getComputedStyle(label).opacity),
    ),
  }));
  expect(contextOpacity.nodes.every((opacity) => opacity >= 0.7)).toBe(true);
  expect(contextOpacity.edges.every((opacity) => opacity >= 0.5)).toBe(true);
  expect(contextOpacity.labels.every((opacity) => opacity >= 0.6)).toBe(true);

  await gotoPreview(
    page,
    `${baseUrl}/sandbox/diagram-workbench?state=mermaid-flow&theme=dark&width=320&motion=reduced`,
  );
  const mermaidFlowCase = page.locator('[data-diagram-case="mermaid-flow"]');
  const source = mermaidFlowCase.getByRole('button', { name: 'View source' });
  await expect(mermaidFlowCase.locator('.mermaid-actions')).toHaveCSS('opacity', '0');
  await source.focus();
  await expect(source).toBeFocused();
  await expect(mermaidFlowCase.locator('.mermaid-actions')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(mermaidFlowCase.getByRole('region', { name: 'View source' })).toContainText(
    'flowchart LR',
  );
  await mermaidFlowCase.getByRole('button', { name: 'Expand diagram to fullscreen' }).click();
  await expect(page.getByRole('dialog', { name: 'Fullscreen diagram view' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Fullscreen diagram view' })).toHaveCount(0);

  expect(
    consoleErrors.filter(
      (message) =>
        !message.includes('[MermaidRenderer] Failed to render mermaid diagram:') ||
        !message.includes('Missing close'),
    ),
  ).toEqual([]);
});

test('keeps measured walkthrough content compact and collision free', async ({ page }) => {
  test.setTimeout(120_000);

  for (const width of [960, 640]) {
    await gotoPreview(
      page,
      `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&theme=light&width=${width}&motion=reduced`,
    );
    await page.evaluate(() => document.fonts.ready);

    const walkthrough = page.locator('[data-diagram-case="custom-walkthrough"]');
    const geometry = await walkthrough.evaluate((root) => {
      const rect = (element: Element) => element.getBoundingClientRect();
      const contains = (outer: DOMRect, inner: DOMRect, tolerance = 1) =>
        inner.left >= outer.left - tolerance &&
        inner.top >= outer.top - tolerance &&
        inner.right <= outer.right + tolerance &&
        inner.bottom <= outer.bottom + tolerance;
      const intersects = (a: DOMRect, b: DOMRect, padding = 0) =>
        a.left < b.right + padding &&
        a.right > b.left - padding &&
        a.top < b.bottom + padding &&
        a.bottom > b.top - padding;
      const textRect = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
      };
      const labelElements = [...root.querySelectorAll<HTMLElement>('.edge-label-html')];
      const labels = labelElements.map((element) => ({
        edgeId: element.closest('.edge-label-container')?.getAttribute('data-edge-id'),
        text: element.innerText.trim(),
        rect: rect(element),
        fits:
          element.scrollHeight <= element.clientHeight + 1 &&
          element.scrollWidth <= element.clientWidth + 1 &&
          contains(rect(element), textRect(element)),
      }));
      const nodeElements = [...root.querySelectorAll<HTMLElement>('.diagram-node-html')];
      const nodes = nodeElements.map((element) => ({
        text: element.querySelector<HTMLElement>('.node-label')!.innerText.trim(),
        rect: rect(element),
      }));
      const pathCrosses = (path: SVGPathElement, target: DOMRect) => {
        const matrix = path.getScreenCTM();
        if (!matrix) return false;
        const length = path.getTotalLength();
        for (let index = 1; index < 100; index += 1) {
          const point = path.getPointAtLength((length * index) / 100).matrixTransform(matrix);
          if (
            point.x > target.left + 1 &&
            point.x < target.right - 1 &&
            point.y > target.top + 1 &&
            point.y < target.bottom - 1
          ) {
            return true;
          }
        }
        return false;
      };
      const edgePaths = [...root.querySelectorAll<SVGPathElement>('.edge-path')];
      const loopPath = root.querySelector<SVGPathElement>(
        '.diagram-edge[data-edge-id="w3"] .edge-path',
      )!;
      const user = nodes.find((node) => node.text === 'User')!;
      const redux = nodes.find((node) => node.text === 'Redux')!;
      const send = labels.find((label) => label.text === 'send message')!;
      const content = rect(root.querySelector('.diagram-content')!);
      const footer = rect(root.querySelector('.diagram-footer')!);

      return {
        labelsFit: labels.every((label) => label.fits),
        labelsClearNodes: labels.every((label) =>
          nodes.every((node) => !intersects(label.rect, node.rect, 2)),
        ),
        pathLabelCrossings: edgePaths.flatMap((path) =>
          labels.flatMap((label) => {
            const edgeId = path.closest('.diagram-edge')?.getAttribute('data-edge-id');
            return edgeId !== label.edgeId && pathCrosses(path, label.rect)
              ? [`${edgeId}->${label.edgeId}:${label.text}`]
              : [];
          }),
        ),
        forwardGap: redux.rect.top - user.rect.bottom,
        forwardGapLimit: send.rect.height + 32,
        loopClearsNodes: nodes
          .filter((node) => node.text !== 'Chat UI' && node.text !== 'Redux')
          .every((node) => !pathCrosses(loopPath, node.rect)),
        loopClearsLabels: labels.every(
          (label) => label.edgeId === 'w3' || !pathCrosses(loopPath, label.rect),
        ),
        hasLeaders: root.querySelectorAll('.edge-label-leader').length > 0,
        stageClearsFooter: content.bottom <= footer.top + 1,
      };
    });

    expect(geometry.labelsFit).toBe(true);
    expect(geometry.labelsClearNodes).toBe(true);
    expect(geometry.pathLabelCrossings).toEqual([]);
    expect(geometry.forwardGap).toBeLessThanOrEqual(geometry.forwardGapLimit);
    expect(geometry.loopClearsNodes).toBe(true);
    expect(geometry.loopClearsLabels).toBe(true);
    expect(geometry.hasLeaders).toBe(false);
    expect(geometry.stageClearsFooter).toBe(true);

    const fit = walkthrough.locator('button.diagram-fit-button');
    if ((await fit.getAttribute('aria-pressed')) !== 'true') {
      await fit.focus();
      await fit.press('Enter');
    }
    const occupancy = await walkthrough.evaluate((root) => {
      const stage = root.querySelector<HTMLElement>('.diagram-scroll-container')!;
      const content = root.querySelector<HTMLElement>('.diagram-content')!;
      return content.getBoundingClientRect().width / stage.clientWidth;
    });
    expect(occupancy).toBeGreaterThan(0.55);
    expect(occupancy).toBeLessThanOrEqual(1.01);

    const steps = walkthrough.locator('[data-diagram-step-index]');
    await steps.nth(1).click();
    await expect(walkthrough.locator('.node-label', { hasText: 'Daemon' })).toBeVisible();
    for (const text of ['dispatch request', 'start turn', 'stream state events']) {
      const label = walkthrough.locator('.edge-label-html', { hasText: text });
      await expect(label).toBeVisible();
      expect(
        await label.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
      ).toBe(true);
    }
    await steps.nth(2).click();
    await expect(
      walkthrough.locator('.edge-label-html', { hasText: 'render current state' }),
    ).toBeVisible();
  }

  await gotoPreview(
    page,
    `${baseUrl}/sandbox/diagram-workbench?state=custom-long-multiline-labels&theme=light&width=640&motion=reduced`,
  );
  await page.evaluate(() => document.fonts.ready);
  const multiline = page.locator('[data-diagram-case="custom-long-multiline-labels"]');
  const measured = await multiline.evaluate((root) => {
    const nodeMetrics = [...root.querySelectorAll<HTMLElement>('.diagram-node-html')].map(
      (node) => ({
        text: node.querySelector<HTMLElement>('.node-label')!.innerText.trim(),
        height: node.getBoundingClientRect().height,
        fits: node.scrollHeight <= node.clientHeight + 1,
      }),
    );
    const labels = [...root.querySelectorAll<HTMLElement>('.edge-label-html')].map((label) => ({
      text: label.innerText.trim(),
      fits:
        label.scrollHeight <= label.clientHeight + 1 && label.scrollWidth <= label.clientWidth + 1,
    }));
    return { nodeMetrics, labels };
  });
  const oneLineHeight = measured.nodeMetrics.find((node) => node.text === 'Live response')!.height;
  const threeLineHeight = measured.nodeMetrics.find((node) =>
    node.text.includes('stays inside'),
  )!.height;
  expect(threeLineHeight).toBeGreaterThan(oneLineHeight);
  expect(measured.nodeMetrics.every((node) => node.fits)).toBe(true);
  expect(measured.labels.find((label) => label.text === 'asks for\ninput')?.fits).toBe(true);
});

test('keeps the complex state machine compact with clear routes and idle actions', async ({
  page,
}) => {
  test.setTimeout(120_000);

  for (const { width, theme } of [
    { width: 960, theme: 'light' },
    { width: 640, theme: 'light' },
    { width: 420, theme: 'light' },
    { width: 420, theme: 'dark' },
    { width: 420, theme: 'nord' },
  ] as const) {
    const context = `${theme} ${width}px`;
    await gotoPreview(
      page,
      `${baseUrl}/sandbox/diagram-workbench?state=mermaid-state&theme=${theme}&width=${width}&motion=reduced`,
    );
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page
      .locator('[data-diagram-case="mermaid-state"] svg.statediagram')
      .evaluate((svg) => {
        const rect = (element: Element) => element.getBoundingClientRect();
        const intersects = (a: DOMRect, b: DOMRect, padding = 0) =>
          a.left < b.right + padding &&
          a.right > b.left - padding &&
          a.top < b.bottom + padding &&
          a.bottom > b.top - padding;
        const stateGroups = [...svg.querySelectorAll<SVGGElement>('g.node.statediagram-state')];
        const states = stateGroups.map((element) => ({
          text: element.textContent?.trim() ?? '',
          rect: rect(element),
        }));
        const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabel')]
          .filter((element) => element.textContent?.trim())
          .map((element) => ({
            text: element.textContent?.trim() ?? '',
            rect: rect(element),
            routePathId: element.dataset.routePathId,
          }));
        const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
        const pathPoints = paths.map((path) => {
          const length = path.getTotalLength();
          const matrix = path.getScreenCTM()!;
          return {
            id: path.id,
            points: Array.from({ length: 81 }, (_, index) =>
              path.getPointAtLength((length * index) / 80).matrixTransform(matrix),
            ),
          };
        });
        const pathVertices = paths.map((path) => {
          const numbers = (path.getAttribute('d')?.match(/-?[0-9.]+/g) ?? []).map(Number);
          return Array.from({ length: numbers.length / 2 }, (_, index) => ({
            x: numbers[index * 2],
            y: numbers[index * 2 + 1],
          }));
        });
        const segments = (points: { x: number; y: number }[]) =>
          points.slice(1).map((end, index) => ({ start: points[index], end }));
        const segmentsCross = (
          left: { start: { x: number; y: number }; end: { x: number; y: number } },
          right: { start: { x: number; y: number }; end: { x: number; y: number } },
        ) => {
          const epsilon = 0.1;
          const sharedEndpoint = [left.start, left.end].some((point) =>
            [right.start, right.end].some(
              (other) => Math.hypot(point.x - other.x, point.y - other.y) < epsilon,
            ),
          );
          if (sharedEndpoint) return false;
          const leftHorizontal = Math.abs(left.start.y - left.end.y) < epsilon;
          const rightHorizontal = Math.abs(right.start.y - right.end.y) < epsilon;
          if (leftHorizontal === rightHorizontal) return false;
          const horizontal = leftHorizontal ? left : right;
          const vertical = leftHorizontal ? right : left;
          return (
            vertical.start.x > Math.min(horizontal.start.x, horizontal.end.x) + epsilon &&
            vertical.start.x < Math.max(horizontal.start.x, horizontal.end.x) - epsilon &&
            horizontal.start.y > Math.min(vertical.start.y, vertical.end.y) + epsilon &&
            horizontal.start.y < Math.max(vertical.start.y, vertical.end.y) - epsilon
          );
        };
        const bounds = [...states, ...labels].map((item) => item.rect);
        const svgRect = rect(svg);
        const occupied = {
          left: Math.min(...bounds.map((box) => box.left)),
          top: Math.min(...bounds.map((box) => box.top)),
          right: Math.max(...bounds.map((box) => box.right)),
          bottom: Math.max(...bounds.map((box) => box.bottom)),
        };
        const idle = states.find((state) => state.text === 'Idle')!.rect;
        const starting = states.find((state) => state.text === 'Starting')!.rect;
        const streaming = states.find((state) => state.text === 'Streaming')!.rect;
        const pathLengths = paths.map((path) => path.getTotalLength());
        const pointInside = (box: DOMRect, point: DOMPoint) =>
          point.x > box.left + 1 &&
          point.x < box.right - 1 &&
          point.y > box.top + 1 &&
          point.y < box.bottom - 1;
        let unrelatedPathCrossings = 0;
        pathVertices.forEach((vertices, index) => {
          pathVertices.slice(index + 1).forEach((other) => {
            if (
              segments(vertices).some((segment) =>
                segments(other).some((otherSegment) => segmentsCross(segment, otherSegment)),
              )
            ) {
              unrelatedPathCrossings += 1;
            }
          });
        });

        return {
          contained: bounds.every(
            (box) =>
              box.left >= svgRect.left - 2 &&
              box.top >= svgRect.top - 2 &&
              box.right <= svgRect.right + 2 &&
              box.bottom <= svgRect.bottom + 2,
          ),
          labelsSeparated: labels.every((label, index) =>
            labels.slice(index + 1).every((other) => !intersects(label.rect, other.rect, 1)),
          ),
          labelsClearNodes: labels.every((label) =>
            states.every((state) => !intersects(label.rect, state.rect, 2)),
          ),
          nodesSeparated: states.every((state, index) =>
            states.slice(index + 1).every((other) => !intersects(state.rect, other.rect, 2)),
          ),
          orthogonal: [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].every((path) => {
            const d = path.getAttribute('d') ?? '';
            return d.includes('L') && !/[CSA]/.test(d);
          }),
          pathLabelIntersections: labels.flatMap((label) =>
            pathPoints.filter(
              (path) =>
                path.id !== label.routePathId &&
                path.points.some((point) => pointInside(label.rect, point)),
            ),
          ).length,
          unrelatedPathCrossings,
          longestRoute: Math.max(...pathLengths),
          totalRouteLength: pathLengths.reduce((total, length) => total + length, 0),
          widthOccupancy: (occupied.right - occupied.left) / svgRect.width,
          heightOccupancy: (occupied.bottom - occupied.top) / svgRect.height,
          chainConnected:
            idle.bottom < starting.top &&
            starting.bottom < streaming.top &&
            Math.abs(idle.left + idle.width / 2 - (starting.left + starting.width / 2)) < 80 &&
            Math.abs(starting.left + starting.width / 2 - (streaming.left + streaming.width / 2)) <
              260,
        };
      });

    expect(geometry.contained).toBe(true);
    expect(geometry.labelsSeparated).toBe(true);
    expect(geometry.labelsClearNodes).toBe(true);
    expect(geometry.nodesSeparated).toBe(true);
    expect(geometry.orthogonal).toBe(true);
    expect(geometry.pathLabelIntersections, `${context} path-label intersections`).toBe(0);
    expect(
      geometry.unrelatedPathCrossings,
      `${context} unavoidable path junctions`,
    ).toBeLessThanOrEqual(2);
    expect(geometry.longestRoute).toBeLessThan(1_500);
    expect(geometry.totalRouteLength).toBeLessThan(8_000);
    expect(geometry.widthOccupancy).toBeGreaterThan(0.6);
    expect(geometry.heightOccupancy).toBeGreaterThan(0.65);
    expect(geometry.chainConnected).toBe(true);

    const caseRoot = page.locator('[data-diagram-case="mermaid-state"]');
    const actions = caseRoot.locator('.mermaid-actions');
    const actionButton = actions.getByRole('button').first();
    await page.mouse.move(0, 0);
    await expect(actions).toHaveCSS('opacity', '0');
    await expect(actions).toHaveCSS('pointer-events', 'none');
    await caseRoot.locator('.mermaid-svg-container').hover();
    await expect(actions).toHaveCSS('opacity', '1');
    await expect(actions).toHaveCSS('pointer-events', 'auto');
    await actionButton.focus();
    await expect(actions).toHaveCSS('opacity', '1');
    await actionButton.blur();
  }
});
