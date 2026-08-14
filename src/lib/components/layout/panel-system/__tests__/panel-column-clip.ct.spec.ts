import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';

function measureGeometry(component: Locator) {
  return component.evaluate(() => {
    const column = document.querySelector('[data-testid="workspace-column"]') as HTMLElement;
    const inset = document.querySelector('[data-testid="panel-workspace-inset"]') as HTMLElement;
    const canvas = inset?.querySelector('.panel-canvas-resize-handle')
      ?.parentElement as HTMLElement | null;
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>('.panel-split-container > .panel-split-child'),
    );
    const columnRect = column.getBoundingClientRect();
    const insetRect = inset?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const lastPanelRect = panels.at(-1)?.getBoundingClientRect();
    return {
      columnRight: columnRect.right,
      insetLeft: insetRect?.left ?? null,
      insetRight: insetRect?.right ?? null,
      insetPaddingLeft: inset ? getComputedStyle(inset).paddingLeft : null,
      insetPaddingRight: inset ? getComputedStyle(inset).paddingRight : null,
      insetScrollWidth: inset?.scrollWidth ?? null,
      insetClientWidth: inset?.clientWidth ?? null,
      canvasWidth: canvasRect?.width ?? null,
      canvasRight: canvasRect?.right ?? null,
      lastPanelRight: lastPanelRect?.right ?? null,
      panelWidths: panels.map((p) => p.getBoundingClientRect().width),
    };
  });
}

/**
 * Regression (clipped jump-to-end button): the rightmost panel's right edge
 * must stay inside the visible workspace column. WorkspaceColumnsView sizes
 * each column as sidebar + canvasWidth + CONTAINED_PANEL_INLINE_CHROME (16px),
 * matching the contained PanelLayout inset's symmetric `px-2` padding. Before
 * the fix the column omitted the chrome while the inset applied `pl-2`, so the
 * canvas's last 8px were clipped behind the column's overflow-hidden.
 */
test('keeps the rightmost panel edge inside the visible column (deck mode)', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: { sidebarWidth: 360, canvasWidth: 800, insetChrome: 16 },
  });

  const measurements = await measureGeometry(component);

  expect(measurements.canvasRight).not.toBeNull();
  // The contained inset must reserve symmetric horizontal padding so the
  // canvas is inset from both visible edges.
  expect(measurements.insetPaddingLeft).toBe('8px');
  expect(measurements.insetPaddingRight).toBe('8px');
  // The regression assertion: the canvas (and thus the rightmost panel) must
  // not extend past the visible column edge.
  expect(measurements.canvasRight!).toBeLessThanOrEqual(measurements.columnRight);
  expect(measurements.lastPanelRight!).toBeLessThanOrEqual(measurements.columnRight);
});

/**
 * Tab view (uncontained, viewport sizing): with an automatic canvas the panels
 * must resolve against the measured inset content width (clientWidth minus
 * padding), so the last panel's right edge lands inside the visible frame with
 * no horizontal overflow.
 */
test('fits an automatic canvas inside the visible frame (tab view)', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      sidebarWidth: 360,
      canvasWidth: 1100,
      persistedCanvasWidth: null,
      insetChrome: 0,
    },
  });

  await expect.poll(async () => (await measureGeometry(component)).canvasWidth).toBeGreaterThan(0);
  const measurements = await measureGeometry(component);

  // No horizontal overflow: the automatic canvas fills exactly the inset's
  // usable content width.
  expect(measurements.insetScrollWidth!).toBeLessThanOrEqual(measurements.insetClientWidth!);
  expect(measurements.canvasRight!).toBeLessThanOrEqual(measurements.columnRight);
  expect(measurements.lastPanelRight!).toBeLessThanOrEqual(measurements.columnRight);
});
