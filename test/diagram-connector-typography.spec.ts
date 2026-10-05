import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CUSTOM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

async function open(page: Page, state: string) {
  const paths = ['DiagramRenderer.svelte', 'layout-engine.ts'];
  const responses = paths.map((name) =>
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith(`/diagrams/${name}`) && !url.searchParams.has('type');
    }),
  );
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960&motion=reduced`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  const hashes: Record<string, string> = {};
  for (const [index, response] of responses.entries()) {
    const body = await (await response).text();
    const encoded = body.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
    expect(encoded).toBeTruthy();
    const map = JSON.parse(Buffer.from(encoded!, 'base64').toString());
    const source =
      map.sourcesContent[map.sources.findIndex((s: string) => s.endsWith(paths[index]))];
    expect(source).toBe(await readFile(`src/lib/components/diagrams/${paths[index]}`, 'utf8'));
    hashes[paths[index]] = createHash('sha256').update(source).digest('hex');
  }
  await page.evaluate(() => document.fonts.ready);
  return hashes;
}

async function geometry(root: Locator) {
  return root.evaluate(async (element) => {
    const { measureEdgeLabel } = await import('/src/lib/components/diagrams/layout-engine.ts');
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const typography = (e: Element) => {
      const s = getComputedStyle(e);
      return {
        fontSize: Number.parseFloat(s.fontSize),
        lineHeight: Number.parseFloat(s.lineHeight),
        fontFamily: s.fontFamily,
        weight: s.fontWeight,
        tracking: s.letterSpacing,
        color: s.color,
      };
    };
    const svg = element.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
    const matrix = svg.getScreenCTM()!;
    const scale = Math.hypot(matrix.a, matrix.b);
    const labels = [
      ...element.querySelectorAll<SVGForeignObjectElement>('.edge-label-container'),
    ].map((fo) => {
      const text = fo.querySelector<HTMLElement>('.edge-label-text')!;
      const container = fo.querySelector<HTMLElement>('.edge-label-html')!;
      const style = getComputedStyle(container);
      const oracle = document.createElement('div');
      Object.assign(oracle.style, {
        position: 'absolute',
        visibility: 'hidden',
        width: `${fo.width.baseVal.value}px`,
        boxSizing: 'border-box',
        padding: style.padding,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        whiteSpace: 'pre-line',
        overflowWrap: 'normal',
        wordBreak: 'normal',
      });
      oracle.textContent = text.textContent;
      document.body.append(oracle);
      const naturalHeight = oracle.getBoundingClientRect().height;
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const lines = Math.round((naturalHeight - padding) / lineHeight);
      oracle.remove();
      const range = document.createRange();
      range.selectNodeContents(text);
      return {
        id: fo.dataset.edgeId,
        text: text.textContent!,
        type: typography(container),
        bounds: box(fo),
        glyphs: [...range.getClientRects()].map((r) => ({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        })),
        width: fo.width.baseVal.value,
        height: fo.height.baseVal.value,
        lines,
        expectedHeight: Math.min(lines, 3) * lineHeight + padding,
        measured: measureEdgeLabel(text.textContent!, fo.width.baseVal.value),
        truncated: fo.dataset.truncated === 'true',
      };
    });
    return {
      scale,
      labels,
      routes: [...element.querySelectorAll<SVGGElement>('.diagram-edge')].map((edge) => {
        const path = edge.querySelector<SVGPathElement>('.edge-path')!;
        const matrix = path.getScreenCTM()!;
        const source = element.querySelector(`[data-node-id="${edge.dataset.edgeFrom}"]`)!;
        const target = element.querySelector(`[data-node-id="${edge.dataset.edgeTo}"]`)!;
        const start = path.getPointAtLength(0).matrixTransform(matrix);
        const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
        const distance = (point: DOMPoint, node: Element) => {
          const r = node.getBoundingClientRect();
          return Math.hypot(
            Math.max(r.left - point.x, point.x - r.right, 0),
            Math.max(r.top - point.y, point.y - r.bottom, 0),
          );
        };
        return {
          id: edge.dataset.edgeId,
          from: edge.dataset.edgeFrom,
          to: edge.dataset.edgeTo,
          sourceGap: distance(start, source),
          tipGap: distance(end, target) - 0.5,
        };
      }),
      viewport: box(element.querySelector('.diagram-scroll-container')!),
      kinds: [...element.querySelectorAll('.node-kind-label')].map(typography),
      titles: [...element.querySelectorAll('.node-label')].map(typography),
      nodes: [...element.querySelectorAll('[data-node-id]')].map((e) => ({
        id: e.getAttribute('data-node-id'),
        ...box(e),
      })),
    };
  });
}

function assertMeasured(result: Awaited<ReturnType<typeof geometry>>) {
  expect(result.labels.length).toBeGreaterThan(0);
  for (const label of result.labels) {
    expect(label.type.fontSize, label.text).toBe(result.kinds[0].fontSize);
    expect(label.type.fontFamily).toBe(result.kinds[0].fontFamily);
    expect(label.type.lineHeight / label.type.fontSize).toBeCloseTo(1.26, 2);
    expect(label.measured.lines, label.text).toBe(label.lines);
    expect(label.height, label.text).toBeCloseTo(label.expectedHeight, 1);
    expect(label.measured.height, label.text).toBeCloseTo(label.height, 1);
    expect(label.truncated, label.text).toBe(label.lines > 3);
    if (!label.truncated)
      for (const glyph of label.glyphs) {
        expect(glyph.x, label.text).toBeGreaterThanOrEqual(label.bounds.x - 0.5);
        expect(glyph.x + glyph.width, label.text).toBeLessThanOrEqual(
          label.bounds.x + label.bounds.width + 0.5,
        );
        expect(glyph.y, label.text).toBeGreaterThanOrEqual(label.bounds.y - 0.5);
        expect(glyph.y + glyph.height, label.text).toBeLessThanOrEqual(
          label.bounds.y + label.bounds.height + 0.5,
        );
      }
  }
  for (const route of result.routes) {
    expect(route.sourceGap, route.id).toBeLessThanOrEqual(0.35);
    expect(Math.abs(route.tipGap - 5), route.id).toBeLessThanOrEqual(0.35);
  }
}

for (const state of ['custom-flowchart', 'custom-walkthrough']) {
  test(`measures secondary-size connectors in authored ${state} across narrow-wide resize`, async ({
    page,
  }, info) => {
    const hashes = await open(page, state);
    const root = page.locator(`#${state} .diagram-renderer`);
    if (state === 'custom-walkthrough') {
      await root.locator('[data-diagram-step-index="2"]').click();
      await expect(root).toHaveAttribute('data-diagram-state', 'render');
    }
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    await root.scrollIntoViewIfNeeded();
    const wide = await geometry(root);
    await root.screenshot({ path: info.outputPath(`${state}.png`) });
    await writeFile(info.outputPath('wide.json'), JSON.stringify({ hashes, ...wide }, null, 2));
    assertMeasured(wide);
    const fixture = CUSTOM_WORKBENCH_CASES[state as keyof typeof CUSTOM_WORKBENCH_CASES];
    for (const route of wide.routes) {
      const authored = fixture.diagram.model.edges.find(({ id }) => id === route.id)!;
      expect({ from: route.from, to: route.to }).toEqual({ from: authored.from, to: authored.to });
    }
    await root.evaluate((e) => {
      (e as HTMLElement).style.width = '420px';
    });
    await expect.poll(async () => (await geometry(root)).viewport.width).toBeLessThanOrEqual(420);
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const narrow = await geometry(root);
    assertMeasured(narrow);
    await root.evaluate((e) => {
      (e as HTMLElement).style.removeProperty('width');
    });
    await expect
      .poll(async () => (await geometry(root)).viewport.width)
      .toBeCloseTo(wide.viewport.width, 1);
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const restored = await geometry(root);
    assertMeasured(restored);
    expect(restored.labels.map(({ id, width, height }) => ({ id, width, height }))).toEqual(
      wide.labels.map(({ id, width, height }) => ({ id, width, height })),
    );
    await writeFile(info.outputPath('resize.json'), JSON.stringify({ narrow, restored }, null, 2));
  });
}

