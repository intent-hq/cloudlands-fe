import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';
import {
  allocateViewportPanelWidths,
  resizePanelWidthsAtDivider,
} from '$shared/panel-layout-sizing';

const GUTTER_WIDTH = 8;
const UNCONTAINED_INLINE_CHROME = 20;
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

type GeometryWindow = Window & {
  __panelGeometry?: {
    read: () => Geometry;
    settle: () => Promise<void>;
    pointerUp: Promise<Geometry> | null;
  };
};

/**
 * Installs the geometry reader in the page so the same snapshot can be taken
 * from the Node side and from in-page event listeners.
 *
 * `settle` waits for every finite animation under the split root to finish.
 * Under `prefers-reduced-motion: reduce` the app forces a 0.01ms
 * `transition-duration` on every element. `body.panel-resizing` disables
 * transitions while the pointer is down, but the release write happens in the
 * same task as that class is removed, so it becomes a CSS transition that only
 * lands on a later frame: a synchronous read (or a fixed frame count) can
 * observe the previous or a mid-transition basis. `getAnimations()` flushes
 * style, so the transitions created by a write in the current task are
 * already visible to it.
 */
async function installGeometryReader(page: Page) {
  await page.evaluate(() => {
    (window as GeometryWindow).__panelGeometry = {
      pointerUp: null,
      settle: async () => {
        const root = document.querySelector('.panel-split-container.horizontal') as HTMLElement;
        for (;;) {
          const running = root
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation.playState === 'running' &&
                Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity),
            );
          if (running.length === 0) return;
          await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
        }
      },
      read: () => {
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
      },
    };
  });
}

function readGeometry(component: Locator): Promise<Geometry> {
  return component.evaluate(() => {
    const geometry = (window as GeometryWindow).__panelGeometry;
    if (!geometry) throw new Error('Geometry reader not installed');
    return geometry.read();
  });
}

/** Reads geometry once the animations already in flight have finished. */
function readSettledGeometry(component: Locator): Promise<Geometry> {
  return component.evaluate(async () => {
    const geometry = (window as GeometryWindow).__panelGeometry;
    if (!geometry) throw new Error('Geometry reader not installed');
    await geometry.settle();
    return geometry.read();
  });
}

/**
 * Arms a window `mouseup` listener that captures the release geometry. Call it
 * after `mouse.down()`: the split handle registers its own window `mouseup`
 * listener on mousedown, so a listener armed afterwards runs in the release
 * task once the handle has flushed the pending move and committed the layout;
 * it then waits only for the transitions that release started.
 */
async function armPointerUpSnapshot(page: Page) {
  await page.evaluate(() => {
    const geometry = (window as GeometryWindow).__panelGeometry;
    if (!geometry) throw new Error('Geometry reader not installed');
    geometry.pointerUp = null;
    window.addEventListener(
      'mouseup',
      () => {
        geometry.pointerUp = geometry.settle().then(() => geometry.read());
      },
      { once: true },
    );
  });
}

async function takePointerUpSnapshot(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const geometry = (window as GeometryWindow).__panelGeometry;
    if (!geometry?.pointerUp) throw new Error('Pointer-up geometry was not captured');
    return geometry.pointerUp;
  });
}

async function nextFrames(page: Page, count: number) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise(requestAnimationFrame);
    }
  }, count);
}

function describeGeometryMismatch(actual: Geometry, widths: number[], zoomFactor: number) {
  const canvasWidth =
    widths.reduce((sum, width) => sum + width, 0) + GUTTER_WIDTH * (widths.length - 1);
  const mismatches: string[] = [];
  const check = (label: string, value: number, expected: number) => {
    if (Math.abs(value - expected) >= 0.5) mismatches.push(`${label}: ${value} vs ${expected}`);
  };
  check('canvasWidth', actual.canvasWidth, canvasWidth);
  check('canvasVisualWidth', actual.canvasVisualWidth, canvasWidth * zoomFactor);
  if (actual.panelWidths.length !== widths.length) {
    mismatches.push(`panelCount: ${actual.panelWidths.length} vs ${widths.length}`);
  }
  actual.panelWidths.forEach((width, index) =>
    check(`panelWidths[${index}]`, width, widths[index]),
  );
  actual.panelVisualWidths.forEach((width, index) =>
    check(`panelVisualWidths[${index}]`, width, widths[index] * zoomFactor),
  );
  return mismatches;
}

