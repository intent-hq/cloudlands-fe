import { expect, test } from '../../../../../test/ct-test';
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
  test(`divider stays hidden at rest, reveals on hover, and accepts focus in ${theme}`, async ({
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
    // The shared resize contract keeps the indicator hidden at rest; the short
    // indicator only changes its length, never its idle visibility.
    const idleOpacity = await opacity();
    expect(idleOpacity).toBe(0);
    await handle.hover();
    await expect.poll(opacity).toBe(1);
    await page.mouse.move(0, 0);
    await handle.focus();
    await expect(handle).toBeFocused();
  });
}

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
  // The top and left 4px bands (over the top-left neighbor's scrollbars) are
  // hit-transparent; the rest of the 16px target still resolves to the handle.
  expect(probe.topBand).toBe('not-handle');
  expect(probe.leftBand).toBe('not-handle');
  expect(probe.center).toBe('handle');
  expect(probe.bottomRight).toBe('handle');
});
