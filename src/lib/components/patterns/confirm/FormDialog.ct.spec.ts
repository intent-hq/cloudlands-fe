import { expect, test } from '../../../../test/ct-test';
import FormDialog from './FormDialog.svelte';
import FormDialogAsyncHarness from './FormDialogAsyncHarness.svelte';
import DestructiveConfirm from './DestructiveConfirm.svelte';

for (const enterKey of ['submit', 'ignore'] as const) {
  test(`Enter activates Cancel without submitting with enterKey=${enterKey}`, async ({
    mount,
    page,
  }) => {
    let submitted = 0;
    let cancelled = 0;
    await mount(FormDialog, {
      props: {
        open: true,
        title: 'Keyboard cancellation',
        cancelLabel: 'Cancel',
        enterKey,
        onSubmit: () => {
          submitted++;
        },
        onCancel: () => {
          cancelled++;
        },
      },
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
    await expect.poll(() => cancelled).toBe(1);
    expect(submitted).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

for (const tag of ['input', 'textarea'] as const) {
  test(`Escape ignore keeps edits in a focused ${tag}`, async ({ mount, page }) => {
    let cancelled = 0;
    const component = await mount(FormDialog, {
      props: {
        open: true,
        title: 'Keep edits',
        escapeKeydownBehavior: 'ignore',
        onSubmit: () => {},
        onCancel: () => {
          cancelled++;
        },
      },
    });
    await page.locator('form fieldset').evaluate((fieldset, tagName) => {
      const editor = document.createElement(tagName);
      editor.setAttribute('aria-label', 'Draft');
      fieldset.prepend(editor);
    }, tag);
    const editor = page.getByRole('textbox', { name: 'Draft' });
    await editor.fill('Unsaved edits');
    await editor.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(editor).toHaveValue('Unsaved edits');
    expect(cancelled).toBe(0);

    await component.update({ props: { escapeKeydownBehavior: 'close' } });
    await editor.press('Escape');
    await expect.poll(() => cancelled).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('ignore preserves native submit-button activation', async ({ mount, page }, testInfo) => {
  let submitted = 0;
  let cancelled = 0;
  await mount(FormDialog, {
    props: {
      open: true,
      title: 'Explicit submit',
      submitLabel: 'Save',
      cancelLabel: 'Cancel',
      enterKey: 'ignore',
      onSubmit: () => {
        submitted++;
      },
      onCancel: () => {
        cancelled++;
      },
    },
  });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  // The primary action receives initial focus even when Enter in fields is ignored.
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => submitted).toBe(1);
  expect(cancelled).toBe(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await testInfo.attach('native-submit-keeps-dialog-open', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('a disabled primary action without an editable field focuses the dialog, not close', async ({
  mount,
  page,
}) => {
  await mount(FormDialog, {
    props: {
      open: true,
      title: 'Unavailable action',
      canSubmit: false,
      focusSubmit: true,
      onSubmit: () => {},
    },
  });
  await expect(page.getByRole('dialog')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
});

for (const enterKey of ['submit', 'ignore'] as const) {
  test(`links retain Enter activation with enterKey=${enterKey}`, async ({ mount, page }) => {
    let submitted = 0;
    await mount(FormDialog, {
      props: {
        open: true,
        title: 'Link activation',
        enterKey,
        onSubmit: () => {
          submitted++;
        },
      },
    });
    await page.locator('form fieldset').evaluate((fieldset) => {
      const link = document.createElement('a');
      link.href = '#help';
      link.textContent = 'Help';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        link.dataset.activated = 'true';
      });
      fieldset.prepend(link);
    });
    const link = page.getByRole('link', { name: 'Help' });
    await link.press('Enter');
    await expect(link).toHaveAttribute('data-activated', 'true');
    expect(submitted).toBe(0);
  });
}

test('pending submission blocks dismissal and permits retry after rejection', async ({
  mount,
  page,
}) => {
  const component = await mount(FormDialogAsyncHarness);
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await expect(save).toBeDisabled();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  // Bits UI debounces outside pointer handling. Keep submission pending until
  // that handler has actually rejected the click, rather than racing its timer.
  await page.evaluate(() => {
    document.addEventListener(
      'pointerdown',
      (event) => {
        (window as Window & { auditOutsidePointer?: PointerEvent }).auditOutsidePointer = event;
      },
      { once: true, capture: true },
    );
  });
  await page.mouse.click(1, 1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { auditOutsidePointer?: PointerEvent }).auditOutsidePointer
            ?.defaultPrevented,
      ),
    )
    .toBe(true);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('cancellation-count')).toHaveText('0');
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await component.update({ props: { rejectPending: true } });
  await expect(save).toBeEnabled();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await save.click();
  await expect(page.getByTestId('submission-count')).toHaveText('2');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('cancellation-count')).toHaveText('1');
  await expect(dialog).toHaveCount(0);
});

test('destructive confirmation keeps preflight cancellable and requires explicit submit focus', async ({
  mount,
  page,
}) => {
  let submitted = 0;
  const component = await mount(DestructiveConfirm, {
    props: {
      open: true,
      title: 'Delete workspaces',
      confirmLabel: 'Delete all',
      focusSubmit: false,
      focusCancel: true,
      canSubmit: false,
      submitBusy: true,
      enterKey: 'ignore',
      modEnter: 'ignore',
      onConfirm: () => {
        submitted++;
      },
    },
  });
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  const confirm = page.getByRole('button', { name: 'Delete all', exact: true });
  await expect(cancel).toBeFocused();
  await expect(cancel).toBeEnabled();
  await expect(confirm).toBeDisabled();
  await component.update({ props: { canSubmit: true, submitBusy: false } });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(submitted).toBe(0);

  await component.update({ props: { open: true } });
  await expect(cancel).toBeFocused();
  await confirm.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => submitted).toBe(1);
});
