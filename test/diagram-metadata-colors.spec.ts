import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

function paintProbe(root: Element) {
  const origin = root.getBoundingClientRect();
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const bounds = (element: Element) => {
    const b = element.getBoundingClientRect();
    return [b.x - origin.x, b.y - origin.y, b.width, b.height].map(round);
  };
  const resolve = (value: string) => {
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;color:${value}`;
    root.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
  const muted = resolve('hsl(var(--muted-foreground))');
  const metadata = resolve('var(--diagram-metadata)');
  const canvas = resolve('var(--diagram-canvas)');
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        const c = n / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const leafText = [...root.querySelectorAll('svg *')].filter(
    (element) =>
      !element.closest('style, defs') &&
      [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      ),
  );
  const text = leafText
    .map((element) => {
      const style = getComputedStyle(element);
      const group = element.closest('.cluster-label, .group-label');
      const edge = element.closest('.edgeLabel, .edge-label-text');
      const category = group ? 'group' : edge ? 'edge' : 'primary';
      const svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
      return {
        category,
        text: [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim())
          .join(' '),
        tag: element.tagName,
        bounds: bounds(element),
        paint: svg ? style.fill : style.color,
        color: style.color,
        fill: style.fill,
        opacity: style.opacity,
        typography: [
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.lineHeight,
          style.letterSpacing,
        ],
      };
    })
    .filter((element) => element.bounds[2] > 0 && element.bounds[3] > 0);
  const shapes = [
    ...root.querySelectorAll('svg rect, svg path, svg circle, svg polygon, svg line, svg polyline'),
  ].map((element) => {
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      bounds: bounds(element),
      geometry: ['d', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'transform'].map(
        (attribute) => element.getAttribute(attribute),
      ),
      style: [style.fill, style.stroke, style.strokeWidth, style.strokeDasharray, style.opacity],
    };
  });
  const viewports = [...root.querySelectorAll('svg, foreignObject, .diagram-scroll-area')].map(
    (element) => ({
      tag: element.tagName,
      bounds: bounds(element),
      viewBox: element.getAttribute('viewBox'),
      transform: getComputedStyle(element).transform,
      overflow: element.scrollWidth - element.clientWidth,
    }),
  );
  const [light, dark] = [luminance(muted), luminance(canvas)].sort((a, b) => b - a);
  return {
    muted,
    metadata,
    canvas,
    contrast: (light + 0.05) / (dark + 0.05),
    text,
    shapes,
    viewports,
  };
}

async function settle(page: Page, root: Locator, custom: boolean) {
  await page.evaluate(() => document.fonts.ready);
  if (custom) {
    await expect(root.locator('.diagram-renderer')).toHaveAttribute(
      'data-diagram-settled',
      'true',
      {
        timeout: 30_000,
      },
    );
  } else {
    await expect(root.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
      timeout: 30_000,
    });
    await expect(root.locator('.mermaid-svg > svg')).toHaveAttribute('data-layout-settled', 'true');
  }
}

function expectSameEvidence(actual: unknown, expected: unknown, context: string) {
  const differences: string[] = [];
  const compare = (a: unknown, b: unknown, path: string) => {
    if (a === b) return;
    if (typeof a === 'number' && typeof b === 'number') {
      // Only absorb the probe's three-decimal serialization precision.
      if (Math.abs(a - b) > 0.001) differences.push(`${path}: ${b} → ${a}`);
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) differences.push(`${path}: array length changed`);
      a.forEach((value, index) => compare(value, b[index], `${path}/${index}`));
    } else if (a && b && typeof a === 'object' && typeof b === 'object') {
      const left = a as Record<string, unknown>;
      const right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        compare(left[key], right[key], `${path}/${key}`);
      }
    } else if (
      typeof a === 'string' &&
      typeof b === 'string' &&
      /\/(geometry\/\d+|viewBox|transform)$/.test(path)
    ) {
      const number = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
      if (a.replace(number, '#') !== b.replace(number, '#'))
        differences.push(`${path}: route commands changed`);
      compare(a.match(number)?.map(Number), b.match(number)?.map(Number), `${path}/coordinates`);
    } else {
      differences.push(`${path}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
    }
  };
  compare(actual, expected, context);
  expect.soft(differences, context).toEqual([]);
}

