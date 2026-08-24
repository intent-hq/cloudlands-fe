import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import PanelStructuralColumnFitHarness from './mocks/PanelStructuralColumnFitHarness.svelte';

async function addColumn(component: Locator, count: number) {
  await component.getByTestId('panel-workspace-inset').evaluate((inset) => {
    inset.scrollLeft = inset.scrollWidth;
  });
  await component.locator('[data-add-panel-column]').click();
  await expect(component.locator('[data-panel-id]')).toHaveCount(count);
}

function devicePixelOverflow(
  right: number,
  visibleRight: number,
  edgeAllowance: number,
  devicePixelRatio: number,
) {
  return Math.max(
    0,
    Math.round(right * devicePixelRatio) -
      Math.round((visibleRight + edgeAllowance) * devicePixelRatio),
  );
}

// The measured viewport and panel endpoints can each round by one device pixel.
const MAX_ENDPOINT_ROUNDING_PIXELS = 2;

function measureFit(component: Locator) {
  return component.evaluate(() => {
    const inset = document.querySelector<HTMLElement>('[data-testid="panel-workspace-inset"]')!;
    const canvas = document.querySelector<HTMLElement>(
      '.panel-canvas-resize-handle',
    )!.parentElement!;
    const handle = document.querySelector<HTMLElement>('.panel-canvas-resize-handle')!;
    const renderedCanvas = document.querySelector<HTMLElement>(
      '.panel-split-container.horizontal',
    )!;
    const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-panel-id]'));
    const insetRect = inset.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const renderedCanvasRect = renderedCanvas.getBoundingClientRect();
    const rightmostRect = panels.at(-1)!.getBoundingClientRect();
    const styles = getComputedStyle(inset);
    return {
      canvasWidth: canvas.offsetWidth,
      availableWidth:
        inset.clientWidth -
        (Number.parseFloat(styles.paddingLeft) || 0) -
        (Number.parseFloat(styles.paddingRight) || 0),
      insetScrollWidth: inset.scrollWidth,
      insetClientWidth: inset.clientWidth,
      canvasRight: canvasRect.right,
      handleCenter: handleRect.left + handleRect.width / 2,
      renderedCanvasRight: renderedCanvasRect.right,
      visibleRight: insetRect.right - (Number.parseFloat(styles.paddingRight) || 0),
      rightmostRight: rightmostRect.right,
      devicePixelRatio: window.devicePixelRatio,
      panelWidths: panels.map((panel) => panel.getBoundingClientRect().width),
      focusedPanelId: panels.find((panel) => panel.dataset.focused === 'true')?.dataset.panelId,
      rightmostPanelId: panels.at(-1)?.dataset.panelId,
    };
  });
}

type FitMeasurement = Awaited<ReturnType<typeof measureFit>>;

function maxDevicePixelOverflow(fit: FitMeasurement, edgeAllowance: number) {
  return Math.max(
    devicePixelOverflow(fit.canvasRight, fit.visibleRight, edgeAllowance, fit.devicePixelRatio),
    devicePixelOverflow(fit.rightmostRight, fit.visibleRight, edgeAllowance, fit.devicePixelRatio),
  );
}

for (const viewportWidth of [640, 1200]) {
  for (const zoomFactor of [1, 2]) {
    test(`fits structural increases in a ${viewportWidth}px viewport at ${zoomFactor * 100}% zoom`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const component = await mount(PanelStructuralColumnFitHarness, {
        props: { viewportWidth, zoomFactor, persistedCanvasWidth: 1800 },
      });
      const edgeAllowance = zoomFactor;

      for (const count of [2, 3, 4]) {
        await addColumn(component, count);
        await expect
          .poll(async () => {
            const widths = (await measureFit(component)).panelWidths;
            return Math.max(...widths) - Math.min(...widths);
          })
          .toBeLessThanOrEqual(0.5);
        await expect
          .poll(async () => (await measureFit(component)).insetScrollWidth)
          .toBeLessThanOrEqual((await measureFit(component)).insetClientWidth);
        await expect
          .poll(async () => maxDevicePixelOverflow(await measureFit(component), edgeAllowance))
          .toBeLessThanOrEqual(MAX_ENDPOINT_ROUNDING_PIXELS);
        const fit = await measureFit(component);

        expect(Math.abs(fit.handleCenter - fit.renderedCanvasRight)).toBeLessThanOrEqual(1);
        expect(fit.canvasWidth).toBeLessThanOrEqual(fit.availableWidth);
        expect(maxDevicePixelOverflow(fit, edgeAllowance)).toBeLessThanOrEqual(
          MAX_ENDPOINT_ROUNDING_PIXELS,
        );
        expect(Math.max(...fit.panelWidths) - Math.min(...fit.panelWidths)).toBeLessThanOrEqual(
          0.5,
        );
        expect(fit.focusedPanelId).toBe(fit.rightmostPanelId);
      }
    });
  }
}

test('refits a structural 1→2 increase after the available viewport shrinks', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelStructuralColumnFitHarness, {
    props: { viewportWidth: 1200, persistedCanvasWidth: 1800 },
  });

  await addColumn(component, 2);
  const before = await measureFit(component);

  await component.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="structural-column-viewport"]',
    )!;
    viewport.style.width = '1060px';
  });
  await expect
    .poll(async () => (await measureFit(component)).insetClientWidth)
    .toBeLessThan(before.insetClientWidth);
  await expect
    .poll(async () => (await measureFit(component)).insetScrollWidth)
    .toBeLessThanOrEqual((await measureFit(component)).insetClientWidth);
  const after = await measureFit(component);

  expect(after.insetClientWidth).toBeLessThan(before.insetClientWidth);
  expect(after.canvasWidth).toBeLessThanOrEqual(after.availableWidth);
  expect(after.canvasRight).toBeLessThanOrEqual(after.visibleRight + 1);
  expect(after.rightmostRight).toBeLessThanOrEqual(after.visibleRight + 1);
});
