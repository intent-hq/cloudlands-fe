import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import { expectDismissibleLayerArmed } from '../../../../test/dismissible-layer';
import Harness from './SelectInDialogHarness.svelte';

/** True when the option's centre is painted by the option itself, not clipped or covered. */
async function isHittable(option: Locator) {
  return option.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
}

async function openMode(page: Page) {
  const trigger = page.getByRole('combobox', { name: 'Mode' });
  await trigger.click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(3);
  return { trigger, options };
}

// Regression: a Select that is the last field of a FormDialog body rendered its
// list inline, where the dialog body and root clipped the bottom options (the
// provider profile env editor's Value/Empty/Unset menu).
for (const { name, fillerRem } of [
  { name: 'short body', fillerRem: 0 },
  { name: 'scrolling body', fillerRem: 60 },
]) {
  test(`Select options inside a FormDialog are not clipped (${name})`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 800, height: 600 });
    await mount(Harness, { props: { fillerRem } });
    await page.getByRole('combobox', { name: 'Mode' }).scrollIntoViewIfNeeded();

    const { options } = await openMode(page);
    for (const option of await options.all()) {
      await expect.poll(() => isHittable(option)).toBe(true);
    }

    await page.getByRole('option', { name: 'Unset' }).click();
    await expect(page.getByTestId('select-in-dialog-value')).toHaveText('unset');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}

for (const portal of [undefined, false]) {
  test(`Escape and outside clicks close a dialog Select without closing the dialog (portal=${portal})`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Harness, { props: { portal } });

    const { trigger } = await openMode(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(trigger).toBeFocused();

    await openMode(page);
    await expectDismissibleLayerArmed(page.locator('[data-slot="select-content"]'));
    await page.getByRole('heading', { name: 'Edit profile' }).click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();

    await trigger.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('a dialog Select hides its list once the trigger scrolls out of the body', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 800, height: 600 });
  await mount(Harness, { props: { trailingRem: 60 } });

  const { options } = await openMode(page);
  await expect(options.first()).toBeVisible();
  await page.locator('[data-slot="dialog-body"]').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(options.first()).toBeHidden();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('portal={false} keeps a dialog Select list inline in the body', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, { props: { portal: false } });

  await openMode(page);
  await expect(page.locator('[data-slot="dialog-body"] [role="listbox"]')).toHaveCount(1);
});

// Regression: an explicit body portal (EffortPicker inside ModelPicker in a
// modal) must stay on the body; re-homing it into a raw Dialog.Content clipped
// it under the dialog overlay (model-picker-overflow modal case).
test('portal={true} keeps a dialog Select list on the document body', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, { props: { portal: true } });

  await openMode(page);
  await expect(page.locator('[role="dialog"] [role="listbox"]')).toHaveCount(0);
  await expect(
    page.locator('body > [data-bits-floating-content-wrapper] [role="listbox"]'),
  ).toHaveCount(1);
});
