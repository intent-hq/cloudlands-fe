import { expect, test } from '../../../test/ct-test';
import WorkspaceTabRestorationHarness from './WorkspaceTabRestorationHarness.svelte';

// intent-hq/intent#6899: replacing the mounted tab list with a larger restored
// list must not leave the plus button translated over the tabs.
test('keeps the plus button beside the strip after tab restoration at 1200px', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1200, height: 400 });
  const component = await mount(WorkspaceTabRestorationHarness);
  const titleBar = component.locator('.window-title-bar');
  await expect(component.locator('[data-workspace-tab-motion]')).toHaveCount(1);
  await expect(component.locator('[data-workspace-repo-launcher]')).toHaveCount(1);
  // The strip enables lifecycle motion on the frame after mount; wait for the
  // initial tab to settle and for that frame so the restore runs with full motion.
  await expect
    .poll(() =>
      titleBar.evaluate(async (root) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return root.querySelector('[data-workspace-tab-strip]')!.getAnimations({ subtree: true })
          .length;
      }),
    )
    .toBe(0);

  await component.locator('[data-restore-tabs]').click();
  // The outgoing tab unmounts only when its outro ends.
  await expect(component.locator('[data-workspace-tab-motion="geometry-gamma"]')).toHaveCount(0);
  await expect(component.locator('[data-workspace-tab-motion]')).toHaveCount(10);

  await expect(async () => {
    const geometry = await titleBar.evaluate((root) => {
      const strip = root.querySelector<HTMLElement>('[data-workspace-tab-strip]')!;
      const plus = root.querySelector<HTMLElement>('[data-workspace-repo-launcher]')!;
      const controls = root.querySelector<HTMLElement>('[data-titlebar-workspace-controls]')!;
      const tabs = Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-tab-motion]'));
      const stripRect = strip.getBoundingClientRect();
      const plusRect = plus.getBoundingClientRect();
      const hit = document.elementFromPoint(
        plusRect.left + plusRect.width / 2,
        plusRect.top + plusRect.height / 2,
      );
      return {
        runningAnimations: strip.getAnimations({ subtree: true }).length,
        plusIsHitTarget: hit !== null && plus.contains(hit),
        offset: controls.style.getPropertyValue('--workspace-tab-launcher-offset'),
        translate: getComputedStyle(plus).translate,
        stripRight: stripRect.right,
        plusLeft: plusRect.left,
        plusWidth: plusRect.width,
        lastVisibleTabRight: Math.max(
          ...tabs
            .map((tab) => tab.getBoundingClientRect().right)
            .filter((right) => right <= stripRect.right + 1),
        ),
      };
    });
    const details = JSON.stringify(geometry);
    expect(geometry.runningAnimations, details).toBe(0);
    expect(geometry.offset, details).toBe('0px');
    expect(geometry.plusLeft, details).toBeGreaterThanOrEqual(geometry.stripRight - 1);
    expect(geometry.plusLeft, details).toBeGreaterThanOrEqual(geometry.lastVisibleTabRight - 1);
    expect(geometry.plusIsHitTarget, details).toBe(true);
  }).toPass({ timeout: 5_000 });
});
