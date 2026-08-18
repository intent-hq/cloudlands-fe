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
      panelWidths: panels.map((p) => p.getBoundingClientRect().width),
    };
  });
}

async function stableCanvasWidths(component: Locator) {
  return component.evaluate(async () => {
    const sample = () =>
      (document.querySelector('.panel-canvas-resize-handle')?.parentElement as HTMLElement | null)
        ?.offsetWidth ?? null;
    const widths = [sample()];
    await new Promise(requestAnimationFrame);
    widths.push(sample());
    await new Promise(requestAnimationFrame);
    widths.push(sample());
    return widths;
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
    props: { sidebarWidth: 360, canvasWidth: 800 },
  });

  const measurements = await measureGeometry(component);

  expect(measurements.canvasRight).not.toBeNull();
  expect(measurements.lastPanelRight).not.toBeNull();
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

  expect(measurements.canvasRight).not.toBeNull();
  expect(measurements.lastPanelRight).not.toBeNull();
  // No horizontal overflow: the automatic canvas fills exactly the inset's
  // usable content width.
  expect(measurements.insetScrollWidth!).toBeLessThanOrEqual(measurements.insetClientWidth!);
  expect(measurements.canvasRight!).toBeLessThanOrEqual(measurements.columnRight);
  expect(measurements.lastPanelRight!).toBeLessThanOrEqual(measurements.columnRight);
});

for (const zoomFactor of [1, 2]) {
  test(`uses the 700px chat default without a first-frame resize at ${zoomFactor * 100}%`, async ({
    mount,
  }) => {
    for (const scenario of ['reuse-agent', 'restore-agent'] as const) {
      const component = await mount(PanelWorkspaceColumnClipHarness, {
        props: { scenario, canvasWidth: 700, persistedCanvasWidth: null, zoomFactor },
      });

      await expect.poll(async () => (await measureGeometry(component)).canvasOffsetWidth).toBe(700);
      expect(await stableCanvasWidths(component)).toEqual([700, 700, 700]);
      await component.unmount();
    }
  });
}

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
    .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
    .toBeLessThan(700);
  const measurements = await measureGeometry(component);
  expect(measurements.insetScrollWidth).toBeLessThanOrEqual(measurements.insetClientWidth!);
});

test('keeps an explicit restored chat width byte-for-byte', async ({ mount }) => {
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: { scenario: 'restore-agent', canvasWidth: 615, persistedCanvasWidth: 615 },
  });

  await expect.poll(async () => (await measureGeometry(component)).canvasOffsetWidth).toBe(615);
});

test('reflows the workspace column to the retained panel width after close', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      sidebarWidth: 360,
      canvasWidth: 1200,
      persistedCanvasWidth: 1200,
      followPersistedCanvas: true,
    },
  });

  expect((await measureGeometry(component)).panelWidths).toEqual([596, 596]);
  await component
    .getByTestId('close-first-panel')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(component.locator('[data-panel-id]')).toHaveCount(1);
  await expect.poll(async () => (await measureGeometry(component)).canvasOffsetWidth).toBe(596);
  const geometry = await measureGeometry(component);
  expect(geometry.columnWidth).toBe(360 + 596 + 16);
  expect(geometry.panelWidths).toEqual([596]);
  expect(geometry.lastPanelRight!).toBeLessThanOrEqual(geometry.columnRight);
});

for (const zoomFactor of [1, 2]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`crosses the exact two-panel threshold at ${zoomFactor * 100}% in ${theme}`, async ({
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
        .toBe(1008);
      expect((await measureGeometry(component)).panelWidths).toEqual([
        500 * zoomFactor,
        500 * zoomFactor,
      ]);

      await component
        .getByTestId('width-minus-one')
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect.poll(async () => (await measureGeometry(component)).insetScrollWidth).toBe(1020);
      expect((await measureGeometry(component)).panelWidths).toEqual([
        500 * zoomFactor,
        500 * zoomFactor,
      ]);

      await component
        .getByTestId('width-plus-one')
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect
        .poll(async () => (await measureGeometry(component)).canvasOffsetWidth)
        .toBe(1009);
      expect((await measureGeometry(component)).panelWidths).toEqual([
        500.5 * zoomFactor,
        500.5 * zoomFactor,
      ]);
    });
  }
}

test('keeps mixed panel defaults in one ordered overflowing row', async ({ mount }) => {
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
  expect(geometry.panelWidths[0]).toBeGreaterThanOrEqual(400);
  expect(geometry.panelWidths[1]).toBeGreaterThanOrEqual(500);
  expect(geometry.panelWidths[2]).toBeGreaterThanOrEqual(900);
  expect(geometry.insetScrollWidth!).toBeGreaterThan(geometry.insetClientWidth!);
});

test('uses persisted panel ratios as preferences only while they overflow', async ({ mount }) => {
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

  await expect.poll(async () => (await measureGeometry(component)).canvasOffsetWidth).toBe(1208);
  expect((await measureGeometry(component)).panelWidths).toEqual([300, 900]);
});

test('creates the wider chat once without a post-creation resize flash', async ({ mount }) => {
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
  await expect.poll(async () => (await measureGeometry(component)).canvasOffsetWidth).toBe(1208);
  expect(await stableCanvasWidths(component)).toEqual([1208, 1208, 1208]);
  await expect(component.locator('[data-panel-id]')).toHaveCount(2);
});

for (const zoomFactor of [1, 2]) {
  test(`resizes the new chat canvas at ${zoomFactor * 100}% zoom`, async ({ mount }) => {
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
    await expect.poll(async () => (await measureGeometry(component)).canvasOffsetWidth).toBe(1208);
    expect(await stableCanvasWidths(component)).toEqual([1208, 1208, 1208]);
    const handle = component.locator('.panel-canvas-resize-handle');
    await handle.evaluate(async (element) => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200 }));
      await new Promise(requestAnimationFrame);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200 }));
    });

    await expect.poll(async () => (await measureGeometry(component)).canvasOffsetWidth).toBe(1308);
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
