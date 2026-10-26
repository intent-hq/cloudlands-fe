import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import { expectDismissibleLayerArmed } from '../../../../test/dismissible-layer';
import Harness from './ComboboxInDialogHarness.svelte';

const VARIANTS = [
  'combobox',
  'searchable-select',
  'searchable-combobox',
  'grouped-combobox',
] as const;

/** True when the option's centre is painted by the option itself, not clipped or covered. */
async function isHittable(option: Locator) {
  return option.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
}

async function openPerson(page: Page) {
  const input = page.getByRole('combobox', { name: 'Person' });
  await input.click();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const options = page.getByRole('option');
  await expect(options).toHaveCount(4);
  return { input, options };
}

// Regression: a Combobox near the bottom of a FormDialog either portalled to the
// page body (under the modal layer, outside its focus trap) or rendered inline
// where the dialog body clipped its lower options (cloudlands-fe#3736 for Select).
for (const variant of VARIANTS) {
  for (const { name, fillerRem } of [
    { name: 'short body', fillerRem: 0 },
    { name: 'scrolling body', fillerRem: 60 },
  ]) {
    test(`${variant} options inside a FormDialog are not clipped (${name})`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 800, height: 600 });
      await mount(Harness, { props: { variant, fillerRem } });
      await page.getByRole('combobox', { name: 'Person' }).scrollIntoViewIfNeeded();

      const { options } = await openPerson(page);
      for (const option of await options.all()) {
        await expect.poll(() => isHittable(option)).toBe(true);
      }

      await page.getByRole('option', { name: 'Margaret Hamilton' }).click();
      await expect(page.getByTestId('combobox-in-dialog-value')).toHaveText('margaret');
      await expect(page.getByRole('option')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  }

  test(`Escape and outside clicks close a dialog ${variant} list without closing the dialog`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Harness, { props: { variant } });

    const { input } = await openPerson(page);
    await page.keyboard.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(input).toBeFocused();

    await openPerson(page);
    await expectDismissibleLayerArmed(page.locator('[data-combobox-content]'));
    await page.getByRole('heading', { name: 'Assign reviewer' }).click();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();

    await input.focus();
    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await input.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('a dialog Combobox hides its list once the input scrolls out of the body', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 800, height: 600 });
  await mount(Harness, { props: { trailingRem: 60 } });

  const { options } = await openPerson(page);
  await expect(options.first()).toBeVisible();
  await page.locator('[data-slot="dialog-body"]').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(options.first()).toBeHidden();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a dialog Combobox list is portalled into the dialog', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, {});

  await openPerson(page);
  await expect(
    page.locator('[role="dialog"] > [data-bits-floating-content-wrapper] [role="listbox"]'),
  ).toHaveCount(1);
});

test('portal={false} keeps a dialog Combobox list inline in the body', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, { props: { portal: false } });

  await openPerson(page);
  await expect(page.locator('[data-slot="dialog-body"] [role="listbox"]')).toHaveCount(1);
});

test('portal={true} keeps a dialog Combobox list on the document body', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, { props: { portal: true } });

  await openPerson(page);
  await expect(page.locator('[role="dialog"] [role="listbox"]')).toHaveCount(0);
  await expect(
    page.locator('body > [data-bits-floating-content-wrapper] [role="listbox"]'),
  ).toHaveCount(1);
});

// Outside dialogs nothing changes: Combobox and GroupedCombobox portal to the
// body, SearchableSelect and SearchableCombobox render inline.
for (const { variant, onBody } of [
  { variant: 'combobox', onBody: true },
  { variant: 'grouped-combobox', onBody: true },
  { variant: 'searchable-select', onBody: false },
  { variant: 'searchable-combobox', onBody: false },
] as const) {
  test(`${variant} outside a dialog keeps its ${onBody ? 'body portal' : 'inline list'}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Harness, { props: { variant, inDialog: false } });

    await openPerson(page);
    await expect(page.locator('[data-testid="page-host"] [role="listbox"]')).toHaveCount(
      onBody ? 0 : 1,
    );
    await expect(
      page.locator('body > [data-bits-floating-content-wrapper] [role="listbox"]'),
    ).toHaveCount(onBody ? 1 : 0);
  });
}
