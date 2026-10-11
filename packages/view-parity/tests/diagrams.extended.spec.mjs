import { test, expect } from '../lib/functional.mjs';
import {
  openDiagramExample,
  mermaidGeneration,
  settledMermaid,
  settledCustom,
  visibleNodeIds,
} from '../lib/diagrams.mjs';

test('diagram independence: editing and unmounting one Mermaid host leaves its neighbour intact', async ({
  page,
}) => {
  const example = await openDiagramExample(page, 'mermaid-engine');
  const primary = example.locator('[data-diagram-exercise-renderer="mermaid-primary"]');
  await settledMermaid(primary);
  await example.getByRole('switch', { name: 'Mount second Mermaid renderer', exact: true }).click();
  const secondary = example.locator('[data-diagram-exercise-renderer="mermaid-secondary"]');
  const independent = await settledMermaid(secondary);
  const previousGeneration = await mermaidGeneration(primary);
  await example
    .getByRole('textbox', { name: 'Mermaid source', exact: true })
    .fill('flowchart LR\n  Changed[Changed first host] --> Result[First host result]');
  const changed = await settledMermaid(primary, previousGeneration);
  await expect(changed).toContainText('Changed first host');
  await expect(independent).toContainText('Source');
  await expect(independent).toContainText('Target');
  await expect(independent).not.toContainText('Changed first host');
  await example.getByRole('switch', { name: 'Mount Mermaid renderer', exact: true }).click();
  await expect(primary.locator('[data-render-generation]')).toHaveCount(0);
  await secondary.locator('.mermaid-svg-container').hover();
  await secondary.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(secondary.getByRole('region', { name: 'View source', exact: true })).toContainText(
    'Source[Source]',
  );
  await expect(independent).toContainText('Target');
});

test('diagram lifecycle: a remounted streaming renderer uses current source without stale content', async ({
  page,
}) => {
  const example = await openDiagramExample(page, 'mermaid-engine');
  const host = example.locator('[data-diagram-exercise-renderer="mermaid-primary"]');
  await settledMermaid(host);
  const source = example.getByRole('textbox', { name: 'Mermaid source', exact: true });
  await example.getByRole('switch', { name: 'Mermaid streaming', exact: true }).click();
  await source.fill(
    'flowchart TB\n' +
      Array.from(
        { length: 40 },
        (_, index) => `A${index}[Old node ${index}] --> A${index + 1}`,
      ).join('\n'),
  );
  await example.getByRole('switch', { name: 'Mount Mermaid renderer', exact: true }).click();
  await expect(host.locator('[data-render-generation]')).toHaveCount(0);
  await expect(example.getByLabel('Mermaid render state', { exact: true })).toHaveText('unmounted');
  await source.fill('flowchart LR\n  A[Remounted source] --> B[Current content]');
  await example.getByRole('switch', { name: 'Mermaid streaming', exact: true }).click();
  await example.getByRole('switch', { name: 'Mount Mermaid renderer', exact: true }).click();
  const svg = await settledMermaid(host);
  await expect(svg).toContainText('Remounted source');
  await expect(svg).toContainText('Current content');
  await expect(svg).not.toContainText('Old node');
  await expect(host.locator('[data-render-generation]')).toHaveCount(1);
  await expect(host.getByRole('alert')).toHaveCount(0);
});

test('diagram resize: narrow sequence keeps source and fullscreen controls operable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 900 });
  const example = await openDiagramExample(page, 'mermaid-engine');
  const host = example.locator('[data-diagram-exercise-renderer="mermaid-primary"]');
  await settledMermaid(host);
  const previousGeneration = await mermaidGeneration(host);
  await example.getByRole('button', { name: 'Load Mermaid sequence', exact: true }).click();
  await settledMermaid(host, previousGeneration);
  await page.setViewportSize({ width: 360, height: 900 });
  const svg = await settledMermaid(host);
  await expect(svg.locator('text').filter({ hasText: /Select\s*named\s*state/ })).toHaveCount(1);
  await host.locator('.mermaid-svg-container').hover();
  await host.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(host.getByRole('region', { name: 'View source', exact: true })).toContainText(
    'sequenceDiagram',
  );
  const opener = host.getByRole('button', { name: 'Expand diagram to fullscreen', exact: true });
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Fullscreen diagram view', exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close fullscreen view', exact: true });
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  const bounds = await opener.boundingBox();
  expect(bounds).not.toBeNull();
  expect(
    bounds.x,
    'The restored control must remain inside the narrow viewport',
  ).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
});

test('diagram reduced motion: a keyboard step settles without a running scene animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const example = await openDiagramExample(page, 'custom-diagram-engine');
  await example.getByRole('combobox', { name: 'Custom diagram fixture', exact: true }).click();
  await page.getByRole('option', { name: 'State ownership walkthrough', exact: true }).click();
  const renderer = await settledCustom(example, 'request');
  const first = renderer.locator('[data-diagram-step-index="0"]');
  await first.focus();
  await first.press('ArrowRight');
  await settledCustom(example, 'execute');
  await expect.poll(() => visibleNodeIds(renderer)).toEqual(['chat', 'daemon', 'redux']);
  await expect(renderer.locator('[data-diagram-step-index="1"]')).toBeFocused();
  expect(
    await renderer.evaluate(
      (node) =>
        node
          .getAnimations({ subtree: true })
          .filter(
            (animation) => animation.playState === 'running' || animation.playState === 'pending',
          ).length,
    ),
    'Reduced-motion navigation must not leave animated scene work running',
  ).toBe(0);
});
