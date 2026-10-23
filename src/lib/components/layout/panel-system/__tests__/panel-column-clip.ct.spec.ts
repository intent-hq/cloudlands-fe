import { expect, test } from '../../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';

// Earlier specs in the shared CT page may leave a resized viewport behind;
// the geometry below assumes the default 1280x720 viewport, so pin it. The
// intermediate size forces a real resize even when Playwright's cached
// viewport already matches, so stale emulation state is flushed.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 719 });
  await page.setViewportSize({ width: 1280, height: 720 });
});

function measureGeometry(component: Locator) {
  return component.evaluate(async () => {
    await document.fonts.ready;
    const readGeometry = () => {
      const column = document.querySelector('[data-testid="panel-column"]') as HTMLElement;
      const inset = document.querySelector('[data-testid="panel-workspace-inset"]') as HTMLElement;
      const canvas = inset?.querySelector('.panel-canvas-frame') as HTMLElement | null;
      const panels = Array.from(
        document.querySelectorAll<HTMLElement>('.panel-split-container > .panel-split-child'),
      );
      const columnRect = column.getBoundingClientRect();
      const insetRect = inset?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      const lastPanelRect = panels.at(-1)?.getBoundingClientRect();
      return {
        columnRight: columnRect.right,
        columnWidth: columnRect.width,
        insetLeft: insetRect?.left ?? null,
        insetRight: insetRect?.right ?? null,
        insetBottom: insetRect?.bottom ?? null,
        insetPaddingLeft: inset ? getComputedStyle(inset).paddingLeft : null,
        insetPaddingRight: inset ? getComputedStyle(inset).paddingRight : null,
        insetPaddingBottom: inset ? getComputedStyle(inset).paddingBottom : null,
        insetScrollWidth: inset?.scrollWidth ?? null,
        insetClientWidth: inset?.clientWidth ?? null,
        insetScrollLeft: inset?.scrollLeft ?? null,
        canvasWidth: canvasRect?.width ?? null,
        canvasOffsetWidth: canvas?.offsetWidth ?? null,
        canvasRight: canvasRect?.right ?? null,
        lastPanelRight: lastPanelRect?.right ?? null,
        lastPanelBottom: lastPanelRect?.bottom ?? null,
        lastPanelFlex: panels.at(-1)?.style.flex ?? null,
        panelWidths: panels.map((panel) => panel.getBoundingClientRect().width),
      };
    };

    let geometry = readGeometry();
    let serialized = JSON.stringify(geometry);
    let stableFrames = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      geometry = readGeometry();
      const nextSerialized = JSON.stringify(geometry);
      stableFrames = nextSerialized === serialized ? stableFrames + 1 : 0;
      if (stableFrames === 2) return geometry;
      serialized = nextSerialized;
    }
    throw new Error('Panel geometry did not settle across consecutive animation frames');
  });
}

async function stableCanvasWidths(component: Locator) {
  return component.evaluate(async () => {
    const sample = () =>
      document.querySelector<HTMLElement>('.panel-canvas-frame')?.offsetWidth ?? null;
    const widths = [sample()];
    await new Promise(requestAnimationFrame);
    widths.push(sample());
    await new Promise(requestAnimationFrame);
    widths.push(sample());
    return widths;
  });
}

async function expectStableCanvasWidth(component: Locator, expectedWidth?: number) {
  await expect
    .poll(async () => {
      const widths = await stableCanvasWidths(component);
      return widths.every((width) => width !== null && width === (expectedWidth ?? widths[0]));
    })
    .toBe(true);
}

/**
 * Regression (clipped jump-to-end button): the rightmost panel's right edge
 * must stay inside the visible workspace shell. The shell size includes the
 * sidebar, canvas width, and contained panel inline chrome, matching the
 * PanelLayout inset's symmetric `px-2` padding.
 */
test('keeps the rightmost panel edge inside the visible column (deck mode)', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: { sidebarWidth: 360, canvasWidth: 800 },
  });

  const measurements = await measureGeometry(component);

  expect(measurements.canvasRight).not.toBeNull();
  expect(measurements.lastPanelRight).not.toBeNull();
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

  expect(measurements.canvasRight).not.toBeNull();
  expect(measurements.lastPanelRight).not.toBeNull();
  // No horizontal overflow: the automatic canvas fills exactly the inset's
  // usable content width.
  expect(measurements.insetScrollWidth!).toBeLessThanOrEqual(measurements.insetClientWidth!);
  expect(measurements.canvasRight!).toBeLessThanOrEqual(measurements.columnRight);
  expect(measurements.lastPanelRight!).toBeLessThanOrEqual(measurements.columnRight);
});

