import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';
import { resizePanelWidthsAtDivider } from '$shared/panel-layout-sizing';

const GUTTER_WIDTH = 8;
const ROOT_HANDLE_SELECTOR =
  '.panel-split-container.horizontal > .panel-split-handle-wrapper > button[data-resize-axis="x"]';

type Geometry = {
  canvasWidth: number;
  canvasVisualWidth: number;
  canvasRight: number;
  outerHandleCenter: number;
  panelWidths: number[];
  panelVisualWidths: number[];
  panelLefts: number[];
  panelRights: number[];
  dividerCenters: number[];
};

function readGeometry(component: Locator): Promise<Geometry> {
  return component.evaluate(() => {
    const canvas = document.querySelector('.panel-canvas-resize-handle')
      ?.parentElement as HTMLElement;
    const outerHandle = document.querySelector('.panel-canvas-resize-handle') as HTMLElement;
    const root = document.querySelector('.panel-split-container.horizontal') as HTMLElement;
    const panels = Array.from(root.querySelectorAll<HTMLElement>(':scope > .panel-split-child'));
    const dividers = Array.from(
      root.querySelectorAll<HTMLElement>(
        ':scope > .panel-split-handle-wrapper > button[data-resize-axis="x"]',
      ),
    );
    const canvasRect = canvas.getBoundingClientRect();
    const outerHandleRect = outerHandle.getBoundingClientRect();
    const panelRects = panels.map((panel) => panel.getBoundingClientRect());
    return {
      canvasWidth: canvas.offsetWidth,
      canvasVisualWidth: canvasRect.width,
      canvasRight: canvasRect.right,
      outerHandleCenter: outerHandleRect.left + outerHandleRect.width / 2,
      panelWidths: panels.map((panel) => panel.offsetWidth),
      panelVisualWidths: panelRects.map((rect) => rect.width),
      panelLefts: panelRects.map((rect) => rect.left),
      panelRights: panelRects.map((rect) => rect.right),
      dividerCenters: dividers.map((divider) => {
        const rect = divider.getBoundingClientRect();
        return rect.left + rect.width / 2;
      }),
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

async function dragDividerBeforeNextFrame(
  page: Page,
  component: Locator,
  dividerIndex: number,
  cssDelta: number,
  zoomFactor: number,
) {
  const immediate = await component.evaluate(
    (_, { dividerIndex, visualDelta }) => {
      function snapshot(): Geometry {
        const canvas = document.querySelector('.panel-canvas-resize-handle')
          ?.parentElement as HTMLElement;
        const outerHandle = document.querySelector('.panel-canvas-resize-handle') as HTMLElement;
        const root = document.querySelector('.panel-split-container.horizontal') as HTMLElement;
        const panels = Array.from(
          root.querySelectorAll<HTMLElement>(':scope > .panel-split-child'),
        );
        const dividers = Array.from(
          root.querySelectorAll<HTMLElement>(
            ':scope > .panel-split-handle-wrapper > button[data-resize-axis="x"]',
          ),
        );
        const canvasRect = canvas.getBoundingClientRect();
        const outerHandleRect = outerHandle.getBoundingClientRect();
        const panelRects = panels.map((panel) => panel.getBoundingClientRect());
        return {
          canvasWidth: canvas.offsetWidth,
          canvasVisualWidth: canvasRect.width,
          canvasRight: canvasRect.right,
          outerHandleCenter: outerHandleRect.left + outerHandleRect.width / 2,
          panelWidths: panels.map((panel) => panel.offsetWidth),
          panelVisualWidths: panelRects.map((rect) => rect.width),
          panelLefts: panelRects.map((rect) => rect.left),
          panelRights: panelRects.map((rect) => rect.right),
          dividerCenters: dividers.map((divider) => {
            const rect = divider.getBoundingClientRect();
            return rect.left + rect.width / 2;
          }),
        };
      }

      const handle = document.querySelectorAll<HTMLElement>(
        '.panel-split-container.horizontal > .panel-split-handle-wrapper > button[data-resize-axis="x"]',
      )[dividerIndex];
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }),
      );
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: startX + visualDelta, clientY: 1 }),
      );
      const preview = snapshot();
      window.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: startX + visualDelta, clientY: 1 }),
      );
      return { preview, pointerUp: snapshot() };
    },
    { dividerIndex, visualDelta: cssDelta * zoomFactor },
  );
  await nextFrames(page, 3);
  return { ...immediate, settled: await readGeometry(component) };
}

