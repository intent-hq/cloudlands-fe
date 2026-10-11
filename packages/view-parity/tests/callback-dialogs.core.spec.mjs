import { test, expect, openExample, outputJson } from '../lib/functional.mjs';

// These journeys observe production dialog callbacks through their catalog caller.
// They do not establish workspace mutations, proposal persistence, or daemon behavior.
const output = (example, name) => example.getByLabel(name, { exact: true });
const openDialogs = (page) => openExample(page, 'modals', 'callback-dialogs');

test('callback dialog: Input focuses its label, rejects blanks, and confirms trimmed input once', async ({
  page,
}) => {
  const example = await openDialogs(page);
  const trigger = example.getByRole('button', { name: 'Open input dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Rename workspace', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Workspace name', exact: true });
  const confirm = dialog.getByRole('button', { name: 'OK', exact: true });
  await expect(input).toBeFocused();
  await expect(confirm).toBeDisabled();
  await input.fill('   ');
  await input.press('Enter');
  await expect(confirm).toBeDisabled();
  await expect(dialog).toBeVisible();
  await expect.poll(() => outputJson(output(example, 'Input callback values'))).toEqual([]);
  await input.fill('  Browser workspace  ');
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => outputJson(output(example, 'Input callback values')))
    .toEqual(['Browser workspace']);
  await expect(output(example, 'Input cancel callbacks')).toHaveText('0');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
});

test('callback dialog: Input cancellation clears the draft and restores the trigger', async ({
  page,
}) => {
  const example = await openDialogs(page);
  const trigger = example.getByRole('button', { name: 'Open input dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Rename workspace', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Workspace name', exact: true });
  await input.fill('Discard this draft');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(output(example, 'Input cancel callbacks')).toHaveText('1');
  await expect.poll(() => outputJson(output(example, 'Input callback values'))).toEqual([]);
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(input).toHaveValue('');
  await input.fill('Cancel with Escape too');
  await input.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(output(example, 'Input cancel callbacks')).toHaveText('2');
  await expect.poll(() => outputJson(output(example, 'Input callback values'))).toEqual([]);
  await expect(trigger).toBeFocused();
});

test('callback dialog: Message exposes its body description and keyboard selects the last index', async ({
  page,
  browser,
}, testInfo) => {
  const example = await openDialogs(page);
  const trigger = example.getByRole('button', { name: 'Open message dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('alertdialog', { name: 'Workspace moved', exact: true });
  await expect(dialog).toBeFocused();
  await testInfo.attach('message-accessibility.txt', {
    body: await dialog.ariaSnapshot(),
    contentType: 'text/plain',
  });
  await testInfo.attach('callback-browser.json', {
    body: JSON.stringify({
      version: browser.version(),
      url: page.url(),
      viewport: page.viewportSize(),
    }),
    contentType: 'application/json',
  });
  await expect(dialog).toHaveAccessibleDescription(
    'The workspace is ready on the selected connection.',
  );
  await testInfo.attach('message-dialog.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  // The dialog initially focuses its content, outside the nested Form. Native
  // keyboard activation belongs to the focused button; do not invent a root shortcut.
  const last = dialog.getByRole('button', { name: 'Continue', exact: true }).nth(2);
  await last.focus();
  await last.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => outputJson(output(example, 'Message selected indices'))).toEqual([2]);
  await expect(trigger).toBeFocused();
});

for (const index of [0, 1]) {
  test(`callback dialog: Message repeated label retains button index ${index}`, async ({
    page,
  }) => {
    const example = await openDialogs(page);
    await example.getByRole('button', { name: 'Open message dialog', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Workspace moved', exact: true });
    await dialog.getByRole('button', { name: 'Continue', exact: true }).nth(index).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => outputJson(output(example, 'Message selected indices')))
      .toEqual([index]);
  });
}

test('callback dialog: Message Escape reports its nonzero cancellation index once', async ({
  page,
}) => {
  const example = await openDialogs(page);
  const trigger = example.getByRole('button', { name: 'Open message dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('alertdialog', { name: 'Workspace moved', exact: true });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => outputJson(output(example, 'Message selected indices'))).toEqual([1]);
  await expect(trigger).toBeFocused();
});

test('callback dialog: Bulk preflight blocks submission while Cancel remains usable', async ({
  page,
}) => {
  const example = await openDialogs(page);
  await expect(
    example.getByRole('switch', { name: 'Bulk preflight ready', exact: true }),
  ).not.toBeChecked();
  const trigger = example.getByRole('button', { name: 'Open bulk dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Archive selected workspaces?', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  await expect(cancel).toBeEnabled();
  await expect(
    dialog.getByRole('button', { name: 'Archive workspaces', exact: true }),
  ).toBeDisabled();
  await dialog.locator('form').evaluate((form) => form.requestSubmit());
  await expect(output(example, 'Bulk callback attempts')).toHaveText('0');
  await cancel.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(output(example, 'Bulk cancel callbacks')).toHaveText('1');
  await expect(trigger).toBeFocused();
});

test('callback dialog: Bulk pending callback prevents duplicate submission and dismissal', async ({
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
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await dialog.locator('form').evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await expect(output(example, 'Bulk callback attempts')).toHaveText('1');
  await expect(output(example, 'Bulk cancel callbacks')).toHaveText('0');
  // Settle the real Promise returned by this caller, not component state or a
  // transport response. The native modal correctly makes background controls inert.
  expect(await page.evaluate(() => window.__INTENT_CALLBACK_DIALOGS__.resolveBulk())).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(output(example, 'Bulk callback status')).toHaveText('resolved');
  await expect(output(example, 'Bulk callback attempts')).toHaveText('1');
  await expect(trigger).toBeFocused();
});

test('callback dialog: Harness Escape dismisses its native portal and restores focus', async ({
  page,
}) => {
  const example = await openDialogs(page);
  const trigger = example.getByRole('button', { name: 'Open harness features', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Harness vcallback exercise', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('callback dialog: Proposal confirmation leaves closure to its caller and Cancel never confirms', async ({
  page,
}, testInfo) => {
  const example = await openDialogs(page);
  const trigger = example.getByRole('button', { name: 'Open proposal confirmation', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Dismiss proposal?', exact: true });
  const confirm = dialog.getByRole('button', { name: 'Dismiss proposal', exact: true });
  await expect(confirm).toBeFocused();
  await testInfo.attach('proposal-accessibility.txt', {
    body: await dialog.ariaSnapshot(),
    contentType: 'text/plain',
  });
  await expect(dialog).toHaveAccessibleDescription(
    'The proposal will be discarded without applying it. This cannot be undone.',
  );
  await testInfo.attach('proposal-dialog.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await confirm.press('Enter');
  await expect(output(example, 'Proposal confirm callbacks')).toHaveText('1');
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  await expect(output(example, 'Proposal cancel callbacks')).toHaveText('1');
  await expect(output(example, 'Proposal confirm callbacks')).toHaveText('1');
  await expect(trigger).toBeFocused();
});
