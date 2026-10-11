import { readFile } from 'node:fs/promises';
import { test, expect, outputJson } from '../lib/functional.mjs';
import {
  openDiagramExample,
  mermaidGeneration,
  settledMermaid,
  settledCustom,
  visibleNodeIds,
  recordExpectedParseError,
  inspectExportedSvg,
} from '../lib/diagrams.mjs';

test('diagram Mermaid: invalid source discloses the parser error and recovers to a real SVG', async ({
  page,
  browserErrors,
}, testInfo) => {
  const example = await openDiagramExample(page, 'mermaid-engine');
  const host = example.locator('[data-diagram-exercise-renderer="mermaid-primary"]');
  const source = example.getByRole('textbox', { name: 'Mermaid source', exact: true });
  const original = await source.inputValue();
  await settledMermaid(host);
  const invalid = 'flowchart LR\n  A[Missing close --> B[Invalid';
  await source.fill(invalid);
  await expect(example.getByLabel('Mermaid render state', { exact: true })).toHaveText('error');
  await expect(host.getByRole('alert')).toBeVisible();
  await expect(host.locator('svg[data-layout-generation]')).toHaveCount(0);
  await host.locator('summary').click();
  await expect(host.locator('details')).toContainText('Parse error');
  await expect(host.locator('details pre').last()).toHaveText(invalid);
  await recordExpectedParseError(browserErrors, testInfo);

  const failedGeneration = await mermaidGeneration(host);
  await example.getByRole('button', { name: 'Restore Mermaid flow', exact: true }).click();
  await expect(source).toHaveValue(original);
  const svg = await settledMermaid(host, failedGeneration);
  await expect(host.getByRole('alert')).toHaveCount(0);
  await expect(svg).toContainText('Process request');
  await host.locator('.mermaid-svg-container').hover();
  await host.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(host.getByRole('region', { name: 'View source', exact: true })).toHaveText(original);
  await expect(example.getByLabel('Mermaid source visibility', { exact: true })).toHaveText('true');

  await example.getByRole('button', { name: 'Clear Mermaid source', exact: true }).click();
  await expect(example.getByLabel('Mermaid render state', { exact: true })).toHaveText('empty');
  await expect(host.locator('svg[data-layout-generation]')).toHaveCount(0);
  await expect(host.getByRole('alert')).toHaveCount(0);
});

test('diagram Mermaid: partial streaming preserves the last SVG and the latest generation wins', async ({
  page,
}) => {
  const example = await openDiagramExample(page, 'mermaid-engine');
  const host = example.locator('[data-diagram-exercise-renderer="mermaid-primary"]');
  const source = example.getByRole('textbox', { name: 'Mermaid source', exact: true });
  const svg = await settledMermaid(host);
  const renderer = host.locator('[data-render-generation]');
  const generation = Number(await renderer.getAttribute('data-render-generation'));
  await example.getByRole('switch', { name: 'Mermaid streaming', exact: true }).click();
  await settledMermaid(host, generation);
  const streamingGeneration = await mermaidGeneration(host);
  await source.fill('flowchart LR\n  A[Unfinished');
  await expect
    .poll(async () => Number(await renderer.getAttribute('data-render-settled-generation')))
    .toBeGreaterThan(streamingGeneration);
  await expect(svg).toContainText('Process request');
  await expect(host.getByRole('alert')).toHaveCount(0);
  expect(Number(await svg.getAttribute('data-layout-generation'))).toBeLessThan(
    await mermaidGeneration(host),
  );

  // These are source inputs, not an SVG oracle; the real queue/engine decides
  // which work is superseded and computes every rendered node and edge.
  const partialGeneration = await mermaidGeneration(host);
  await source.fill('flowchart LR\n  A[Superseded draft] --> B[Obsolete result]');
  await source.fill('flowchart LR\n  A[Latest request] --> B[Final streamed result]');
  await example.getByRole('switch', { name: 'Mermaid streaming', exact: true }).click();
  const latest = await settledMermaid(host, partialGeneration);
  await expect(latest).toContainText('Latest request');
  await expect(latest).toContainText('Final streamed result');
  await expect(latest).not.toContainText('Superseded draft');
  await expect(latest).not.toContainText('Process request');
});