test('measures multiline, unbroken and Unicode labels against native text layout', async ({
  page,
}, info) => {
  await open(page, 'custom-long-multiline-labels');
  const root = page.locator('#custom-long-multiline-labels .diagram-renderer');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  assertMeasured(await geometry(root));
  const results = await root.evaluate(async (element) => {
    const { measureEdgeLabel } = await import('/src/lib/components/diagrams/layout-engine.ts');
    const style = getComputedStyle(element.querySelector('.edge-label-html')!);
    const labels = [
      'one\ntwo\nthree',
      'one\ntwo\nthree\nfour',
      'first line\n\nthird line',
      'render current state after receiving the daemon response',
      'LongUnbrokenConnectorLabelWithoutSpaces',
      'Übertragung東京👩🏽‍💻éΔοκιμή',
      'مرحبا بالعالم إرسال الحالة',
    ];
    return [60, 112].flatMap((maxWidth) =>
      labels.map((label) => {
        const measured = measureEdgeLabel(label, maxWidth);
        const oracle = document.createElement('div');
        Object.assign(oracle.style, {
          position: 'absolute',
          visibility: 'hidden',
          width: `${measured.width}px`,
          boxSizing: 'border-box',
          padding: style.padding,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          whiteSpace: 'pre-line',
          overflowWrap: 'normal',
          wordBreak: 'normal',
        });
        oracle.textContent = label;
        document.body.append(oracle);
        const bounds = oracle.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(oracle);
        const ink = range.getBoundingClientRect();
        const padding =
          Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
        const lineHeight = Number.parseFloat(style.lineHeight);
        const lines = Math.round((bounds.height - padding) / lineHeight);
        oracle.style.whiteSpace = 'nowrap';
        const nowrapWidth = range.getBoundingClientRect().width;
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const canvasWidth = context.measureText(label).width;
        context.letterSpacing = style.letterSpacing;
        const trackedCanvasWidth = context.measureText(label).width;
        oracle.remove();
        return {
          label,
          maxWidth,
          measured,
          lines,
          height: Math.min(lines, 3) * lineHeight + padding,
          inkWidth: ink.width,
          nowrapWidth,
          canvasWidth,
          trackedCanvasWidth,
        };
      }),
    );
  });
  await writeFile(info.outputPath('native-measurements.json'), JSON.stringify(results, null, 2));
  for (const result of results) {
    expect(result.measured.lines, `${result.label} at ${result.maxWidth}`).toBe(result.lines);
    expect(result.measured.height, result.label).toBeCloseTo(result.height, 1);
    expect(result.inkWidth, result.label).toBeLessThanOrEqual(result.measured.width);
  }
});