for (const { state, width } of [
  { state: 'mermaid-nested-routing', width: 960 },
  { state: 'mermaid-nested-routing', width: 420 },
  { state: 'mermaid-flow', width: 960 },
  { state: 'mermaid-state', width: 420 },
  { state: 'custom-architecture', width: 960 },
  { state: 'custom-state-machine', width: 420 },
]) {
  test(`${state} metadata leaf paint at ${width}px survives live theme redraw`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const custom = state.startsWith('custom-');
    await page.goto(
      `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=${width}&motion=reduced`,
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 30_000,
    });
    const root = page.locator(`#${state}`);
    await settle(page, root, custom);
    const frames: ReturnType<typeof paintProbe>[] = [];
    for (const [index, theme] of ['light', 'dark', 'light'].entries()) {
      if (index) {
        const renderer = root.locator('.mermaid-renderer');
        const generation = custom ? null : await renderer.getAttribute('data-render-generation');
        await page
          .getByTestId('catalog-theme-control')
          .getByRole('radio', {
            name: theme === 'dark' ? 'Dark' : 'Light',
            exact: true,
          })
          .click();
        if (!custom)
          await expect(renderer).not.toHaveAttribute('data-render-generation', generation!);
        await settle(page, root, custom);
      }
      const frame = await root.evaluate(paintProbe);
      frames.push(frame);
      const key = `${state}-${width}-${index}-${theme}`;
      const dir = process.env.DIAGRAM_COLOR_EVIDENCE_DIR ?? info.outputDir;
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${key}.json`), JSON.stringify(frame, null, 2));
      if (index < 2) {
        await root.locator(custom ? '.diagram-renderer' : '.mermaid-renderer').screenshot({
          path: join(dir, `${key}.png`),
        });
      }
      expect.soft(frame.metadata, key).toBe(frame.muted);
      const labels = frame.text.filter((leaf) => leaf.category !== 'primary');
      expect.soft(labels.length, `${key} observed text leaves`).toBeGreaterThan(0);
      for (const label of labels) {
        expect.soft(label.paint, `${key} ${label.category} ${label.text}`).toBe(frame.muted);
      }
      if (state.includes('nested') || state === 'custom-architecture') {
        expect
          .soft(
            labels.some((leaf) => leaf.category === 'group'),
            `${key} group coverage`,
          )
          .toBe(true);
      }
      if (process.env.DIAGRAM_COLOR_BASELINE_DIR) {
        const before: ReturnType<typeof paintProbe> = JSON.parse(
          await readFile(join(process.env.DIAGRAM_COLOR_BASELINE_DIR, `${key}.json`), 'utf8'),
        );
        expectSameEvidence(frame.shapes, before.shapes, `${key} protected shape geometry/paint`);
        expectSameEvidence(frame.viewports, before.viewports, `${key} protected viewports/scale`);
        const geometry = (data: typeof frame) =>
          data.text.map(({ paint: _p, color: _c, fill: _f, ...rest }) => rest);
        expectSameEvidence(
          geometry(frame),
          geometry(before),
          `${key} protected text geometry/typography`,
        );
        expectSameEvidence(
          frame.text.filter((leaf) => leaf.category === 'primary'),
          before.text.filter((leaf) => leaf.category === 'primary'),
          `${key} primary paint`,
        );
      }
    }
    const leafPaint = (frame: ReturnType<typeof paintProbe>) =>
      frame.text.map(({ bounds: _bounds, ...leaf }) => leaf);
    expect
      .soft(leafPaint(frames[2]), 'returning to light restores leaf paint and typography')
      .toEqual(leafPaint(frames[0]));
    expect.soft(frames[1].muted, 'live theme actually changed').not.toBe(frames[0].muted);
    expect(errors).toEqual([]);
  });
}