test('diagram custom: keyboard steps change visible nodes and publish one state update per move', async ({
  page,
}) => {
  const example = await openDiagramExample(page, 'custom-diagram-engine');
  await example.getByRole('combobox', { name: 'Custom diagram fixture', exact: true }).click();
  await page.getByRole('option', { name: 'State ownership walkthrough', exact: true }).click();
  const renderer = await settledCustom(example, 'request');
  await expect.poll(() => visibleNodeIds(renderer)).toEqual(['chat', 'redux', 'user']);
  const steps = renderer.locator('[data-diagram-step-index]');
  await expect(renderer.getByRole('button', { name: 'Previous step', exact: true })).toBeDisabled();
  await steps.nth(0).focus();
  await steps.nth(0).press('ArrowRight');
  await settledCustom(example, 'execute');
  await expect(steps.nth(1)).toBeFocused();
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect.poll(() => visibleNodeIds(renderer)).toEqual(['chat', 'daemon', 'redux']);
  await expect
    .poll(() => outputJson(example.getByLabel('Custom last update', { exact: true })))
    .toEqual({ currentStateId: 'execute' });
  await expect(example.getByLabel('Custom update count', { exact: true })).toHaveText('1');

  await steps.nth(1).press('End');
  await settledCustom(example, 'render');
  await expect(steps.nth(2)).toBeFocused();
  await expect(renderer.getByRole('button', { name: 'Next step', exact: true })).toBeDisabled();
  await expect(example.getByLabel('Custom current state', { exact: true })).toHaveText('render');
  await steps.nth(2).press('Home');
  await settledCustom(example, 'request');
  await expect(steps.nth(0)).toBeFocused();
  await expect.poll(() => visibleNodeIds(renderer)).toEqual(['chat', 'redux', 'user']);
  await expect(example.getByLabel('Custom update count', { exact: true })).toHaveText('3');
});

test('diagram custom: keyboard activation delivers the source fixture node binding', async ({
  page,
}) => {
  const example = await openDiagramExample(page, 'custom-diagram-engine');
  await example.getByRole('combobox', { name: 'Custom diagram fixture', exact: true }).click();
  await page.getByRole('option', { name: 'Bound recovery action', exact: true }).click();
  const renderer = await settledCustom(example);
  const action = renderer.getByRole('button', { name: /Review retry criteria/ });
  await action.focus();
  await action.press('Enter');
  await expect(example.getByLabel('Custom binding target', { exact: true })).toHaveText(
    'note: bf4d5bc8-15d8-4fbb-bb82-b6fea9f2d4b2',
  );
  await expect(action).toBeFocused();
});

test('diagram custom stream: real JSON prefixes render complete nodes and final errors recover', async ({
  page,
}) => {
  const example = await openDiagramExample(page, 'streaming-diagram-engine');
  const host = example.locator('[data-diagram-exercise-renderer="streaming-custom"]');
  const input = example.getByRole('textbox', { name: 'Custom diagram JSON', exact: true });
  await settledCustom(host);
  await example.getByRole('button', { name: 'Start custom JSON stream', exact: true }).click();
  await expect(example.getByLabel('Custom JSON parse status', { exact: true })).toHaveText(
    'partial',
  );
  const partial = await settledCustom(host);
  await expect.poll(() => visibleNodeIds(partial)).toEqual(['failure']);
  await expect(host.locator('[data-diagram-streaming]')).toHaveAttribute('aria-busy', 'true');
  await example.getByRole('button', { name: 'Complete custom JSON stream', exact: true }).click();
  const complete = await settledCustom(host);
  await expect
    .poll(() => visibleNodeIds(complete))
    .toEqual(['daemon', 'failure', 'review', 'stream']);
  await expect(host.locator('[data-diagram-streaming]')).toHaveAttribute('aria-busy', 'false');
  await input.fill('{invalid final JSON');
  await expect(example.getByLabel('Custom JSON parse status', { exact: true })).toHaveText(
    'invalid',
  );
  await expect(host.getByRole('alert')).toBeVisible();
  await expect(host.locator('[data-node-id]')).toHaveCount(0);
  await expect(host.getByLabel('View source', { exact: true })).toHaveText('{invalid final JSON');
  await example.getByRole('button', { name: 'Complete custom JSON stream', exact: true }).click();
  await settledCustom(host);
  await expect(host.getByRole('alert')).toHaveCount(0);
  await host.getByRole('button', { name: /Review retry criteria/ }).press('Space');
  await expect(example.getByLabel('Streaming custom binding target', { exact: true })).toHaveText(
    'note: bf4d5bc8-15d8-4fbb-bb82-b6fea9f2d4b2',
  );
});

