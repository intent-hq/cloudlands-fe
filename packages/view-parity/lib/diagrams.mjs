import { expect } from './functional.mjs';
import { endpoint } from './manifest.mjs';

// The workbench intentionally uses its own functional route; the generic
// openExample helper opens ?example=interactive. Provenance/errors still come
// from the unchanged functional.mjs test fixture in both spec files.
export async function openDiagramExample(page, exampleId) {
  const baseUrl = endpoint(process.env.PARITY_CANDIDATE_URL, 'PARITY_CANDIDATE_URL');
  const url = new URL(`${baseUrl}/sandbox/diagram-workbench`);
  url.searchParams.set('example', 'functional');
  url.searchParams.set('theme', 'light');
  url.searchParams.set('motion', 'reduced');
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `Cannot load real diagram exercises ${url}`).toBe(true);
  const example = page.locator(`[data-functional-example="${exampleId}"]`);
  await expect(example, 'Missing production diagram caller is not coverage').toBeVisible({
    timeout: 15_000,
  });
  await expect(example.locator('[data-catalog-unimplemented]')).toHaveCount(0);
  return example;
}

export async function mermaidGeneration(host) {
  return Number(
    await host.locator('[data-render-generation]').getAttribute('data-render-generation'),
  );
}

export async function settledMermaid(host, afterGeneration = 0) {
  const renderer = host.locator('[data-render-generation]');
  await expect
    .poll(
      () =>
        renderer.evaluate((node, afterGeneration) => {
          const svg = node.querySelector('svg[data-layout-generation]');
          const generation = node.getAttribute('data-render-generation');
          return (
            Number(generation) > afterGeneration &&
            node.getAttribute('data-render-settled') === 'true' &&
            node.getAttribute('data-render-settled-generation') === generation &&
            svg?.getAttribute('data-layout-generation') === generation &&
            svg?.getAttribute('data-layout-settled') === 'true'
          );
        }, afterGeneration),
      {
        message: 'The latest real Mermaid render and measured SVG must settle together',
        timeout: 45_000,
      },
    )
    .toBe(true);
  const svg = renderer.locator('svg[data-layout-generation]');
  await expect(svg).toBeVisible();
  return svg;
}

export async function settledCustom(host, state) {
  const renderer = host.locator('[data-diagram-settled]');
  if (state) await expect(renderer).toHaveAttribute('data-diagram-state', state);
  await expect(renderer).toHaveAttribute('data-diagram-settled', 'true');
  await expect(renderer.locator('svg').first()).toBeVisible();
  return renderer;
}

export async function visibleNodeIds(renderer) {
  return renderer.locator('[data-node-id]').evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      })
      .map((node) => node.getAttribute('data-node-id'))
      .sort(),
  );
}

// Only the deliberately submitted invalid-source journey consumes this log.
// Keep the original diagnostic as an attachment; all other errors stay in the
// functional fixture's array and still fail its ordinary teardown assertion.
export async function recordExpectedParseError(browserErrors, testInfo) {
  const expected = browserErrors.filter(
    (message) =>
      message.startsWith('console:') &&
      message.includes('[ERROR] [MermaidRenderer] Failed to render mermaid diagram:') &&
      message.includes('Parse error'),
  );
  await testInfo.attach('expected-mermaid-parse-error.json', {
    body: JSON.stringify(expected, null, 2),
    contentType: 'application/json',
  });
  expect(
    expected,
    'One final invalid source should produce one diagnosed parse error',
  ).toHaveLength(1);
  browserErrors.splice(browserErrors.indexOf(expected[0]), 1);
}

export async function inspectExportedSvg(page, source, labels) {
  const result = await page.evaluate(async (source) => {
    const document = new window.DOMParser().parseFromString(source, 'image/svg+xml');
    const svg = document.documentElement;
    const errors = [...document.querySelectorAll('parsererror')].map((node) => node.textContent);
    const text = [...svg.querySelectorAll('text, foreignObject')]
      .map((node) => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ');
    const viewBox = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const url = URL.createObjectURL(new window.Blob([source], { type: 'image/svg+xml' }));
    const image = new window.Image();
    try {
      image.src = url;
      await image.decode();
      return {
        errors,
        root: svg.localName,
        namespace: svg.namespaceURI,
        viewBox,
        text,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, source);
  expect(result.errors, 'Downloaded content must be valid SVG XML').toEqual([]);
  expect(result.root).toBe('svg');
  expect(result.namespace).toBe('http://www.w3.org/2000/svg');
  expect(result.viewBox).toHaveLength(4);
  expect(result.viewBox.every(Number.isFinite)).toBe(true);
  expect(result.viewBox[2]).toBeGreaterThan(0);
  expect(result.viewBox[3]).toBeGreaterThan(0);
  expect(result.width, 'Chromium must decode the actual export').toBeGreaterThan(0);
  expect(result.height).toBeGreaterThan(0);
  for (const label of labels) expect(result.text).toContain(label);
  return result;
}
