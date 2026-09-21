import { expect, test } from '../../../../test/ct-test';
import type { Page } from '@playwright/test';
import ResizablePanel from '../ResizablePanel.svelte';
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

test('short resize indicator follows pointer and keyboard interaction without a Button surface', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const commits: [number, number][] = [];
  const component = await mount(ResizablePanel, {
    props: {
      orientation: 'horizontal',
      side: 'left',
      showHandleIndicator: true,
      storageKey: null,
      defaultWidth: 300,
      minWidth: 200,
      maxWidth: 500,
      className: 'h-80',
      onResizeEnd: (start: number, final: number) => commits.push([start, final]),
    },
  });
  const handle = component.getByRole('button', { name: /^Resize panel/ });
  const opacity = () =>
    handle.evaluate((node) => Number(getComputedStyle(node, '::before').opacity));
  const width = () => component.evaluate((node) => node.getBoundingClientRect().width);
  const paintedRectangles = () =>
    handle.evaluate(
      (node) =>
        [node, ...node.querySelectorAll('*')].filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (
            rect.width === 0 ||
            rect.height === 0 ||
            style.visibility !== 'visible' ||
            Number(style.opacity) === 0
          )
            return false;
          return (
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
            style.backgroundImage !== 'none' ||
            style.boxShadow !== 'none'
          );
        }).length,
    );
  const expectLineOnly = async () => expect(await paintedRectangles()).toBe(0);

  await page.mouse.move(950, 550);
  await expect.poll(opacity).toBe(0);
  await expectLineOnly();
  const before = await width();
  const box = (await handle.boundingBox())!;
  const line = await handle.evaluate((node) => {
    const style = getComputedStyle(node, '::before');
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  });
  expect(box.width).toBe(16);
  expect(line).toEqual({ width: 2, height: 40 });
  expect(line.height).toBeLessThan(box.height);

  // Use the unclipped trailing half; the leading half belongs to the scrollbar.
  const x = box.x + box.width - 4;
  const y = box.y + box.height / 2;
  expect(
    await handle.evaluate((node, point) => document.elementFromPoint(point.x, point.y) === node, {
      x,
      y,
    }),
  ).toBe(true);
  await page.mouse.move(x, y);
  await expect.poll(opacity).toBe(1);
  await expectLineOnly();
  await page.mouse.move(950, 550);
  await expect.poll(opacity).toBe(0);

  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(handle).toHaveAttribute('data-resizing', 'true');
  await expect(page.locator('body')).toHaveClass(/panel-resizing/);
  await expectLineOnly();
  const outside = { x: x + 40, y: box.y + box.height + 48 };
  await page.mouse.move(outside.x, outside.y);
  await expect.poll(width).toBeCloseTo(before + 40, 1);
  expect(
    await handle.evaluate(
      (node, point) => document.elementFromPoint(point.x, point.y) === node,
      outside,
    ),
  ).toBe(false);
  expect(await handle.evaluate((node) => node.matches(':hover'))).toBe(false);
  await expect.poll(opacity).toBe(1);
  await expectLineOnly();
  expect(commits).toEqual([]);
  await page.mouse.up();
  await expect(handle).toHaveAttribute('data-resizing', 'false');
  await expect(page.locator('body')).not.toHaveClass(/panel-resizing/);
  await expect.poll(() => commits).toEqual([[before, before + 40]]);
  await expect.poll(opacity).toBe(0);
  await expectLineOnly();

  // The pointer press focused the real Button; leave and return using Tab only.
  await expect(handle).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(handle).not.toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(handle).toBeFocused();
  expect(await handle.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
  await expect.poll(opacity).toBe(1);
  await expectLineOnly();
  const beforeKeyboard = await width();
  await page.keyboard.press('ArrowRight');
  await expect.poll(width).toBeCloseTo(beforeKeyboard + 10, 1);
  await page.keyboard.press('Tab');
  await expect(handle).not.toBeFocused();
  await expect.poll(opacity).toBe(0);
  await expectLineOnly();
  expect(await width()).toBeCloseTo(beforeKeyboard + 10, 1);
  expect(
    await page
      .locator('body')
      .evaluate((node) => ({ cursor: node.style.cursor, userSelect: node.style.userSelect })),
  ).toEqual({ cursor: '', userSelect: '' });
});
