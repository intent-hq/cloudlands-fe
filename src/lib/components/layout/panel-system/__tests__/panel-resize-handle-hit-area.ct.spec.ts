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
  leading: string;
  gutterCenter: string;
  trailing: string;
};

function probeSplitHandle(page: Page, axis: 'x' | 'y'): Promise<HitProbe> {
  return page.evaluate((probeAxis) => {
    const handle = document.querySelector<HTMLElement>('.panel-split-handle')!;
    const wrapper = handle.parentElement!;
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
        leading: classify(rect.left + 2, midY),
        gutterCenter: classify(rect.left + rect.width / 2, midY),
        trailing: classify(rect.right - 2, midY),
      };
    }
    const midX = rect.left + rect.width / 2;
    return {
      handleSize: rect.height,
      wrapperSize: wrapperRect.height,
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
      props: { direction, sidebarWidth: 120, canvasWidth: 600, pristine: true },
    });
    await expect(component.locator('.panel-split-handle')).toBeVisible();

    const probe = await probeSplitHandle(page, direction === 'horizontal' ? 'x' : 'y');
    // Full 16px forgiving target centered in the 8px gutter is preserved.
    expect(probe.handleSize).toBe(16);
    expect(probe.wrapperSize).toBe(8);
    // Leading 4px overhang is hit-transparent: the previous panel receives the
    // click (its native scrollbar lives on that edge).
    expect(probe.leading).toBe('panel-0');
    // The gutter itself and the trailing overhang still belong to the handle.
    expect(probe.gutterCenter).toBe('handle');
    expect(probe.trailing).toBe('handle');
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
