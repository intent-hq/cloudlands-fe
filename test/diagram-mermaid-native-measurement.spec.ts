import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

type Size = { width: number; height: number };
type NativeMeasurement = {
  svgId: string;
  label: string;
  node: Size;
  shape: Size;
  foreignObject: Size;
  html: Size;
  geometryTransitions: string[];
};

declare global {
  interface Window {
    __mermaidNativeMeasurements: NativeMeasurement[];
    __mermaidNativeLayouts: (Size & { svgId: string })[];
  }
}

for (const preference of ['catalog-reduced', 'system-reduced', 'full'] as const) {
  test(`measures native Mermaid labels synchronously with ${preference} motion`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({
      reducedMotion: preference === 'system-reduced' ? 'reduce' : 'no-preference',
    });
    await page.addInitScript(() => {
      window.__mermaidNativeMeasurements = [];
      window.__mermaidNativeLayouts = [];
      const original = SVGGraphicsElement.prototype.getBBox;
      const size = ({ width, height }: DOMRect) => ({ width, height });
      SVGGraphicsElement.prototype.getBBox = function (...args) {
        const box = original.apply(this, args);
        // Observe the real library sizing pass, before application fit/reflow.
        // Never replace a measurement or modify the rendering styles.
        if (!this.closest('.mermaid-renderer')) {
          if (this.classList.contains('node')) {
            const foreignObject = this.querySelector('foreignObject');
            const html = foreignObject?.firstElementChild;
            const shape = this.querySelector<SVGGraphicsElement>(':scope > .label-container');
            if (foreignObject && html && shape) {
              window.__mermaidNativeMeasurements.push({
                svgId: this.ownerSVGElement?.id ?? '',
                label: this.textContent?.trim() ?? '',
                node: size(box),
                shape: size(original.call(shape)),
                foreignObject: size(original.call(foreignObject)),
                html: size(html.getBoundingClientRect()),
                geometryTransitions: foreignObject
                  .getAnimations()
                  .flatMap((animation) =>
                    (animation.effect as KeyframeEffect)
                      .getKeyframes()
                      .flatMap((frame) =>
                        ['width', 'height', 'x', 'y', 'transform'].filter((key) => key in frame),
                      ),
                  ),
              });
            }
          } else if (this instanceof SVGSVGElement && this.querySelector('g.node')) {
            window.__mermaidNativeLayouts.push({ ...size(box), svgId: this.id });
          }
        }
        return box;
      };
    });
    const motion =
      preference === 'system-reduced'
        ? ''
        : `&motion=${preference === 'full' ? 'full' : 'reduced'}`;
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=mermaid-dense-graph&theme=light&width=960${motion}`,
      { waitUntil: 'domcontentloaded' },
    );
    const scene = page.getByTestId('catalog-scene');
    await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 90_000 });
    await expect(scene).toHaveAttribute('data-preview-stable', 'true');
    await expect(scene).toHaveAttribute(
      'data-preview-capture-motion',
      preference === 'full' ? 'full' : 'reduced',
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('#mermaid-dense-graph .mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    const svg = page.locator('#mermaid-dense-graph svg.flowchart[data-layout-settled="true"]');
    await expect(svg).toBeVisible();
    const evidence = await page.evaluate(() => {
      // The gallery also mounts hidden fixtures. Retain every native pass of
      // this graph, including the initial pass before a compact re-render.
      const ids = new Set(
        window.__mermaidNativeMeasurements
          .filter(({ label }) => label === 'Task note')
          .map(({ svgId }) => svgId),
      );
      return {
        current: window.__INTENT_PREVIEW__?.current(),
        measurements: window.__mermaidNativeMeasurements.filter(({ svgId }) => ids.has(svgId)),
        layouts: window.__mermaidNativeLayouts.filter(({ svgId }) => ids.has(svgId)),
        finalSvgId: document.querySelector('#mermaid-dense-graph svg.flowchart')?.id,
        fonts: document.fonts.status,
        rootClasses: document.documentElement.className,
      };
    });
    await writeFile(
      testInfo.outputPath('native-measurements.json'),
      JSON.stringify(evidence, null, 2),
    );
    await svg.screenshot({ path: testInfo.outputPath('dense-graph.png') });
    expect(evidence.current).toEqual({
      slug: 'diagram-workbench',
      state: 'mermaid-dense-graph',
      width: 960,
      status: 'ready',
    });
    expect(evidence.fonts).toBe('loaded');
    expect(evidence.measurements.some(({ svgId }) => svgId === evidence.finalSvgId)).toBe(true);
    const expectedLabels = [
      'Source',
      'Model',
      'Diagnostics',
      'Catalog',
      'Frame',
      'Evidence',
      'Browser',
      'Task note',
    ];
    expect([...new Set(evidence.measurements.map(({ label }) => label))].sort()).toEqual(
      expectedLabels.sort(),
    );
    for (const measurement of evidence.measurements) {
      expect(measurement.geometryTransitions, measurement.label).toEqual([]);
      for (const axis of ['width', 'height'] as const) {
        expect(measurement.html[axis]).toBeGreaterThan(0);
        expect(
          Math.abs(measurement.foreignObject[axis] - measurement.html[axis]),
          `${measurement.label} label ${axis}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(measurement.node[axis] - measurement.shape[axis]),
          `${measurement.label} node ${axis}`,
        ).toBeLessThanOrEqual(1);
      }
    }
    expect(evidence.layouts.length).toBeGreaterThan(0);
    const firstPass = evidence.measurements.slice(0, expectedLabels.length);
    for (const layout of evidence.layouts) {
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      expect(layout.width).toBeLessThan(
        firstPass.reduce((sum, { shape }) => sum + shape.width, 0) * 2,
      );
      expect(layout.height).toBeLessThan(
        firstPass.reduce((sum, { shape }) => sum + shape.height, 0) * 4,
      );
    }
  });
}
