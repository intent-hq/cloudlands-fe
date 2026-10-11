import { test, expect, openExample, outputJson } from '../lib/functional.mjs';

// Optional native dismissal and callback edges; no daemon or persistence claims.
const output = (example, name) => example.getByLabel(name, { exact: true });
const openDialogs = (page) => openExample(page, 'modals', 'callback-dialogs');

for (const dismissal of ['close button', 'backdrop']) {
  test(`callback dialog: Input ${dismissal} clears the draft without confirmation`, async ({
    page,
  }) => {
    const example = await openDialogs(page);
    const trigger = example.getByRole('button', { name: 'Open input dialog', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Rename workspace', exact: true });
    const input = dialog.getByRole('textbox', { name: 'Workspace name', exact: true });
    await input.fill('Abandoned draft');
    if (dismissal === 'close button') {
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    } else {
      await page.mouse.click(2, 2);
    }
    await expect(dialog).toHaveCount(0);
    await expect(output(example, 'Input cancel callbacks')).toHaveText('1');
    await expect.poll(() => outputJson(output(example, 'Input callback values'))).toEqual([]);
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
  });
}

test('callback dialog: Message rejects backdrop dismissal and Close selects cancel exactly once', async ({
  page,
}) => {
  const example = await openDialogs(page);
  const trigger = example.getByRole('button', { name: 'Open message dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('alertdialog', { name: 'Workspace moved', exact: true });
  await expect(dialog).toBeFocused();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await expect.poll(() => outputJson(output(example, 'Message selected indices'))).toEqual([]);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => outputJson(output(example, 'Message selected indices'))).toEqual([1]);
  await expect(trigger).toBeFocused();
});

test('callback dialog: Message native form submission selects the last index', async ({ page }) => {
  const example = await openDialogs(page);
  await example.getByRole('button', { name: 'Open message dialog', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Workspace moved', exact: true });
  // The source FormDialog onSubmit contract is independent of button labels and
  // of the initial content focus target, which sits outside the nested form.
  await dialog.locator('form').evaluate((form) => form.requestSubmit());
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => outputJson(output(example, 'Message selected indices'))).toEqual([2]);
});

test('callback dialog: Bulk callback rejection retains the dialog and permits one retry', async ({
  page,
}) => {
  const example = await openDialogs(page);
  await example.getByRole('switch', { name: 'Bulk preflight ready', exact: true }).click();
  const trigger = example.getByRole('button', { name: 'Open bulk dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Archive selected workspaces?', exact: true });
  const confirm = dialog.getByRole('button', { name: 'Archive workspaces', exact: true });
  await confirm.click();
  await expect(output(example, 'Bulk callback status')).toHaveText('pending');
  expect(await page.evaluate(() => window.__INTENT_CALLBACK_DIALOGS__.rejectBulk())).toBe(true);
  await expect(output(example, 'Bulk callback status')).toHaveText('rejected');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(confirm).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await expect(output(example, 'Bulk cancel callbacks')).toHaveText('0');
  await confirm.click();
  await expect(output(example, 'Bulk callback status')).toHaveText('pending');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(output(example, 'Bulk callback attempts')).toHaveText('2');
  expect(await page.evaluate(() => window.__INTENT_CALLBACK_DIALOGS__.resolveBulk())).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(output(example, 'Bulk callback status')).toHaveText('resolved');
  await expect(trigger).toBeFocused();
});

for (const dismissal of ['close button', 'backdrop']) {
  test(`callback dialog: Harness ${dismissal} restores its trigger`, async ({ page }) => {
    const example = await openDialogs(page);
    const trigger = example.getByRole('button', { name: 'Open harness features', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Harness vcallback exercise', exact: true });
    await expect(dialog).toBeVisible();
    if (dismissal === 'close button') {
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    } else {
      await page.mouse.click(2, 2);
    }
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

for (const dismissal of ['Escape', 'close button', 'backdrop']) {
  test(`callback dialog: Proposal ${dismissal} cancels without confirmation`, async ({ page }) => {
    const example = await openDialogs(page);
    const trigger = example.getByRole('button', {
      name: 'Open proposal confirmation',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Dismiss proposal?', exact: true });
    await expect(
      dialog.getByRole('button', { name: 'Dismiss proposal', exact: true }),
    ).toBeFocused();
    if (dismissal === 'Escape') {
      await page.keyboard.press('Escape');
    } else if (dismissal === 'close button') {
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    } else {
      await page.mouse.click(2, 2);
    }
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(output(example, 'Proposal cancel callbacks')).toHaveText('1');
    await expect(output(example, 'Proposal confirm callbacks')).toHaveText('0');
    await expect(trigger).toBeFocused();
  });
}
