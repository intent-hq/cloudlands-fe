import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';

const GUTTER_WIDTH = 8;
const ROOT_HANDLE_SELECTOR =
  '.panel-split-container.horizontal > .panel-split-handle-wrapper > button[data-resize-axis="x"]';

type Geometry = {
  canvasWidth: number;
  canvasVisualWidth: number;
  panelWidths: number[];
  panelVisualWidths: number[];
};

function readGeometry(component: Locator): Promise<Geometry> {
  return component.evaluate(() => {
    const canvas = document.querySelector('.panel-canvas-resize-handle')
      ?.parentElement as HTMLElement;
    const root = document.querySelector('.panel-split-container.horizontal') as HTMLElement;
    const panels = Array.from(root.querySelectorAll<HTMLElement>(':scope > .panel-split-child'));
    return {
      canvasWidth: canvas.offsetWidth,
      canvasVisualWidth: canvas.getBoundingClientRect().width,
      panelWidths: panels.map((panel) => panel.offsetWidth),
      panelVisualWidths: panels.map((panel) => panel.getBoundingClientRect().width),
    };
  });
}

async function nextFrames(page: Page, count: number) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise(requestAnimationFrame);
    }
  }, count);
}

async function dragDivider(
  page: Page,
  component: Locator,
  handle: Locator,
  cssDelta: number,
  zoomFactor: number,
) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Missing divider geometry');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + cssDelta * zoomFactor, startY, { steps: 4 });
  await nextFrames(page, 1);
  const preview = await readGeometry(component);
  await page.mouse.up();
  const pointerUp = await readGeometry(component);
  await nextFrames(page, 3);
  return { preview, pointerUp, settled: await readGeometry(component) };
}

function expectGeometry(actual: Geometry, widths: number[], zoomFactor: number) {
  const canvasWidth =
    widths.reduce((sum, width) => sum + width, 0) + GUTTER_WIDTH * (widths.length - 1);
  expect(actual.canvasWidth).toBeCloseTo(canvasWidth, 0);
  expect(actual.canvasVisualWidth).toBeCloseTo(canvasWidth * zoomFactor, 0);
  expect(actual.panelWidths).toEqual(widths);
  actual.panelVisualWidths.forEach((width, index) =>
    expect(width).toBeCloseTo(widths[index] * zoomFactor, 0),
  );
}

const viewports = [
  {
    name: 'narrow',
    size: { width: 900, height: 700 },
    viewportWidth: 620,
    canvasWidth: 760,
    widths: [220, 300, 224],
  },
  {
    name: 'wide',
    size: { width: 1800, height: 900 },
    viewportWidth: 900,
    canvasWidth: 1200,
    widths: [320, 500, 364],
  },
] as const;

for (const mode of ['contained', 'uncontained'] as const) {
  for (const viewport of viewports) {
    for (const zoomFactor of [1, 2]) {
      test(`${mode} ${viewport.name} root dividers shrink repeatedly at ${zoomFactor * 100}% zoom`, async ({
        mount,
        page,
      }) => {
        await page.setViewportSize(viewport.size);
        await page.emulateMedia({
          reducedMotion: viewport.name === 'narrow' ? 'reduce' : 'no-preference',
        });
        const component = await mount(PanelWorkspaceColumnClipHarness, {
          props: {
            mode,
            sidebarWidth: 0,
            canvasWidth: mode === 'contained' ? viewport.canvasWidth : viewport.viewportWidth,
            persistedCanvasWidth: viewport.canvasWidth,
            insetChrome: 0,
            zoomFactor,
            panelTypes: ['note', 'note', 'note'],
            panelSizes: viewport.widths.map(
              (width) => (width / (viewport.canvasWidth - GUTTER_WIDTH * 2)) * 100,
            ),
          },
        });
        const handles = component.locator(ROOT_HANDLE_SELECTOR);
        await expect(handles).toHaveCount(2);
        const widths = [...viewport.widths];
        // The canvas settles to the persisted width asynchronously; wait for
        // it before asserting the strict initial geometry.
        const expectedCanvasWidth =
          widths.reduce((sum, width) => sum + width, 0) + GUTTER_WIDTH * (widths.length - 1);
        await expect
          .poll(async () => (await readGeometry(component)).canvasWidth)
          .toBeCloseTo(expectedCanvasWidth, 0);
        expectGeometry(await readGeometry(component), widths, zoomFactor);

        for (const dividerIndex of [0, 1]) {
          for (const delta of [80, -120, 60, -40]) {
            const before = [...widths];
            widths[dividerIndex] += delta;
            const result = await dragDivider(
              page,
              component,
              handles.nth(dividerIndex),
              delta,
              zoomFactor,
            );
            expectGeometry(result.preview, widths, zoomFactor);
            expectGeometry(result.pointerUp, widths, zoomFactor);
            expectGeometry(result.settled, widths, zoomFactor);
            before.forEach((width, index) => {
              if (index !== dividerIndex) expect(result.settled.panelWidths[index]).toBe(width);
            });
          }
        }
      });
    }
  }
}

for (const zoomFactor of [1, 2]) {
  test(`keeps fill-width divider choices authoritative at ${zoomFactor * 100}% zoom`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      props: {
        mode: 'uncontained',
        sidebarWidth: 0,
        canvasWidth: 1028,
        persistedCanvasWidth: null,
        insetChrome: 0,
        zoomFactor,
      },
    });
    let handle = component.locator(ROOT_HANDLE_SELECTOR);
    await expect(handle).toHaveCount(1);

    const widths = [500, 500];
    expectGeometry(await readGeometry(component), widths, zoomFactor);

    widths[0] = 280;
    const shrunk = await dragDivider(page, component, handle, -220, zoomFactor);
    expectGeometry(shrunk.preview, widths, zoomFactor);
    expectGeometry(shrunk.pointerUp, widths, zoomFactor);
    expectGeometry(shrunk.settled, widths, zoomFactor);

    await component.getByTestId('width-plus-one').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await nextFrames(page, 3);
    expectGeometry(await readGeometry(component), widths, zoomFactor);

    await component.getByTestId('reload-panel-layout').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    handle = component.locator(ROOT_HANDLE_SELECTOR);
    await expect(handle).toHaveCount(1);
    await nextFrames(page, 3);
    expectGeometry(await readGeometry(component), widths, zoomFactor);

    widths[0] = 360;
    const grown = await dragDivider(page, component, handle, 80, zoomFactor);
    expectGeometry(grown.preview, widths, zoomFactor);
    expectGeometry(grown.pointerUp, widths, zoomFactor);
    expectGeometry(grown.settled, widths, zoomFactor);

    await component.getByTestId('reload-panel-layout').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await nextFrames(page, 3);
    expectGeometry(await readGeometry(component), widths, zoomFactor);
  });
}
