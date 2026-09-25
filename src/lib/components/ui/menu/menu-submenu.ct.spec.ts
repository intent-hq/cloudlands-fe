import { expect, test } from '../../../../test/ct-test';
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

type CtFixtures = Parameters<Parameters<typeof test>[1]>[0];

async function openNestedSubmenu(mount: CtFixtures['mount'], page: CtFixtures['page']) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 700 });
  const component = await mount(OverlayCatalogPreview, {
    props: { componentId: 'menu', fixture: menuFixtures[0] },
  });
  const trigger = component.getByRole('button', { name: 'Open catalog menu' });
  await trigger.click();
  const more = page.getByRole('menuitem', { name: 'More actions' });
  await more.focus();
  await page.keyboard.press('ArrowRight');
  const archive = page.getByRole('menuitem', { name: 'Archive' });
  await expect(archive).toBeFocused();
  return { trigger, more, archive };
}

test('catalog nested submenu closes by keyboard layer by layer and returns focus', async ({
  mount,
  page,
}) => {
  const { trigger, more, archive } = await openNestedSubmenu(mount, page);

  // ArrowLeft closes only the submenu; the parent stays open with its sub-trigger focused.
  await page.keyboard.press('ArrowLeft');
  await expect(archive).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(1);

  // Escape closes the innermost layer before its parent.
  await page.keyboard.press('ArrowRight');
  await expect(archive).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(archive).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('catalog nested submenu dismisses every layer on an outside pointer', async ({
  mount,
  page,
}) => {
  await openNestedSubmenu(mount, page);
  await page.mouse.click(880, 680);
  await expect(page.getByRole('menu')).toHaveCount(0);
});
