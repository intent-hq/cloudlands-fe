import { expect, test } from '../../../../test/ct-test';
import MermaidRenderer from '../MermaidRenderer.svelte';

// Real Mermaid in a real browser: guards the render path (initialize → render →
// our post-processing and error UI) against Mermaid API or default changes.

test('renders a flowchart with the classic look and dagre layout', async ({ mount }) => {
  const component = await mount(MermaidRenderer, {
    props: { code: 'flowchart TD\n  A["Start"] --> B{"Decision"}\n  B -->|yes| C["Done"]' },
  });
  await expect(component).toHaveAttribute('data-render-settled', 'true', { timeout: 60_000 });
  const svg = component.locator('.mermaid-svg > svg');
  await expect(svg).toContainText('Decision');
  await expect(svg).toHaveAttribute('aria-roledescription', 'flowchart-v2');
  // Mermaid 12 always emits its look defs, but only its default `neo` look applies the
  // drop-shadow filter to node shapes; the pinned classic look must leave them flat.
  const nodeFilters = await svg
    .locator('g.node > rect, g.node > polygon, g.node > path')
    .evaluateAll((shapes) => shapes.map((shape) => getComputedStyle(shape).filter));
  expect(nodeFilters.length).toBeGreaterThan(0);
  expect(nodeFilters.filter((filter) => filter !== 'none')).toEqual([]);
  await expect(component.getByRole('alert')).toHaveCount(0);
});

test('renders a sequence diagram', async ({ mount }) => {
  const component = await mount(MermaidRenderer, {
    props: { code: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi' },
  });
  await expect(component).toHaveAttribute('data-render-settled', 'true', { timeout: 60_000 });
  const svg = component.locator('.mermaid-svg > svg');
  await expect(svg).toHaveAttribute('aria-roledescription', 'sequence');
  await expect(svg).toContainText('Alice');
  await expect(svg).toContainText('Hello');
  await expect(component.getByRole('alert')).toHaveCount(0);
});

test('shows our own error UI, not a Mermaid error diagram, for invalid source', async ({
  mount,
  page,
}) => {
  const component = await mount(MermaidRenderer, {
    props: { code: 'flowchart TD\n  A[Missing close --> B' },
  });
  await expect(component).toHaveAttribute('data-render-settled', 'true', { timeout: 60_000 });
  await expect(component.getByRole('alert')).toBeVisible();
  await expect(component.locator('.mermaid-error .error-message')).toContainText(/parse error/i);
  await expect(component.locator('.mermaid-svg > svg')).toHaveCount(0);
  // suppressErrorRendering keeps Mermaid from painting its "Syntax error" SVG anywhere.
  await expect(page.locator('svg[aria-roledescription="error"]')).toHaveCount(0);
});