test('diagram fullscreen: keyboard zoom and Escape preserve the diagram and restore opener focus', async ({
  page,
}) => {
  const example = await openDiagramExample(page, 'mermaid-engine');
  const host = example.locator('[data-diagram-exercise-renderer="mermaid-primary"]');
  await settledMermaid(host);
  const opener = host.getByRole('button', { name: 'Expand diagram to fullscreen', exact: true });
  await opener.focus();
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Fullscreen diagram view', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('svg[data-layout-generation]')).toContainText('Process request');
  const graph = dialog.locator('svg[data-layout-generation]');
  const original = await graph.boundingBox();
  expect(original).not.toBeNull();
  expect(original.width).toBeGreaterThan(0);
  await page.keyboard.press('+');
  await expect
    .poll(async () => (await graph.boundingBox())?.width ?? 0)
    .toBeGreaterThan(original.width);
  await page.keyboard.press('0');
  await expect
    .poll(
      async () => {
        const restored = await graph.boundingBox();
        return restored
          ? Math.max(
              ...['x', 'y', 'width', 'height'].map((key) =>
                Math.abs(restored[key] - original[key]),
              ),
            )
          : Infinity;
      },
      { message: 'Reset must restore the real graph bounds' },
    )
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await settledMermaid(host);
});

for (const kind of ['mermaid', 'custom']) {
  test(`diagram ${kind}: native SVG download contains the rendered source and decodes in Chromium`, async ({
    page,
  }, testInfo) => {
    const example = await openDiagramExample(
      page,
      `${kind === 'custom' ? 'custom-diagram' : 'mermaid'}-engine`,
    );
    const host = example.locator(
      `[data-diagram-exercise-renderer="${kind === 'mermaid' ? 'mermaid-primary' : 'custom'}"]`,
    );
    if (kind === 'mermaid') await settledMermaid(host);
    else await settledCustom(host, 'orient');
    await host
      .locator(kind === 'mermaid' ? '.mermaid-svg-container' : '[data-diagram-presentation]')
      .hover();
    await host.getByRole('button', { name: 'Diagram actions', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download SVG', exact: true }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    const destination = testInfo.outputPath(`${kind}-download.svg`);
    await download.saveAs(destination);
    await testInfo.attach(`${kind}-download.svg`, {
      path: destination,
      contentType: 'image/svg+xml',
    });
    await inspectExportedSvg(
      page,
      await readFile(destination, 'utf8'),
      kind === 'mermaid'
        ? ['Process request', 'Repair input']
        : ['Workspace user', 'Diagram workbench'],
    );
  });
}

test('diagram clipboard: Copy SVG writes the actual diagram to the native clipboard', async ({
  page,
  context,
}) => {
  const example = await openDiagramExample(page, 'mermaid-engine');
  const host = example.locator('[data-diagram-exercise-renderer="mermaid-primary"]');
  await settledMermaid(host);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  await page.evaluate(() => navigator.clipboard.writeText('Waiting for the real diagram export'));
  await host.locator('.mermaid-svg-container').hover();
  await host.getByRole('button', { name: 'Diagram actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy SVG', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('<svg');
  await inspectExportedSvg(page, await page.evaluate(() => navigator.clipboard.readText()), [
    'Process request',
    'Repair input',
  ]);
});
