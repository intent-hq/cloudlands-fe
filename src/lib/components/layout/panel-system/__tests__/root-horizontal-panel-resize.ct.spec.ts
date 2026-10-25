import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';
const ROOT_HANDLE_SELECTOR =
  '.panel-split-container.horizontal > .panel-split-handle-wrapper button[data-resize-axis="x"]';

type Geometry = {
  canvasWidth: number;
  canvasVisualWidth: number;
  canvasRight: number;
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
        const canvas = document.querySelector('.panel-canvas-frame') as HTMLElement;
        const root = document.querySelector('.panel-split-container.horizontal') as HTMLElement;
        const panels = Array.from(
          root.querySelectorAll<HTMLElement>(':scope > .panel-split-child'),
        );
        const dividers = Array.from(
          root.querySelectorAll<HTMLElement>(
            ':scope > .panel-split-handle-wrapper button[data-resize-axis="x"]',
          ),
        );
        const canvasRect = canvas.getBoundingClientRect();
        const panelRects = panels.map((panel) => panel.getBoundingClientRect());
        return {
          canvasWidth: canvas.offsetWidth,
          canvasVisualWidth: canvasRect.width,
          canvasRight: canvasRect.right,
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

async function expectSettledGeometry(component: Locator, expected?: Geometry): Promise<Geometry> {
  let previous = await readSettledGeometry(component);
  let settled = previous;
  await expect(async () => {
    settled = await readSettledGeometry(component);
    expect(settled.panelWidths.every((width) => width > 0)).toBe(true);
    const prior = previous;
    previous = settled;
    expectStableGeometry(prior, settled);
    if (expected) expectStableGeometry(expected, settled);
  }).toPass();
  return settled;
}

async function expectCommittedGeometry(page: Page, component: Locator, expected: Geometry) {
  await nextFrames(page, 1);
  return expectSettledGeometry(component, expected);
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
  await armPointerUpSnapshot(page);
  await page.mouse.move(startX + cssDelta * zoomFactor, startY, { steps: 4 });
  // The handle batches pointer moves into one animation frame; that frame was
  // requested before this one, so the preview write has happened once it runs.
  await nextFrames(page, 1);
  const preview = await readSettledGeometry(component);
  await page.mouse.up();
  const pointerUp = await takePointerUpSnapshot(page);
  const settled = await expectCommittedGeometry(page, component, preview);
  return { preview, pointerUp, settled };
}

async function dragDividerBeforeNextFrame(
  page: Page,
  component: Locator,
  dividerIndex: number,
  cssDelta: number,
  zoomFactor: number,
) {
  const immediate = await component.evaluate(
    async (_, { dividerIndex, visualDelta }) => {
      const geometry = (window as GeometryWindow).__panelGeometry;
      if (!geometry) throw new Error('Geometry reader not installed');
      const handle = document.querySelectorAll<HTMLElement>(
        '.panel-split-container.horizontal > .panel-split-handle-wrapper button[data-resize-axis="x"]',
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
  const settled = await expectCommittedGeometry(page, component, immediate.pointerUp);
  return { ...immediate, settled };
}

async function waitForRemount(root: Locator, action: () => Promise<void>) {
  const previousRoot = await root.elementHandle();
  if (!previousRoot) throw new Error('Missing panel layout root');
  await action();
  await expect.poll(() => previousRoot.evaluate((element) => element.isConnected)).toBe(false);
  await expect(root).toHaveCount(1);
}

function expectStableGeometry(preview: Geometry, committed: Geometry) {
  const previewEdges = [
    preview.canvasRight,
    ...preview.panelLefts,
    ...preview.panelRights,
    ...preview.dividerCenters,
  ];
  const committedEdges = [
    committed.canvasRight,
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
              (width) => (width / viewport.widths.reduce((sum, item) => sum + item, 0)) * 100,
            ),
          },
        });
        await installGeometryReader(page);
        const handles = component.locator(ROOT_HANDLE_SELECTOR);
        await expect(handles).toHaveCount(2);
        const beforeFastRelease = await expectSettledGeometry(component);
        const fastRelease = await dragDividerBeforeNextFrame(page, component, 0, 47, zoomFactor);
        expectStableGeometry(beforeFastRelease, fastRelease.preview);
        expect(fastRelease.pointerUp.panelWidths[0]).toBeGreaterThan(
          beforeFastRelease.panelWidths[0],
        );
        expectStableGeometry(fastRelease.pointerUp, fastRelease.settled);

        for (const dividerIndex of [0, 1]) {
          for (const delta of [80, -120, 60, -40]) {
            const before = await readSettledGeometry(component);
            const result = await dragDivider(
              page,
              component,
              handles.nth(dividerIndex),
              delta,
              zoomFactor,
            );
            if (delta > 0)
              expect(result.preview.panelWidths[dividerIndex]).toBeGreaterThan(
                before.panelWidths[dividerIndex],
              );
            else
              expect(result.preview.panelWidths[dividerIndex]).toBeLessThan(
                before.panelWidths[dividerIndex],
              );
            expectStableGeometry(result.preview, result.pointerUp);
            expectStableGeometry(result.preview, result.settled);
            before.panelWidths.slice(0, dividerIndex).forEach((width, index) => {
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

    const beforeFastRelease = await expectSettledGeometry(component);
    const fastRelease = await dragDividerBeforeNextFrame(page, component, 0, 53, zoomFactor);
    expectStableGeometry(beforeFastRelease, fastRelease.preview);
    expect(fastRelease.pointerUp.panelWidths[0]).toBeGreaterThan(beforeFastRelease.panelWidths[0]);
    expectStableGeometry(fastRelease.pointerUp, fastRelease.settled);

    const shrunk = await dragDivider(page, component, handle, -220, zoomFactor);
    expect(shrunk.preview.panelWidths[0]).toBeLessThan(fastRelease.settled.panelWidths[0]);
    expectStableGeometry(shrunk.preview, shrunk.pointerUp);
    expectStableGeometry(shrunk.preview, shrunk.settled);

    await component.getByTestId('width-plus-one').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await expect
      .poll(async () => (await readGeometry(component)).canvasWidth)
      .toBeGreaterThan(shrunk.settled.canvasWidth);
    const resized = await expectSettledGeometry(component);
    await waitForRemount(root, () =>
      component.getByTestId('reload-panel-layout').evaluate((button: HTMLButtonElement) => {
        button.click();
      }),
    );
    await expect(handle).toHaveCount(1);
    await expectSettledGeometry(component, resized);

    const grown = await dragDivider(page, component, handle, 80, zoomFactor);
    expect(grown.preview.panelWidths[0]).toBeGreaterThan(resized.panelWidths[0]);
    expectStableGeometry(grown.preview, grown.pointerUp);
    expectStableGeometry(grown.preview, grown.settled);
    await waitForRemount(root, () =>
      component.getByTestId('reload-panel-layout').evaluate((button: HTMLButtonElement) => {
        button.click();
      }),
    );
    await expectSettledGeometry(component, grown.settled);
  });
}