function expectGeometry(actual: Geometry, widths: number[], zoomFactor: number) {
  const canvasWidth =
    widths.reduce((sum, width) => sum + width, 0) + GUTTER_WIDTH * (widths.length - 1);
  expect(actual.canvasWidth).toBeCloseTo(canvasWidth, 0);
  expect(actual.canvasVisualWidth).toBeCloseTo(canvasWidth * zoomFactor, 0);
  actual.panelWidths.forEach((width, index) => expect(width).toBeCloseTo(widths[index], 0));
  actual.panelVisualWidths.forEach((width, index) =>
    expect(width).toBeCloseTo(widths[index] * zoomFactor, 0),
  );
}

function expectStableGeometry(preview: Geometry, committed: Geometry) {
  const previewEdges = [
    preview.canvasRight,
    preview.outerHandleCenter,
    ...preview.panelLefts,
    ...preview.panelRights,
    ...preview.dividerCenters,
  ];
  const committedEdges = [
    committed.canvasRight,
    committed.outerHandleCenter,
    ...committed.panelLefts,
    ...committed.panelRights,
    ...committed.dividerCenters,
  ];
  expect(committedEdges).toHaveLength(previewEdges.length);
  committedEdges.forEach((edge, index) => expect(edge).toBeCloseTo(previewEdges[index], 0));
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

        widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, 47).panelWidths);
        const fastRelease = await dragDividerBeforeNextFrame(page, component, 0, 47, zoomFactor);
        expectGeometry(fastRelease.preview, widths, zoomFactor);
        expectGeometry(fastRelease.pointerUp, widths, zoomFactor);
        expectGeometry(fastRelease.settled, widths, zoomFactor);
        expectStableGeometry(fastRelease.preview, fastRelease.pointerUp);
        expectStableGeometry(fastRelease.preview, fastRelease.settled);

        for (const dividerIndex of [0, 1]) {
          for (const delta of [80, -120, 60, -40]) {
            const before = [...widths];
            widths.splice(
              0,
              widths.length,
              ...resizePanelWidthsAtDivider(widths, dividerIndex, delta).panelWidths,
            );
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
            expectStableGeometry(result.preview, result.pointerUp);
            expectStableGeometry(result.preview, result.settled);
            before.slice(0, dividerIndex).forEach((width, index) => {
              expect(result.settled.panelWidths[index]).toBeCloseTo(width, 0);
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

    widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, 53).panelWidths);
    const fastRelease = await dragDividerBeforeNextFrame(page, component, 0, 53, zoomFactor);
    expectGeometry(fastRelease.preview, widths, zoomFactor);
    expectGeometry(fastRelease.pointerUp, widths, zoomFactor);
    expectGeometry(fastRelease.settled, widths, zoomFactor);
    expectStableGeometry(fastRelease.preview, fastRelease.pointerUp);
    expectStableGeometry(fastRelease.preview, fastRelease.settled);

    widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, -220).panelWidths);
    const shrunk = await dragDivider(page, component, handle, -220, zoomFactor);
    expectGeometry(shrunk.preview, widths, zoomFactor);
    expectGeometry(shrunk.pointerUp, widths, zoomFactor);
    expectGeometry(shrunk.settled, widths, zoomFactor);
    expectStableGeometry(shrunk.preview, shrunk.pointerUp);
    expectStableGeometry(shrunk.preview, shrunk.settled);

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

    widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, 80).panelWidths);
    const grown = await dragDivider(page, component, handle, 80, zoomFactor);
    expectGeometry(grown.preview, widths, zoomFactor);
    expectGeometry(grown.pointerUp, widths, zoomFactor);
    expectGeometry(grown.settled, widths, zoomFactor);
    expectStableGeometry(grown.preview, grown.pointerUp);
    expectStableGeometry(grown.preview, grown.settled);

    await component.getByTestId('reload-panel-layout').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await nextFrames(page, 3);
    expectGeometry(await readGeometry(component), widths, zoomFactor);
  });
}