test('keeps the right inset visible at the horizontal scroll end (tab view)', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      sidebarWidth: 0,
      canvasWidth: 760,
      persistedCanvasWidth: 1208,
      insetChrome: 0,
    },
  });
  const inset = component.getByTestId('panel-workspace-inset');

  await expect
    .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
    .toBeGreaterThan(0);
  await inset.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  const geometry = await measureGeometry(component);
  expect(geometry.lastPanelRight!).toBeLessThanOrEqual(geometry.insetRight!);
});

test('clamps one automatic chat to a narrow viewport without overflow', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      scenario: 'restore-agent',
      sidebarWidth: 0,
      canvasWidth: 560,
      persistedCanvasWidth: null,
      insetChrome: 0,
    },
  });

  await expect
    .poll(async () => {
      const geometry = await measureGeometry(component);
      return geometry.canvasOffsetWidth! <= geometry.insetClientWidth!;
    })
    .toBe(true);
  const measurements = await measureGeometry(component);
  expect(measurements.insetScrollWidth).toBeLessThanOrEqual(measurements.insetClientWidth!);
});

for (const mode of ['uncontained', 'contained'] as const) {
  const testName =
    mode === 'uncontained'
      ? 'fits viewport changes while retaining the explicit width preference'
      : 'retains explicit width when the containing viewport changes';
  test(testName, async ({ mount }) => {
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      props: {
        mode,
        sidebarWidth: 0,
        canvasWidth: 760,
        persistedCanvasWidth: 1208,
        insetChrome: 0,
      },
    });

    await expect
      .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
      .toBeGreaterThan(0);
    await expect(component.getByTestId('panel-column')).toHaveAttribute(
      'data-persisted-canvas-width',
      '1208',
    );
    const resetWidth = (await measureGeometry(component)).canvasOffsetWidth!;

    await component
      .getByTestId('width-plus-one')
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect
      .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
      .toBe(mode === 'uncontained' ? resetWidth + 1 : resetWidth);
  });
}

test('keeps explicit width state while fitting viewport changes', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      sidebarWidth: 0,
      canvasWidth: 760,
      persistedCanvasWidth: 1208,
      insetChrome: 0,
    },
  });
  const column = component.getByTestId('panel-column');

  await expectStableCanvasWidth(component);
  const before = (await measureGeometry(component)).canvasOffsetWidth!;
  await expect(column).toHaveAttribute('data-persisted-canvas-width', '1208');
  await expect(column).toHaveAttribute('data-canvas-width-source', 'explicit');
  await component
    .getByTestId('width-plus-one')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expectStableCanvasWidth(component, before + 1);
});

test('reflows the panel layout to the retained width after close', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      sidebarWidth: 360,
      canvasWidth: 1200,
      persistedCanvasWidth: 1200,
      followPersistedCanvas: true,
    },
  });
  const retainedWidth = (await measureGeometry(component)).panelWidths[1];
  await component
    .getByTestId('close-first-panel')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(component.locator('[data-panel-id]')).toHaveCount(1);
  await expect
    .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
    .toBeCloseTo(retainedWidth, 0);
  const geometry = await measureGeometry(component);
  expect(geometry.lastPanelRight!).toBeLessThanOrEqual(geometry.columnRight);
});

for (const zoomFactor of [1, 2]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`keeps two panels contained through viewport resizing at ${zoomFactor * 100}% in ${theme}`, async ({
      mount,
    }) => {
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
      await component.evaluate((node, nextTheme) => {
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
        node.setAttribute('data-test-theme', nextTheme);
      }, theme);

      await expect
        .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
        .toBeGreaterThan(0);

      await component
        .getByTestId('width-minus-one')
        .evaluate((button: HTMLButtonElement) => button.click());
      const narrowed = await measureGeometry(component);
      expect(narrowed.insetScrollWidth!).toBeLessThanOrEqual(narrowed.insetClientWidth!);

      await component
        .getByTestId('width-plus-one')
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect
        .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
        .toBeGreaterThan(0);
    });
  }
}

test('fits mixed panel defaults into one ordered row', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      sidebarWidth: 0,
      canvasWidth: 420,
      persistedCanvasWidth: null,
      insetChrome: 0,
      panelTypes: ['agent', 'note', 'browser'],
    },
  });

  await expect(component.locator('[data-panel-id]')).toHaveCount(3);
  const geometry = await measureGeometry(component);
  expect(geometry.panelWidths).toHaveLength(3);
  expect(geometry.panelWidths.every((width) => width > 0)).toBe(true);
  expect(geometry.insetScrollWidth!).toBeLessThanOrEqual(geometry.insetClientWidth!);
  expect(geometry.lastPanelRight!).toBeLessThanOrEqual(geometry.columnRight);
});

