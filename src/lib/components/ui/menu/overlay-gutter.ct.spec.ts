import { expect, test } from '../../../../test/ct-test';
import OverlayGutterHarness from './overlay-gutter.test-harness.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<Page['locator']>;

async function expectGutter(surface: Locator, gutter = 8) {
  await expect(surface).toBeVisible();
  await expect
    .poll(() =>
      surface.evaluate((element, inset) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= inset - 0.5 &&
          bounds.top >= inset - 0.5 &&
          bounds.right <= innerWidth - inset + 0.5 &&
          bounds.bottom <= innerHeight - inset + 0.5
        );
      }, gutter),
    )
    .toBe(true);
}

for (const { name, width, ...props } of [
  { name: 'top-left default portal', width: 900, edge: 'left' },
  { name: 'top-right inline flip', width: 900, edge: 'right', portal: false },
  { name: 'bottom-right inline', width: 900, edge: 'right', bottom: true, portal: false },
  { name: 'narrow bottom-right', width: 200, edge: 'right', bottom: true },
] as const) {
  test(`menu and submenu keep viewport gutters at ${name}`, async ({ mount, page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 480 });
    await mount(OverlayGutterHarness, { props });
    const trigger = page.getByRole('button', { name: 'Open menu' });
    await trigger.click();
    const root = page.locator('[data-slot="menu-content"]');
    await expectGutter(root);
    const more = page.getByRole('menuitem', { name: 'More choices' });
    await more.focus();
    await page.keyboard.press('ArrowRight');
    const child = page.getByRole('menuitem', { name: 'Banana', exact: true });
    await expect(child).toBeFocused();
    const submenu = page.locator('[data-slot="menu-sub-content"]');
    await expectGutter(submenu);
    await expectGutter(root);
    if (name === 'top-left default portal' || name === 'top-right inline flip') {
      await expect(submenu).toHaveAttribute('data-side', props.edge === 'left' ? 'right' : 'left');
      await expect
        .poll(async () => {
          const parentBounds = await more.boundingBox();
          const childBounds = await child.boundingBox();
          return Math.abs(parentBounds!.y - childBounds!.y);
        })
        .toBeLessThanOrEqual(1);
      await testInfo.attach('first-row-aligned-submenu', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
    await child.click();
    await expect(page.getByLabel('Selected fruit')).toHaveText('banana');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

for (const kind of ['select', 'combobox', 'popover'] as const) {
  for (const { name, width, ...props } of [
    { name: 'narrow default portal mode', width: 200, edge: 'left' },
    {
      name: 'right edge alternate portal mode',
      width: 900,
      edge: 'right',
      bottom: true,
      portal: kind === 'select',
    },
  ] as const) {
    test(`${kind} keeps viewport gutters at ${name}`, async ({ mount, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 480 });
      await mount(OverlayGutterHarness, { props: { kind, ...props } });
      const trigger =
        kind === 'popover'
          ? page.getByRole('button', { name: 'Open popover' })
          : page.getByRole('combobox', { name: 'Choose fruit' });
      await trigger.click();
      await expectGutter(page.locator('.menu-overlay'));
      await page
        .getByRole(kind === 'popover' ? 'button' : 'option', { name: 'Banana', exact: true })
        .click();
      await expect(page.getByLabel('Selected fruit')).toHaveText('banana');
      await expect(page.locator('.menu-overlay')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}

test('explicit larger collision padding is preserved for menu and submenu', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 480 });
  await mount(OverlayGutterHarness, { props: { edge: 'right', collisionPadding: 24 } });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expectGutter(page.locator('[data-slot="menu-content"]'), 24);
  await page.getByRole('menuitem', { name: 'More choices' }).hover();
  await expectGutter(page.locator('[data-slot="menu-sub-content"]'), 24);
});
