import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import FlyoutHarness from './FlyoutAlignmentHarness.svelte';
import MenuHarness from './MenuTestHarness.svelte';

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
}

async function expectAlignedRows(parent: Locator, child: Locator) {
  await expect
    .poll(async () => Math.abs((await box(parent)).y - (await box(child)).y))
    .toBeLessThanOrEqual(0.5);
}

for (const portal of [true, false]) {
  test(`flyout aligns first rows with portal=${portal} and returns keyboard focus`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 700 });
    const component = await mount(FlyoutHarness, { props: { portal } });
    await component.getByRole('button', { name: 'Open flyout menu' }).click();
    const parent = page.getByRole('menuitem', { name: 'More actions' });
    await parent.focus();
    await page.keyboard.press('ArrowRight');
    const first = page.getByRole('menuitem', { name: 'First child' });
    await expect(first).toBeFocused();
    await expectAlignedRows(parent, first);
    const submenu = page.locator('[data-slot="menu-sub-content"]');
    const root = page.locator('[data-slot="menu-content"]');
    expect((await box(submenu)).y).toBeGreaterThan((await box(root)).y);
    await testInfo.attach('aligned row geometry', {
      body: JSON.stringify({ parent: await box(parent), first: await box(first) }),
      contentType: 'application/json',
    });
    if (portal) {
      await page.screenshot({ path: testInfo.outputPath('shared-flyout-aligned.png') });
    }
    await page.keyboard.press('ArrowLeft');
    await expect(first).toHaveCount(0);
    await expect(parent).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(component.getByTestId('selected')).toHaveText('First child');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
}

test('flyout keeps first rows aligned when flipped left at the viewport edge', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 600, height: 500 });
  const component = await mount(FlyoutHarness, { props: { x: 420 } });
  await component.getByRole('button', { name: 'Open flyout menu' }).click();
  const parent = page.getByRole('menuitem', { name: 'More actions' });
  await parent.hover();
  const first = page.getByRole('menuitem', { name: 'First child' });
  await expectAlignedRows(parent, first);
  const submenu = await box(page.locator('[data-slot="menu-sub-content"]'));
  expect(submenu.x + submenu.width).toBeLessThanOrEqual((await box(parent)).x);
  expect(submenu.x).toBeGreaterThanOrEqual(8);
  await first.click();
  await expect(component.getByTestId('selected')).toHaveText('First child');
});

test('flyout shifts above the preferred row alignment to keep its last action on screen', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 700, height: 360 });
  const component = await mount(FlyoutHarness, { props: { y: 300 } });
  await component.getByRole('button', { name: 'Open flyout menu' }).click();
  const parent = page.getByRole('menuitem', { name: 'More actions' });
  await parent.hover();
  const last = page.getByRole('menuitem', { name: 'Fourth child' });
  await expect(last).toBeVisible();
  await expect
    .poll(async () => {
      const submenu = await box(page.locator('[data-slot="menu-sub-content"]'));
      return submenu.y + submenu.height;
    })
    .toBeLessThanOrEqual(352);
  expect((await box(page.getByRole('menuitem', { name: 'First child' }))).y).toBeLessThan(
    (await box(parent)).y,
  );
  await last.click();
  await expect(component.getByTestId('selected')).toHaveText('Fourth child');
});

for (const align of ['center', 'start'] as const) {
  test(`flyout honors explicit ${align} alignment${align === 'start' ? ' and offset' : ''}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 700 });
    const component = await mount(FlyoutHarness, {
      props: { y: 200, align, alignOffset: align === 'start' ? 9 : undefined },
    });
    await component.getByRole('button', { name: 'Open flyout menu' }).click();
    const parent = page.getByRole('menuitem', { name: 'More actions' });
    await parent.hover();
    await expect
      .poll(async () => {
        const row = await box(parent);
        const submenu = await box(page.locator('[data-slot="menu-sub-content"]'));
        return align === 'center'
          ? Math.abs(submenu.y + submenu.height / 2 - (row.y + row.height / 2))
          : Math.abs(submenu.y - row.y - 9);
      })
      .toBeLessThanOrEqual(0.5);
  });
}

test('stacked menus inherit first-row alignment', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 700 });
  const component = await mount(MenuHarness, { props: { stacked: true } });
  await component.getByRole('button', { name: 'Open stacked menu' }).click();
  const parent = page.getByRole('menuitem', { name: 'Invite users' });
  await parent.hover();
  const first = page.getByRole('menuitem', { name: 'Email', exact: true });
  await expectAlignedRows(parent, first);
  await first.click();
  await expect(component.getByTestId('selected')).toHaveText('email');
});

for (const kind of ['dropdown', 'sidebar'] as const) {
  test(`legacy ${kind} flyout aligns first rows and dismisses`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 700 });
    const component = await mount(FlyoutHarness, { props: { kind } });
    if (kind === 'dropdown') {
      await component.getByRole('button', { name: 'Open flyout dropdown' }).click();
    }
    const parent = page.getByRole(kind === 'dropdown' ? 'option' : 'menuitem', {
      name: 'More actions',
    });
    await parent.hover();
    const first = page.getByRole('menuitem', { name: 'First child' });
    await expectAlignedRows(parent, first);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-flyout-aligned.png`) });
    if (kind === 'sidebar') {
      await first.click();
      await expect(component.getByTestId('selected')).toHaveText('First child');
    } else {
      // Legacy Dropdown's portaled-child pointer selection: intent-hq/intent#5601.
      await parent.press('Escape');
      await expect(component.getByRole('button', { name: 'Open flyout dropdown' })).toBeFocused();
    }
    await expect(first).toHaveCount(0);
  });
}
