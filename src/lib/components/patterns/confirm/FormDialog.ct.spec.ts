import { expect, test } from '@playwright/experimental-ct-svelte';
import FormDialog from './FormDialog.svelte';

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
  // Bits queues initial autofocus on the first tabbable (Cancel). Let it finish
  // before moving to Save, so it cannot redirect our native Enter activation.
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.focus();
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
