import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import FlyoutHarness from './FlyoutAlignmentHarness.svelte';
import MenuHarness from './MenuTestHarness.svelte';

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
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
    await expect(first).toBeVisible();
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
  await expect(first).toBeVisible();
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
    .toBeLessThanOrEqual(page.viewportSize()!.height);
  expect((await box(page.getByRole('menuitem', { name: 'First child' }))).y).toBeLessThan(
    (await box(parent)).y,
  );
  await last.click();
  await expect(component.getByTestId('selected')).toHaveText('Fourth child');
});

test('stacked menus inherit first-row alignment', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 700 });
  const component = await mount(MenuHarness, { props: { stacked: true } });
  await component.getByRole('button', { name: 'Open stacked menu' }).click();
  const parent = page.getByRole('menuitem', { name: 'Invite users' });
  await parent.hover();
  const first = page.getByRole('menuitem', { name: 'Email', exact: true });
  await expect(first).toBeVisible();
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
    await expect(first).toBeVisible();
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
