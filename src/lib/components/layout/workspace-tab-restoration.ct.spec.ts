import { expect, test } from '../../../test/ct-test';
import WorkspaceTabRestorationHarness from './WorkspaceTabRestorationHarness.svelte';
import { WORKSPACE_TAB_MOTION_DURATION_MS } from './titlebar-geometry';

// intent-hq/intent#6899: replacing the mounted tab list with a larger restored
// list must not leave the plus button translated over the tabs.
test('keeps the plus button beside the strip after tab restoration at 1200px', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1200, height: 400 });
  const component = await mount(WorkspaceTabRestorationHarness);
  await expect(component.locator('[data-workspace-tab-motion]')).toHaveCount(1);
  const launcher = component.locator('[data-workspace-repo-launcher]');
  await expect(launcher).toHaveCount(1);
  await page.waitForTimeout(WORKSPACE_TAB_MOTION_DURATION_MS + 50);

  await component.locator('[data-restore-tabs]').click();
  await expect(component.locator('[data-workspace-tab-motion]')).toHaveCount(10);
  await page.waitForTimeout(WORKSPACE_TAB_MOTION_DURATION_MS * 3 + 200);

  const geometry = await component.locator('.window-title-bar').evaluate((root) => {
    const strip = root.querySelector<HTMLElement>('[data-workspace-tab-strip]')!;
    const plus = root.querySelector<HTMLElement>('[data-workspace-repo-launcher]')!;
    const controls = root.querySelector<HTMLElement>('[data-titlebar-workspace-controls]')!;
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-tab-motion]'));
    const plusRect = plus.getBoundingClientRect();
    const hit = document.elementFromPoint(
      plusRect.left + plusRect.width / 2,
      plusRect.top + plusRect.height / 2,
    );
    return {
      plusIsHitTarget: hit !== null && plus.contains(hit),
      offset: controls.style.getPropertyValue('--workspace-tab-launcher-offset'),
      translate: getComputedStyle(plus).translate,
      stripRight: strip.getBoundingClientRect().right,
      plusLeft: plus.getBoundingClientRect().left,
      plusWidth: plus.getBoundingClientRect().width,
      lastVisibleTabRight: Math.max(
        ...tabs
          .map((tab) => tab.getBoundingClientRect().right)
          .filter((right) => right <= strip.getBoundingClientRect().right + 1),
      ),
    };
  });
  const details = JSON.stringify(geometry);
  expect(geometry.offset, details).toBe('0px');
  expect(geometry.plusLeft, details).toBeGreaterThanOrEqual(geometry.stripRight - 1);
  expect(geometry.plusLeft, details).toBeGreaterThanOrEqual(geometry.lastVisibleTabRight - 1);
  expect(geometry.plusWidth, details).toBeLessThanOrEqual(40);
  expect(geometry.plusIsHitTarget, details).toBe(true);
});
