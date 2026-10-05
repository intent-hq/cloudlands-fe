import { expect, type Locator } from '@playwright/test';

/** Exercise native drawing scrolling; check actual paint, not assigned SVG dimensions. */
export async function expectDrawingReachable(root: Locator) {
  const result = await root.evaluate(async (element) => {
    const viewport = element.querySelector<HTMLElement>('.diagram-scroll-container')!;
    const original = { left: viewport.scrollLeft, top: viewport.scrollTop };
    const rect = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    const read = () => {
      const svg = viewport.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
      const scale = Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b);
      const paint = [
        ...viewport.querySelectorAll<SVGGraphicsElement>(
          '[data-node-id], .group-bg, .group-label, .edge-path, .edge-label-container',
        ),
      ].map((e) => {
        const r = e.getBoundingClientRect();
        const margin = e.matches('.edge-path') ? 3.5 * scale + 0.5 : 0;
        return {
          id: e.getAttribute('data-node-id') ?? e.getAttribute('class'),
          left: r.left - margin,
          right: r.right + margin,
          top: r.top - margin,
          bottom: r.bottom + margin,
        };
      });
      for (const e of viewport.querySelectorAll('.node-label, .edge-label-text')) {
        const range = document.createRange();
        range.selectNodeContents(e);
        for (const r of range.getClientRects())
          paint.push({ id: `text:${e.textContent}`, ...rect(r) });
      }
      return {
        viewport: rect(viewport.getBoundingClientRect()),
        svg: rect(svg.getBoundingClientRect()),
        paint,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
    };
    const axis = (max: number, size: number) => {
      const values = [0];
      for (let p = size * 0.8; p < max; p += size * 0.8) values.push(p);
      if (max > 0) values.push(max);
      return values;
    };
    const xs = axis(viewport.scrollWidth - viewport.clientWidth, viewport.clientWidth);
    const ys = axis(viewport.scrollHeight - viewport.clientHeight, viewport.clientHeight);
    const samples = [];
    for (const top of ys)
      for (const left of xs) {
        viewport.scrollTo({ left, top, behavior: 'instant' });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push(read());
      }
    viewport.scrollTo({ ...original, behavior: 'instant' });
    return {
      samples,
      overflow: [getComputedStyle(viewport).overflowX, getComputedStyle(viewport).overflowY],
    };
  });
  expect(result.samples[0].paint.length).toBeGreaterThan(0);
  if (result.samples.length > 1)
    expect(result.overflow.every((v) => ['auto', 'scroll'].includes(v))).toBe(true);
  for (let i = 0; i < result.samples[0].paint.length; i++) {
    const first = result.samples[0].paint[i];
    for (const x of ['left', 'right'] as const)
      for (const y of ['top', 'bottom'] as const) {
        expect(
          result.samples.some((s) => {
            const p = s.paint[i];
            return (
              p[x] >= s.viewport.left - 1 &&
              p[x] <= s.viewport.right + 1 &&
              p[y] >= s.viewport.top - 1 &&
              p[y] <= s.viewport.bottom + 1
            );
          }),
          `${first.id} ${x}/${y} must be exposed by native scroll`,
        ).toBe(true);
      }
    for (const s of result.samples) {
      const p = s.paint[i];
      expect(
        Object.values(p)
          .filter((v) => typeof v === 'number')
          .every(Number.isFinite),
      ).toBe(true);
      expect(p.left, `${p.id} outside SVG`).toBeGreaterThanOrEqual(s.svg.left - 1);
      expect(p.right, `${p.id} outside SVG`).toBeLessThanOrEqual(s.svg.right + 1);
      expect(p.top, `${p.id} outside SVG`).toBeGreaterThanOrEqual(s.svg.top - 1);
      expect(p.bottom, `${p.id} outside SVG`).toBeLessThanOrEqual(s.svg.bottom + 1);
    }
  }
  return result;
}
