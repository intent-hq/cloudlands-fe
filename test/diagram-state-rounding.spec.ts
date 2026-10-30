import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openScene(page: Page, state: string, width: number) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 30_000,
  });
  await expect(page.locator(`#${state} .mermaid-renderer`)).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  expect(await page.evaluate(() => window.__INTENT_PREVIEW__?.current())).toEqual({
    slug: 'diagram-workbench',
    state,
    width,
    status: 'ready',
  });
  return page.locator(`#${state} .mermaid-svg > svg`);
}

// Measure the browser's actual centerline, independent of the routing helper,
// path command spelling and diagnostic datasets. A sharp turn has only a single
// diagonal sample; a rounded turn has sustained x/y travel with changing tangents.
function paintedBends(svg: SVGSVGElement) {
  const paths = [
    ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.transition[data-edge="true"]'),
  ];
  return paths.map((path) => {
    const length = path.getTotalLength();
    const count = Math.ceil(length / 0.1);
    const samples = Array.from({ length: count + 1 }, (_, i) =>
      path.getPointAtLength((length * i) / count),
    );
    const spans: { x: number; y: number; samples: number }[] = [];
    let first = -1;
    for (let i = 1; i <= count; i++) {
      const dx = Math.abs(samples[i].x - samples[i - 1].x);
      const dy = Math.abs(samples[i].y - samples[i - 1].y);
      const diagonal = Math.min(dx, dy) > Math.hypot(dx, dy) * 0.025;
      if (diagonal && first === -1) first = i - 1;
      if ((!diagonal || i === count) && first !== -1) {
        const last = diagonal ? i : i - 1;
        spans.push({
          x: Math.abs(samples[last].x - samples[first].x),
          y: Math.abs(samples[last].y - samples[first].y),
          samples: last - first,
        });
        first = -1;
      }
    }
    const matrix = path.getScreenCTM()!;
    const style = getComputedStyle(path);
    return {
      id: path.id.replace(/^.*-(edge\d+|L_)/, '$1'),
      length,
      start: { x: samples[0].x, y: samples[0].y },
      end: { x: samples[count].x, y: samples[count].y },
      bounds: { width: path.getBBox().width, height: path.getBBox().height },
      bends: spans.filter((span) => span.samples >= 4),
      scale: Math.hypot(matrix.a, matrix.b),
      visible:
        style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0,
      animations: path.getAnimations().length,
    };
  });
}

for (const width of [960, 320]) {
  test(`keeps state connectors visible through resize at ${width}px`, async ({ page }) => {
    const svg = await openScene(page, 'mermaid-state', width);
    const state = await svg.evaluate(paintedBends);
    await test.info().attach('painted-bends', {
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    });
    await svg.screenshot({ path: test.info().outputPath(`state-${width}.png`) });
    expect(state).toHaveLength(11);
    for (const path of state) {
      expect(path.visible).toBe(true);
      expect(path.animations, 'rounding is static').toBe(0);
    }
    for (const id of width === 960 ? ['edge0', 'edge1'] : ['edge0', 'edge1', 'edge3', 'edge4']) {
      const straight = state.find((path) => path.id === id)!;
      expect(straight.bends).toHaveLength(0);
      expect(
        Math.abs(
          straight.length -
            Math.hypot(straight.end.x - straight.start.x, straight.end.y - straight.start.y),
        ),
      ).toBeLessThan(0.01);
    }
    // Readiness covers the full fit pipeline. A same-layout host resize also
    // re-runs arrow gaps, which must not restore a cached sharp path.
    for (const nextWidth of [width + 8, width]) {
      await page.getByTestId('catalog-scene-focus').evaluate(
        (host, value) =>
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              observer.disconnect();
              reject(new Error('Resize did not update arrow gaps'));
            }, 5000);
            const observer = new MutationObserver(() => {
              clearTimeout(timeout);
              observer.disconnect();
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            });
            observer.observe(host.querySelector('#mermaid-state .mermaid-svg > svg')!, {
              attributes: true,
              subtree: true,
              attributeFilter: ['d'],
            });
            host.style.width = `${value}px`;
          }),
        nextWidth,
      );
    }
    const final = await svg.evaluate(paintedBends);
    expect(final).toHaveLength(11);
    expect(final.every((path) => path.visible && path.animations === 0)).toBe(true);
  });
}
