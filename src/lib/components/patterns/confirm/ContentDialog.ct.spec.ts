import { expect, test } from '../../../../test/ct-test';
import DialogLayoutHarness from './DialogLayoutHarness.svelte';
import PullConflictPreview from '../../modals/pull-conflict-audit.preview.svelte';

test('pull failure keeps its action inset from the bottom edge', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await mount(PullConflictPreview, { props: { state: 'merge' } });
  const dialog = page.getByRole('dialog');
  const action = page.getByRole('button', { name: 'Create Workspace', exact: true });
  await expect(action).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  const actionBox = await action.boundingBox();
  expect(
    dialogBox!.y + dialogBox!.height - actionBox!.y - actionBox!.height,
  ).toBeGreaterThanOrEqual(24);
});

test('long content scrolls without hiding actions at a narrow, short viewport', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await mount(DialogLayoutHarness);
  await page.getByRole('button', { name: 'Open details' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((element) => {
    const body = element.querySelector('[data-slot="dialog-body"]')!;
    const rect = element.getBoundingClientRect();
    return {
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      top: rect.top,
      bottom: rect.bottom,
      bodyScrollable: body.scrollHeight > body.clientHeight,
    };
  });
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(480);
  expect(geometry.bodyScrollable).toBe(true);
  for (const label of await dialog
    .locator('[data-slot="dialog-footer"] [data-slot="button-label"]')
    .all()) {
    const overflow = await label.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Decide later' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open details' })).toBeFocused();
});

test('busy content blocks Escape and outside dismissal then restores dismissal', async ({
  mount,
  page,
}) => {
  const component = await mount(DialogLayoutHarness, { props: { busy: true } });
  await page.getByRole('button', { name: 'Open details' }).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1, 1);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decide later' })).toBeDisabled();
  await component.update({ props: { busy: false } });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
