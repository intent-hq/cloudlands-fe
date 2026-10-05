import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openState(page: Page, width: number, theme: 'light' | 'dark') {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=mermaid-state&theme=${theme}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 120_000,
  });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('#mermaid-state .mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
}

function stateNodeGeometry(svg: SVGSVGElement) {
  const normalizePath = (path: string | null) =>
    path?.replace(/-?[0-9]+(?:\.[0-9]+)?/g, (value) =>
      String(Math.round(Number(value) * 1000) / 1000),
    );
  const visibleTextBounds = (element: Element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      rects.push(...range.getClientRects());
    }
    const left = Math.min(...rects.map((rect) => rect.left));
    const right = Math.max(...rects.map((rect) => rect.right));
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, right, top, bottom };
  };
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.statediagram-state')].flatMap((node) => {
    const shape = node.querySelector<SVGRectElement>(':scope > rect.basic.label-container');
    const label = node.querySelector<SVGGElement>(':scope > g.label');
    const name = node.textContent?.trim();
    if (!shape || !label || !name) return [];
    const shapeBounds = shape.getBoundingClientRect();
    const textBounds = visibleTextBounds(label);
    return [
      {
        name,
        offsetX: (textBounds.left + textBounds.right - shapeBounds.left - shapeBounds.right) / 2,
        contained:
          textBounds.left >= shapeBounds.left - 1 &&
          textBounds.right <= shapeBounds.right + 1 &&
          textBounds.top >= shapeBounds.top - 1 &&
          textBounds.bottom <= shapeBounds.bottom + 1,
        identity: {
          nodeTransform: normalizePath(node.getAttribute('transform')),
          x: shape.getAttribute('x'),
          y: shape.getAttribute('y'),
          width: shape.getAttribute('width'),
          height: shape.getAttribute('height'),
        },
      },
    ];
  });
  return {
    nodes,
    routes: [...svg.querySelectorAll<SVGPathElement>('path.transition')].map((path) => ({
      key: path.id.match(/edge[0-9]+$/)?.[0],
      d: normalizePath(path.getAttribute('d')),
    })),
  };
}

function expectCentered(geometry: ReturnType<typeof stateNodeGeometry>, context: string) {
  expect(geometry.nodes.map(({ name }) => name)).toEqual(
    expect.arrayContaining(['RunningTool', 'NeedsInput']),
  );
  for (const node of geometry.nodes) {
    expect(Math.abs(node.offsetX), `${context} ${node.name} glyph center`).toBeLessThanOrEqual(1);
    expect(node.contained, `${context} ${node.name} containment`).toBe(true);
  }
}

for (const width of [420, 960] as const) {
  test(`centers simple state-node glyphs at ${width}px`, async ({ page }) => {
    await openState(page, width, width === 960 ? 'dark' : 'light');
    const geometry = await page
      .locator('#mermaid-state svg.statediagram[data-layout-settled=true]')
      .evaluate(stateNodeGeometry);
    await test.info().attach('state-node-centers', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    expectCentered(geometry, `${width}px`);
  });
}

test('keeps state-node centering idempotent through repeat fits and a theme redraw', async ({
  page,
}) => {
  await openState(page, 960, 'dark');
  const renderer = page.locator('#mermaid-state .mermaid-renderer');
  const svg = page.locator('#mermaid-state svg.statediagram[data-layout-settled=true]');
  const resize = async (width: number) => {
    const generation = Number(await renderer.getAttribute('data-render-generation'));
    await page
      .getByTestId('catalog-scene-focus')
      .evaluate((element, value) => (element.style.width = `${value}px`), width);
    await expect
      .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
      .toBeGreaterThan(generation);
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    return svg.evaluate(stateNodeGeometry);
  };

  const narrow = await resize(420);
  const wide = await resize(960);
  const generation = Number(await renderer.getAttribute('data-render-generation'));
  await page.getByTestId('catalog-color-theme-control').click();
  await page.getByRole('option', { name: 'Nord', exact: true }).click();
  await expect
    .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
    .toBeGreaterThan(generation);
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  const themedWide = await svg.evaluate(stateNodeGeometry);
  const repeatedNarrow = await resize(420);

  expectCentered(themedWide, 'themed 960px');
  expectCentered(repeatedNarrow, 'repeated 420px');
  expect(themedWide).toEqual(wide);
  expect(repeatedNarrow).toEqual(narrow);
});
