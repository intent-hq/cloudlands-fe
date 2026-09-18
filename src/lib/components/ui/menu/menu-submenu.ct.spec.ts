import { expect, test } from '@playwright/experimental-ct-svelte';
import OverlayCatalogPreview from '$lib/component-catalog/renderers/OverlayCatalogPreview.svelte';
import { menuFixtures } from './menu.fixtures';

// Regression for intent-hq/intent#5126: the Menu playground's nested submenu rendered
// inside the parent menu's scroll container and was clipped, so it never appeared
// even though it was open in the DOM. Only a real browser can observe the clipping.
for (const via of ['pointer', 'keyboard'] as const) {
  test(`catalog nested submenu is reachable when opened via ${via}`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 700 });
    const component = await mount(OverlayCatalogPreview, {
      props: { componentId: 'menu', fixture: menuFixtures[0] },
    });
    await component.getByRole('button', { name: 'Open catalog menu' }).click();
    const more = page.getByRole('menuitem', { name: 'More actions' });
    await expect(more).toBeVisible();
    if (via === 'pointer') {
      await more.hover();
    } else {
      await more.focus();
      await page.keyboard.press('ArrowRight');
    }
    const archive = page.getByRole('menuitem', { name: 'Archive' });
    await expect(archive).toBeVisible();
    // Visible-in-DOM is not enough: the item must win hit-testing at its own center,
    // which fails when an ancestor's overflow clips the submenu.
    await expect
      .poll(() =>
        archive.evaluate((item) => {
          const rect = item.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return !!hit && item.contains(hit);
        }),
      )
      .toBe(true);
    await archive.click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
}
