import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import ResizablePanelHandleHitAreaHarness from './mocks/ResizablePanelHandleHitAreaHarness.svelte';

/**
 * Behavioral hit-testing contract for the ResizablePanel edge handle (see the
 * clip-path note in ResizablePanel.svelte and the sibling fix in
 * PanelSplitHandle.svelte): the 16px target is centered on the panel boundary,
 * so its leading (left/top) 8px half overlays the edge where an adjacent
 * scroll container's native 8px scrollbar lives. That half is clipped out of
 * hit-testing so scrollbar clicks land on the scrollbar; the trailing half
 * keeps resolving to the handle.
 */

type Probe = { size: number; leading: string; trailing: string };

function probeHandle(page: Page, axis: 'x' | 'y'): Promise<Probe> {
  return page.evaluate((probeAxis) => {
    const handle = document.querySelector<HTMLElement>('.app-resize-handle')!;
    const rect = handle.getBoundingClientRect();
    const classify = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return 'none';
      if (hit === handle) return 'handle';
      const testId = (hit as HTMLElement).closest<HTMLElement>('[data-testid]')?.dataset.testid;
      return testId ?? 'other';
    };
    if (probeAxis === 'x') {
      const midY = rect.top + rect.height / 2;
      return {
        size: rect.width,
        leading: classify(rect.left + 4, midY),
        trailing: classify(rect.right - 4, midY),
      };
    }
    const midX = rect.left + rect.width / 2;
    return {
      size: rect.height,
      leading: classify(midX, rect.top + 4),
      trailing: classify(midX, rect.bottom - 4),
    };
  }, axis);
}

test('left-side panel handle yields its leading half to the panel scrollbar', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  const component = await mount(ResizablePanelHandleHitAreaHarness, {
    props: { variant: 'sidebar-left' },
  });
  await expect(component.locator('.app-resize-handle')).toBeVisible();

  const probe = await probeHandle(page, 'x');
  expect(probe.size).toBe(16);
  // Leading 8px sits over the panel's own right edge, where its vertical
  // scrollbar renders — clicks there must reach the scroll container.
  expect(probe.leading).toBe('panel-scroll');
  expect(probe.trailing).toBe('handle');
});

test('right-side panel handle yields its leading half to the neighbor scrollbar', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  const component = await mount(ResizablePanelHandleHitAreaHarness, {
    props: { variant: 'sidebar-right' },
  });
  await expect(component.locator('.app-resize-handle')).toBeVisible();

  const probe = await probeHandle(page, 'x');
  expect(probe.size).toBe(16);
  // Leading 8px sits over the left neighbor's right edge, where its vertical
  // scrollbar renders — clicks there must reach the neighbor.
  expect(probe.leading).toBe('neighbor-scroll');
  expect(probe.trailing).toBe('handle');
});

test('top-edge vertical handle yields its leading half to the upper neighbor scrollbar', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  const component = await mount(ResizablePanelHandleHitAreaHarness, {
    props: { variant: 'stack-top' },
  });
  await expect(component.locator('.app-resize-handle')).toBeVisible();

  const probe = await probeHandle(page, 'y');
  expect(probe.size).toBe(16);
  // Leading 8px sits over the upper neighbor's bottom edge, where its
  // horizontal scrollbar renders — clicks there must reach that neighbor.
  expect(probe.leading).toBe('neighbor-scroll');
  expect(probe.trailing).toBe('handle');
});