test('uses persisted panel ratios as fitted viewport preferences', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      sidebarWidth: 0,
      canvasWidth: 1020,
      persistedCanvasWidth: 1208,
      insetChrome: 0,
      panelSizes: [25, 75],
    },
  });

  await expect
    .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
    .toBeGreaterThan(0);
  const geometry = await measureGeometry(component);
  expect(geometry.panelWidths[1] / geometry.panelWidths[0]).toBeCloseTo(75 / 25, 1);
  expect(geometry.insetScrollWidth!).toBeLessThanOrEqual(geometry.insetClientWidth!);
});

test('creates a fitted chat once without a post-creation resize flash', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      scenario: 'create-agent',
      sidebarWidth: 0,
      canvasWidth: 760,
      persistedCanvasWidth: null,
      insetChrome: 0,
    },
  });

  await component.getByTestId('create-agent-panel').evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  await expect(component.locator('[data-panel-id]')).toHaveCount(2);
  await expect
    .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
    .toBeGreaterThan(0);
  const widths = await stableCanvasWidths(component);
  expect(widths).toEqual([widths[0], widths[0], widths[0]]);
  const geometry = await measureGeometry(component);
  expect(geometry.insetScrollWidth!).toBeLessThanOrEqual(geometry.insetClientWidth!);
  expect(geometry.lastPanelRight!).toBeLessThanOrEqual(geometry.columnRight);
});

for (const zoomFactor of [1, 2]) {
  test(`resizes between new chat panels without changing the canvas at ${zoomFactor * 100}% zoom`, async ({
    mount,
  }) => {
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      props: {
        scenario: 'create-agent',
        canvasWidth: 1200,
        persistedCanvasWidth: null,
        zoomFactor,
      },
    });
    await component.getByTestId('create-agent-panel').evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await expectStableCanvasWidth(component);
    const canvasWidth = (await measureGeometry(component)).canvasOffsetWidth!;
    const before = (await measureGeometry(component)).panelWidths;
    const handle = component.locator('.panel-split-handle').first();
    await handle.evaluate(async (element) => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200 }));
      await new Promise(requestAnimationFrame);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200 }));
    });

    await expect
      .poll(async () => (await measureGeometry(component)).panelWidths[0])
      .toBeGreaterThan(before[0]);
    expect((await measureGeometry(component)).panelWidths[1]).toBeLessThan(before[1]);
    await expectStableCanvasWidth(component, canvasWidth);
  });
}

/**
 * Regression (clipped bottom stacked panel): a root vertical split must size
 * its children against the inset's content-box height (clientHeight minus the
 * vertical padding). Before the fix measurePanelReferenceSize used the padded
 * clientHeight, so the stack overflowed by the inset's vertical padding and
 * the bottom panel was clipped by overflow-y-hidden.
 */
test('keeps the bottom stacked panel inside the inset content box (deck mode)', async ({
  mount,
}) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: { direction: 'vertical', sidebarWidth: 360, canvasWidth: 800 },
  });

  // Wait until the split has measured and applied fixed pixel flex bases —
  // the pre-measurement percentage bases always fit and would mask the bug.
  await expect
    .poll(async () => (await measureGeometry(component)).lastPanelFlex)
    .toMatch(/0 0 .+px/);
  const measurements = await measureGeometry(component);

  expect(measurements.insetBottom).not.toBeNull();
  expect(measurements.lastPanelBottom).not.toBeNull();
  const paddingBottom = Number.parseFloat(measurements.insetPaddingBottom!);
  // The harness must exercise a padded viewport, or the assertion is vacuous.
  expect(paddingBottom).toBeGreaterThan(0);
  // The regression assertion: the bottom panel's bottom edge must stay at the
  // inset content-box bottom — the same bottom margin a single panel gets.
  expect(measurements.lastPanelBottom!).toBeLessThanOrEqual(
    measurements.insetBottom! - paddingBottom,
  );
});

/**
 * Same regression in the uncontained (tab view) inset, whose vertical padding
 * differs (`py-2 sm:py-3`): the bottom stacked panel must stay inside the
 * inset content box.
 */
test('keeps the bottom stacked panel inside the inset content box (tab view)', async ({
  mount,
}) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      mode: 'uncontained',
      direction: 'vertical',
      sidebarWidth: 360,
      canvasWidth: 800,
      insetChrome: 0,
    },
  });

  await expect
    .poll(async () => (await measureGeometry(component)).lastPanelFlex)
    .toMatch(/0 0 .+px/);
  const measurements = await measureGeometry(component);

  expect(measurements.insetBottom).not.toBeNull();
  expect(measurements.lastPanelBottom).not.toBeNull();
  const paddingBottom = Number.parseFloat(measurements.insetPaddingBottom!);
  expect(paddingBottom).toBeGreaterThan(0);
  expect(measurements.lastPanelBottom!).toBeLessThanOrEqual(
    measurements.insetBottom! - paddingBottom,
  );
});
