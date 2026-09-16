import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import PanelCornerHandle from '../PanelCornerHandle.svelte';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';

/**
 * Behavioral hit-testing contract for the resize-handle clip (see
 * PanelSplitHandle.svelte): the 16px target overhangs the 8px gutter by 4px on
 * each side, and the leading overhang is clipped out of hit-testing so clicks
 * there reach the previous panel (where its native scrollbar lives). The
 * gutter itself and the trailing overhang keep resolving to the handle.
 */

type HitProbe = {
  handleSize: number;
  wrapperSize: number;
  crossSize: number;
  wrapperCrossSize: number;
  crossHits: boolean[];
  leading: string;
  gutterCenter: string;
  trailing: string;
};

function probeSplitHandle(page: Page, axis: 'x' | 'y'): Promise<HitProbe> {
  return page.evaluate((probeAxis) => {
    const handle = document.querySelector<HTMLElement>('.panel-split-handle')!;
    const wrapper = handle.closest('.panel-split-handle-wrapper')!;
    const rect = handle.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const classify = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return 'none';
      if (hit === handle) return 'handle';
      const panels = Array.from(document.querySelectorAll('.panel-split-child'));
      const index = panels.findIndex((panel) => panel === hit || panel.contains(hit));
      return index >= 0 ? `panel-${index}` : 'other';
    };
    if (probeAxis === 'x') {
      const midY = rect.top + rect.height / 2;
      return {
        handleSize: rect.width,
        wrapperSize: wrapperRect.width,
        crossSize: rect.height,
        wrapperCrossSize: wrapperRect.height,
        crossHits: [0.2, 0.5, 0.8].map(
          (fraction) =>
            classify(
              rect.left + rect.width / 2,
              wrapperRect.top + wrapperRect.height * fraction,
            ) === 'handle',
        ),
        leading: classify(rect.left + 2, midY),
        gutterCenter: classify(rect.left + rect.width / 2, midY),
        trailing: classify(rect.right - 2, midY),
      };
    }
    const midX = rect.left + rect.width / 2;
    return {
      handleSize: rect.height,
      wrapperSize: wrapperRect.height,
      crossSize: rect.width,
      wrapperCrossSize: wrapperRect.width,
      crossHits: [0.2, 0.5, 0.8].map(
        (fraction) =>
          classify(wrapperRect.left + wrapperRect.width * fraction, rect.top + rect.height / 2) ===
          'handle',
      ),
      leading: classify(midX, rect.top + 2),
      gutterCenter: classify(midX, rect.top + rect.height / 2),
      trailing: classify(midX, rect.bottom - 2),
    };
  }, axis);
}

for (const direction of ['horizontal', 'vertical'] as const) {
  test(`${direction} split handle yields its leading strip to the previous panel`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      // Keep the whole canvas visible: a larger persisted width intentionally
      // overflows the column, where elementFromPoint must not hit the handle.
      props: {
        direction,
        sidebarWidth: 120,
        canvasWidth: 600,
        persistedCanvasWidth: 600,
        pristine: true,
      },
    });
    await expect(component.locator('.panel-split-handle')).toBeVisible();

    const probe = await probeSplitHandle(page, direction === 'horizontal' ? 'x' : 'y');
    // Full 16px forgiving target centered in the 8px gutter is preserved.
    expect(probe.handleSize).toBe(16);
    expect(probe.wrapperSize).toBe(8);
    expect(probe.crossSize).toBeCloseTo(probe.wrapperCrossSize, 0);
    expect(probe.crossHits).toEqual([true, true, true]);
    // Leading 4px overhang is hit-transparent: the previous panel receives the
    // click (its native scrollbar lives on that edge).
    expect(probe.leading).toBe('panel-0');
    // The gutter itself and the trailing overhang still belong to the handle.
    expect(probe.gutterCenter).toBe('handle');
    expect(probe.trailing).toBe('handle');
  });
}