/**
 * Polls until the geometry converges to `widths`. Layout commits reach the
 * DOM through the store's cadenced selector delivery (throttled ticks
 * scheduled via setTimeout + requestAnimationFrame) and the viewport
 * measurement's batched layout read, so no fixed frame count is a valid
 * "committed" signal; the expected geometry itself is. Whether the store
 * commit itself was persisted is proven by the reload reads, which remount
 * from the store alone.
 */
async function expectSettledGeometry(
  component: Locator,
  widths: number[],
  zoomFactor: number,
): Promise<Geometry> {
  let settled: Geometry | null = null;
  await expect
    .poll(async () => {
      settled = await readGeometry(component);
      return describeGeometryMismatch(settled, widths, zoomFactor);
    })
    .toEqual([]);
  if (!settled) throw new Error('Geometry never settled');
  return settled;
}

/**
 * Post-release variant of `expectSettledGeometry`. On release the container
 * pins each child's inline `flex` to the release widths and drops that pin in
 * an animation frame it requests during the release task; a frame requested
 * afterwards runs after it (registration order), and the pin drop re-renders
 * the children from the store-delivered widths. Starting the poll only after
 * that frame means the geometry it accepts is the store-driven layout, not the
 * release pin the `pointerUp` snapshot already read.
 */
async function expectCommittedGeometry(
  page: Page,
  component: Locator,
  widths: number[],
  zoomFactor: number,
): Promise<Geometry> {
  await nextFrames(page, 1);
  return expectSettledGeometry(component, widths, zoomFactor);
}

async function dragDivider(
  page: Page,
  component: Locator,
  handle: Locator,
  cssDelta: number,
  zoomFactor: number,
  committedWidths: number[],
) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Missing divider geometry');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await armPointerUpSnapshot(page);
  await page.mouse.move(startX + cssDelta * zoomFactor, startY, { steps: 4 });
  // The handle batches pointer moves into one animation frame; that frame was
  // requested before this one, so the preview write has happened once it runs.
  await nextFrames(page, 1);
  const preview = await readSettledGeometry(component);
  await page.mouse.up();
  const pointerUp = await takePointerUpSnapshot(page);
  const settled = await expectCommittedGeometry(page, component, committedWidths, zoomFactor);
  return { preview, pointerUp, settled };
}

async function dragDividerBeforeNextFrame(
  page: Page,
  component: Locator,
  dividerIndex: number,
  cssDelta: number,
  zoomFactor: number,
  committedWidths: number[],
) {
  const immediate = await component.evaluate(
    async (_, { dividerIndex, visualDelta }) => {
      const geometry = (window as GeometryWindow).__panelGeometry;
      if (!geometry) throw new Error('Geometry reader not installed');
      const handle = document.querySelectorAll<HTMLElement>(
        '.panel-split-container.horizontal > .panel-split-handle-wrapper > button[data-resize-axis="x"]',
      )[dividerIndex];
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }),
      );
      await Promise.resolve();
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: startX + visualDelta, clientY: 1 }),
      );
      // The move is still batched for the next frame, so nothing has changed
      // yet and the read is synchronous by design.
      const preview = geometry.read();
      window.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: startX + visualDelta, clientY: 1 }),
      );
      // Release flushed the pending move and committed the layout in this task;
      // wait only for the transitions that write started.
      await geometry.settle();
      const pointerUp = geometry.read();
      return { preview, pointerUp };
    },
    { dividerIndex, visualDelta: cssDelta * zoomFactor },
  );
  const settled = await expectCommittedGeometry(page, component, committedWidths, zoomFactor);
  return { ...immediate, settled };
}

