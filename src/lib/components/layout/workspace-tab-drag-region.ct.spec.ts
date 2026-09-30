import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../test/ct-test';
import WorkspaceTabDragRegionHarness from './WorkspaceTabDragRegionHarness.svelte';

async function dragRegionGeometry(titlebar: Locator) {
  return titlebar.evaluate(async (root) => {
    // Mounting precedes font readiness and frame-scheduled tab/sidebar layout.
    // Use the same capture boundary as geometry goldens before measuring once.
    const geometryWindow = window as typeof window & {
      __INTENT_GEOMETRY_CT__: {
        waitForCaptureStability: typeof import('$lib/component-catalog/capture-stability').waitForCaptureStability;
      };
    };
    await geometryWindow.__INTENT_GEOMETRY_CT__.waitForCaptureStability(root as HTMLElement);
    const strip = root.querySelector<HTMLElement>('[data-workspace-tab-strip]')!;
    const fixed = root.querySelector('[data-titlebar-fixed-controls]')!;
    const bounds = strip.getBoundingClientRect();
    const gap = { left: fixed.getBoundingClientRect().right, right: bounds.left };
    const descendants = Array.from(strip.querySelectorAll('*')).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        tab: element
          .closest('[data-workspace-tab-motion]')
          ?.getAttribute('data-workspace-tab-motion'),
        region: getComputedStyle(element).getPropertyValue('-webkit-app-region'),
        left: rect.left,
        right: rect.right,
        overlapsGap:
          rect.width > 0 && rect.height > 0 && rect.left < gap.right && rect.right > gap.left,
      };
    });
    return {
      gap,
      scrollerRegion: getComputedStyle(strip).getPropertyValue('-webkit-app-region'),
      overflow: strip.scrollWidth > strip.clientWidth,
      scrollLeft: strip.scrollLeft,
      hiddenOverGap: descendants.filter((element) => element.overlapsGap),
      // Electron uses unclipped rectangles; browser pointer hit testing alone
      // would miss inherited no-drag on the invisible motion/visual wrappers.
      leakingNoDrag: descendants.filter(
        (element) => element.overlapsGap && element.region === 'no-drag',
      ),
      descendantRegions: [...new Set(descendants.map((element) => element.region))],
    };
  });
}

test('overflowing tabs leave the empty left titlebar gap draggable after scrolling and resizing', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 720, height: 400 });
  const component = await mount(WorkspaceTabDragRegionHarness);
  const titlebar = component.locator('.window-title-bar');
  const strip = component.locator('[data-workspace-tab-strip]');

  async function expectClippedRegions() {
    await expect.poll(async () => (await dragRegionGeometry(titlebar)).overflow).toBe(true);
    await strip.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const geometry = await dragRegionGeometry(titlebar);
    await testInfo.attach('drag-region-geometry', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    expect(geometry.scrollLeft).toBeGreaterThan(0);
    expect(geometry.gap.right).toBeGreaterThan(geometry.gap.left);
    expect(
      geometry.hiddenOverGap.length,
      'Scrolled-out tabs actually extend across the drag gap',
    ).toBeGreaterThan(0);
    expect(geometry.scrollerRegion, 'Visible tabs stay inside a no-drag container').toBe('no-drag');
    expect(
      geometry.leakingNoDrag,
      'Hidden tab wrappers must not subtract from the drag gap',
    ).toEqual([]);
    expect(
      geometry.descendantRegions,
      'Only the scroller contributes a tab no-drag rectangle',
    ).toEqual(['none']);
    const gapRegion = await titlebar.evaluate((root) => {
      const fixed = root.querySelector('[data-titlebar-fixed-controls]')!.getBoundingClientRect();
      const strip = root.querySelector('[data-workspace-tab-strip]')!.getBoundingClientRect();
      return getComputedStyle(
        document.elementFromPoint((fixed.right + strip.left) / 2, (strip.top + strip.bottom) / 2)!,
      ).getPropertyValue('-webkit-app-region');
    });
    expect(gapRegion).toBe('drag');
  }

  await expectClippedRegions();
  await strip.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await expect.poll(async () => (await dragRegionGeometry(titlebar)).scrollLeft).toBe(0);
  await expectClippedRegions();
  await page.setViewportSize({ width: 660, height: 400 });
  await expectClippedRegions();
  const gapBeforeSidebarResize = (await dragRegionGeometry(titlebar)).gap;
  await component.update({ props: { sidebarWidth: 340 } });
  // Store selectors publish on a frame cadence even with reduced motion.
  // Wait for the rendered resize before checking the resized drag regions.
  await expect
    .poll(async () => (await dragRegionGeometry(titlebar)).gap.right)
    .toBeGreaterThan(gapBeforeSidebarResize.right);
  await expectClippedRegions();
  await expect(component.locator('[data-titlebar-settings]')).toHaveCSS(
    '-webkit-app-region',
    'no-drag',
  );
  await component.locator('[data-titlebar-settings]').click({ trial: true });
  await component
    .locator('[data-workspace-tab="geometry-gamma"] [data-workspace-tab-close]')
    .click();
  await expect(component.locator('[data-workspace-tab="geometry-gamma"]')).toHaveCount(0);
});