for (const theme of ['light', 'dark']) {
  test(`divider is discoverable before hover and strengthens on hover and keyboard focus in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      props: { sidebarWidth: 0, canvasWidth: 600, pristine: true },
    });
    await page.mouse.move(0, 0);
    const handle = component.locator('.panel-split-handle');
    const opacity = () =>
      handle.evaluate((node) => Number(getComputedStyle(node, '::before').opacity));
    const idleOpacity = await opacity();
    expect(idleOpacity).toBeGreaterThan(0);
    expect(idleOpacity).toBeLessThan(1);
    await handle.hover();
    await expect.poll(opacity).toBeGreaterThan(idleOpacity);
    await page.mouse.move(0, 0);
    await handle.focus();
    await expect(handle).toBeFocused();
    const firstPanel = component.locator('.panel-split-child').first();
    const before = (await firstPanel.boundingBox())!;
    await page.keyboard.press('ArrowRight');
    await expect.poll(opacity).toBeGreaterThan(idleOpacity);
    await expect
      .poll(async () => (await firstPanel.boundingBox())!.width)
      .toBeGreaterThan(before.width);
  });
}

for (const nested of [false, true]) {
  test(`dragging away from the top of a ${nested ? 'nested stack' : 'column'} gutter resizes only the split`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      props: {
        nested,
        sidebarWidth: 0,
        canvasWidth: 720,
        persistedCanvasWidth: 720,
        pristine: true,
      },
    });
    const axis = nested ? 'y' : 'x';
    const direction = nested ? 'vertical' : 'horizontal';
    const handle = component.locator(`.panel-split-handle[data-resize-axis="${axis}"]`);
    const panels = component.locator(`.panel-split-container.${direction} > .panel-split-child`);
    const sizes = () =>
      panels.evaluateAll(
        (nodes, axis) =>
          nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return axis === 'x' ? rect.width : rect.height;
          }),
        axis,
      );
    const before = await sizes();
    const canvas = await component.locator('.panel-canvas-frame').boundingBox();
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width * (nested ? 0.75 : 0.5);
    const y = box.y + box.height * (nested ? 0.5 : 0.75);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect(page.locator('body')).toHaveClass(/panel-resizing/);
    await page.mouse.move(x + (nested ? 0 : 40), y + (nested ? 30 : 0), { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('body')).not.toHaveClass(/panel-resizing/);
    await expect.poll(async () => (await sizes())[0]).toBeGreaterThan(before[0]);
    expect((await sizes())[1]).toBeLessThan(before[1]);
    expect(await component.locator('.panel-canvas-frame').boundingBox()).toEqual(canvas);
    await expect(component.locator('.panel-canvas-resize-handle')).toHaveCount(0);
  });
}

test('three-column gutters preserve right-side proportions and leave earlier columns unchanged', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: {
      panelCount: 3,
      sidebarWidth: 0,
      canvasWidth: 720,
      persistedCanvasWidth: 720,
      pristine: true,
    },
  });
  const handles = component.locator('.panel-split-handle');
  const panels = component.locator('.panel-split-container.horizontal > .panel-split-child');
  await expect(handles).toHaveCount(2);
  await expect(panels).toHaveCount(3);
  const widths = () =>
    panels.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
  const before = await widths();
  const canvas = (await component.locator('.panel-canvas-frame').boundingBox())!;
  const box = (await handles.first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height * 0.75, { steps: 4 });
  await page.mouse.up();
  // Root dividers redistribute the opposite delta across every column to
  // their right. Equal right-side columns therefore each absorb half of 30px.
  await expect.poll(async () => (await widths())[0]).toBeCloseTo(before[0] + 30, 0);
  const after = await widths();
  expect(after[1]).toBeCloseTo(before[1] - 15, 0);
  expect(after[2]).toBeCloseTo(before[2] - 15, 0);
  expect(after.reduce((sum, width) => sum + width, 0)).toBeCloseTo(
    before.reduce((sum, width) => sum + width, 0),
    0,
  );
  await handles.last().focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await widths())[1]).toBeCloseTo(after[1] + 20, 0);
  const afterKeyboard = await widths();
  expect(afterKeyboard[0]).toBeCloseTo(after[0], 0);
  expect(afterKeyboard[2]).toBeCloseTo(after[2] - 20, 0);
  const finalCanvas = (await component.locator('.panel-canvas-frame').boundingBox())!;
  expect(finalCanvas.x).toBe(canvas.x);
  expect(finalCanvas.y).toBe(canvas.y);
  expect(finalCanvas.height).toBe(canvas.height);
  // Summed fractional column widths may differ by a browser layout subpixel.
  expect(finalCanvas.width).toBeCloseTo(canvas.width, 1);
  await expect(page.locator('body')).not.toHaveClass(/panel-resizing/);
});

for (const scenario of ['create-agent', 'pair'] as const) {
  test(`the outer edge is not an interactive resize control in ${scenario === 'pair' ? 'two' : 'one'}-panel layouts`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      props: {
        scenario,
        sidebarWidth: 0,
        canvasWidth: 720,
        persistedCanvasWidth: 720,
        pristine: true,
      },
    });
    const canvas = component.locator('.panel-canvas-frame');
    const before = (await canvas.boundingBox())!;
    const x = before.x + before.width + 2;
    const y = before.y + before.height / 2;
    expect(
      await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.app-resize-handle')),
        { x, y },
      ),
    ).toBe(false);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y);
    await page.mouse.up();
    expect(await canvas.boundingBox()).toEqual(before);
    await expect(component.getByTestId('panel-column')).toHaveAttribute(
      'data-persisted-canvas-width',
      '720',
    );
    await expect(
      canvas.locator(':scope > button, :scope > div[style="display: contents;"] > button'),
    ).toHaveCount(0);
  });
}

test('corner handle yields its leading (top/left) bands to the top-left neighbor', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await mount(PanelCornerHandle, { props: { style: 'top: 100px; left: 100px;' } });

  const probe = await page.evaluate(() => {
    const handle = document.querySelector<HTMLElement>('.panel-corner-handle')!;
    const rect = handle.getBoundingClientRect();
    const classify = (x: number, y: number) =>
      document.elementFromPoint(x, y) === handle ? 'handle' : 'not-handle';
    return {
      width: rect.width,
      height: rect.height,
      topBand: classify(rect.left + 10, rect.top + 2),
      leftBand: classify(rect.left + 2, rect.top + 10),
      center: classify(rect.left + 10, rect.top + 10),
      bottomRight: classify(rect.right - 2, rect.bottom - 2),
    };
  });

  expect(probe.width).toBe(16);
  expect(probe.height).toBe(16);
  // The top and left 4px bands (over the top-left neighbor's scrollbars) are
  // hit-transparent; the rest of the 16px target still resolves to the handle.
  expect(probe.topBand).toBe('not-handle');
  expect(probe.leftBand).toBe('not-handle');
  expect(probe.center).toBe('handle');
  expect(probe.bottomRight).toBe('handle');
});