async function waitForRemount(root: Locator, action: () => Promise<void>) {
  const previousRoot = await root.elementHandle();
  if (!previousRoot) throw new Error('Missing panel layout root');
  await action();
  await expect.poll(() => previousRoot.evaluate((element) => element.isConnected)).toBe(false);
  await expect(root).toHaveCount(1);
}

function expectGeometry(actual: Geometry, widths: number[], zoomFactor: number) {
  expect(describeGeometryMismatch(actual, widths, zoomFactor)).toEqual([]);
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
        await installGeometryReader(page);
        const handles = component.locator(ROOT_HANDLE_SELECTOR);
        await expect(handles).toHaveCount(2);
        const initialCanvasWidth =
          mode === 'uncontained'
            ? viewport.viewportWidth - UNCONTAINED_INLINE_CHROME
            : viewport.canvasWidth;
        const widths =
          mode === 'uncontained'
            ? allocateViewportPanelWidths(viewport.widths, initialCanvasWidth).panelWidths
            : [...viewport.widths];
        // The canvas settles to its policy width asynchronously; content keeps
        // the persisted width, while viewport mode fits the available frame.
        await expectSettledGeometry(component, widths, zoomFactor);

        const beforeFastRelease = [...widths];
        widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, 47).panelWidths);
        const fastRelease = await dragDividerBeforeNextFrame(
          page,
          component,
          0,
          47,
          zoomFactor,
          widths,
        );
        expectGeometry(fastRelease.preview, beforeFastRelease, zoomFactor);
        expectGeometry(fastRelease.pointerUp, widths, zoomFactor);
        expectStableGeometry(fastRelease.pointerUp, fastRelease.settled);

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
              widths,
            );
            expectGeometry(result.preview, widths, zoomFactor);
            expectGeometry(result.pointerUp, widths, zoomFactor);
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
    await installGeometryReader(page);
    const handle = component.locator(ROOT_HANDLE_SELECTOR);
    const root = component.locator('.panel-split-container.horizontal');
    await expect(handle).toHaveCount(1);

    const widths = [500, 500];
    await expectSettledGeometry(component, widths, zoomFactor);

    const beforeFastRelease = [...widths];
    widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, 53).panelWidths);
    const fastRelease = await dragDividerBeforeNextFrame(
      page,
      component,
      0,
      53,
      zoomFactor,
      widths,
    );
    expectGeometry(fastRelease.preview, beforeFastRelease, zoomFactor);
    expectGeometry(fastRelease.pointerUp, widths, zoomFactor);
    expectStableGeometry(fastRelease.pointerUp, fastRelease.settled);

    widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, -220).panelWidths);
    const shrunk = await dragDivider(page, component, handle, -220, zoomFactor, widths);
    expectGeometry(shrunk.preview, widths, zoomFactor);
    expectGeometry(shrunk.pointerUp, widths, zoomFactor);
    expectStableGeometry(shrunk.preview, shrunk.pointerUp);
    expectStableGeometry(shrunk.preview, shrunk.settled);

    await component.getByTestId('width-plus-one').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    widths.splice(0, widths.length, ...allocateViewportPanelWidths(widths, 1009).panelWidths);
    await expectSettledGeometry(component, widths, zoomFactor);

    await waitForRemount(root, () =>
      component.getByTestId('reload-panel-layout').evaluate((button: HTMLButtonElement) => {
        button.click();
      }),
    );
    await expect(handle).toHaveCount(1);
    await expectSettledGeometry(component, widths, zoomFactor);

    widths.splice(0, widths.length, ...resizePanelWidthsAtDivider(widths, 0, 80).panelWidths);
    const grown = await dragDivider(page, component, handle, 80, zoomFactor, widths);
    expectGeometry(grown.preview, widths, zoomFactor);
    expectGeometry(grown.pointerUp, widths, zoomFactor);
    expectStableGeometry(grown.preview, grown.pointerUp);
    expectStableGeometry(grown.preview, grown.settled);

    await waitForRemount(root, () =>
      component.getByTestId('reload-panel-layout').evaluate((button: HTMLButtonElement) => {
        button.click();
      }),
    );
    await expectSettledGeometry(component, widths, zoomFactor);
  });
}