test('non-overflowing tabs keep their controls inside the bounded no-drag region', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1200, height: 400 });
  const component = await mount(WorkspaceTabDragRegionHarness);
  const geometry = await dragRegionGeometry(component.locator('.window-title-bar'));
  expect(geometry.overflow).toBe(false);
  expect(geometry.scrollerRegion).toBe('no-drag');
  expect(geometry.descendantRegions).toEqual(['none']);
  const first = component.locator('[data-workspace-tab="geometry-alpha"] [role="tab"]');
  await first.click();
  await expect(component.locator('[data-selected-workspace]')).toHaveText('geometry-alpha');
  const source = (await first.boundingBox())!;
  const target = (await component.locator('[data-workspace-tab="geometry-beta"]').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 10, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      component
        .locator('[data-workspace-tab-motion]')
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-workspace-tab-motion'))),
    )
    .toEqual(['geometry-beta', 'geometry-alpha', 'geometry-gamma']);
  await component
    .locator('[data-workspace-tab="geometry-alpha"] [data-workspace-tab-close]')
    .click();
  await expect(component.locator('[data-workspace-tab="geometry-alpha"]')).toHaveCount(0);
});

for (const admittedOwner of [false, true]) {
  test(`tab overflow stays stable across frames and resizes ${admittedOwner ? 'with' : 'without'} the launcher`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1200, height: 400 });
    const component = await mount(WorkspaceTabDragRegionHarness, { props: { admittedOwner } });
    const titlebar = component.locator('.window-title-bar');
    const launcher = component.locator('[data-workspace-repo-launcher] button');
    await expect(launcher).toHaveCount(admittedOwner ? 1 : 0);

    for (const [stage, width, overflow] of [
      ['wide', 1200, false],
      ['narrow', 720, true],
      ['wide-again', 1200, false],
    ] as const) {
      await page.setViewportSize({ width, height: 400 });
      await dragRegionGeometry(titlebar);
      // A single sample (even after capture readiness) can catch only the fitting
      // half of an overflow/ResizeObserver cycle. Every following frame must agree.
      const frames = await titlebar.evaluate(async (root) => {
        const strip = root.querySelector<HTMLElement>('[data-workspace-tab-strip]')!;
        const launcher = root.querySelector<HTMLElement>('[data-workspace-repo-launcher]');
        const frames = [];
        for (let index = 0; index < 24; index += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const bounds = strip.getBoundingClientRect();
          frames.push({
            overflow: strip.scrollWidth > strip.clientWidth,
            width: bounds.width,
            scrollWidth: strip.scrollWidth,
            clientWidth: strip.clientWidth,
            // The trailing padding can overlap the gap; visible tab controls cannot.
            launcherOverlap: launcher
              ? Array.from(strip.querySelectorAll('[data-workspace-tab]')).some((tab) => {
                  const tabBounds = tab.getBoundingClientRect();
                  return (
                    Math.min(tabBounds.right, bounds.right) > launcher.getBoundingClientRect().left
                  );
                })
              : false,
          });
        }
        return frames;
      });
      await testInfo.attach(`${stage}-overflow-frames`, {
        body: JSON.stringify(frames, null, 2),
        contentType: 'application/json',
      });
      expect(
        frames.map((frame) => frame.overflow),
        `${stage}: overflow must not oscillate`,
      ).toEqual(Array(24).fill(overflow));
      const widths = frames.map((frame) => frame.width);
      expect(
        Math.max(...widths) - Math.min(...widths),
        `${stage}: stationary controls must not move`,
      ).toBeLessThanOrEqual(1);
      expect(
        frames.some((frame) => frame.launcherOverlap),
        `${stage}: tabs must not cover the launcher`,
      ).toBe(false);
      if (admittedOwner) await launcher.click({ trial: true });
      await component.locator('[data-titlebar-settings]').click({ trial: true });
    }
    await testInfo.attach('stable-titlebar', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
