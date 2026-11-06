import { expect, test } from '../../../../test/ct-test';
import ScreenshotSidebarHarness from './__fixtures__/ScreenshotSidebarHarness.svelte';

test('sidebar empty state keeps crop and bottom actions reachable', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  const fixture = await mount(ScreenshotSidebarHarness);
  await expect(fixture.getByRole('listbox', { name: 'Annotations' })).toBeAttached();
  await expect(fixture.getByRole('option')).toHaveCount(0);
  await expect(
    fixture.getByText('Add a mark to leave a note. Blur regions are not numbered.'),
  ).toBeVisible();
  await expect(fixture.getByRole('button', { name: 'Attach', exact: true })).toBeEnabled();
  await expect(fixture.getByRole('button', { name: 'Crop', exact: true })).toHaveCount(1);
  await expect(fixture.getByRole('button', { name: 'Retake', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('sidebar-empty.png') });
});

test('sidebar selection and deletion preserve scrolling and anchored actions at wide and narrow sizes', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  const fixture = await mount(ScreenshotSidebarHarness, { props: { count: 30 } });
  await expect(fixture.locator('.rail-heading')).toHaveText('Annotations');
  await expect(
    fixture.locator('aside').getByRole('button', { name: 'Delete selected mark', exact: true }),
  ).toHaveCount(0);
  const options = fixture.getByRole('option');
  await expect(options).toHaveCount(30);
  await options.first().click();
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toBeFocused();
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Backspace');
  await expect(options).toHaveCount(29);
  await expect(fixture.getByRole('button', { name: 'Attach', exact: true })).toBeEnabled();
  await options.first().click();
  await page.screenshot({ path: info.outputPath('sidebar-selection-wide.png') });
  for (const width of [620, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await fixture.locator('.sidebar-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const footer = fixture.locator('.sidebar-footer');
    const bounds = await footer.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
    await expect(fixture.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await expect(
      fixture.getByRole('button', { name: 'Attach', exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`sidebar-narrow-${width}.png`) });
  }
  await fixture.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(fixture).toHaveAttribute('data-saved', 'true');
});
