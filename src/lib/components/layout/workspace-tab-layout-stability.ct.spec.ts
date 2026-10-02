import { expect, test } from '../../../test/ct-test';
import WorkspaceTabDragRegionHarness from './WorkspaceTabDragRegionHarness.svelte';

for (const admittedOwner of [false, true]) {
  for (const width of [720, 1200]) {
    test(`tab geometry stays stable at ${width}px with ${admittedOwner ? 'an admitted owner' : 'no admitted caller'}`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 400 });
      const component = await mount(WorkspaceTabDragRegionHarness, { props: { admittedOwner } });
      await expect(component.locator('[data-workspace-tab-motion]')).toHaveCount(3);
      await expect(component.locator('[data-workspace-repo-launcher]')).toHaveCount(
        admittedOwner ? 1 : 0,
      );
      const samples = await component.locator('.window-title-bar').evaluate(async (root) => {
        const geometryWindow = window as typeof window & {
          __INTENT_GEOMETRY_CT__: {
            waitForCaptureStability: typeof import('$lib/component-catalog/capture-stability').waitForCaptureStability;
          };
        };
        await geometryWindow.__INTENT_GEOMETRY_CT__.waitForCaptureStability(root as HTMLElement);
        const strip = root.querySelector<HTMLElement>('[data-workspace-tab-strip]')!;
        const controls = root.querySelector<HTMLElement>('[data-titlebar-workspace-controls]')!;
        const samples = [];
        // Observe the invariant across frames: an eventual non-overflow reading
        // misses the ResizeObserver/margin feedback that alternated every frame.
        for (let frame = 0; frame < 60; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          samples.push({
            scrollWidth: strip.scrollWidth,
            clientWidth: strip.clientWidth,
            controlsWidth: controls.getBoundingClientRect().width,
            stripLeft: strip.getBoundingClientRect().left,
          });
        }
        return samples;
      });
      await testInfo.attach('tab-layout-frames', {
        body: JSON.stringify(samples),
        contentType: 'application/json',
      });
      await testInfo.attach('titlebar', {
        body: await component.screenshot(),
        contentType: 'image/png',
      });
      expect(samples.map(({ scrollWidth, clientWidth }) => scrollWidth > clientWidth)).toEqual(
        Array(60).fill(width === 720),
      );
      expect(new Set(samples.map(({ clientWidth }) => clientWidth)).size).toBe(1);
      expect(new Set(samples.map(({ controlsWidth }) => controlsWidth)).size).toBe(1);
      expect(new Set(samples.map(({ stripLeft }) => stripLeft)).size).toBe(1);
    });
  }
}
