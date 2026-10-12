// DRAFT ONLY. Source images, full motion, script execution and transcript mutations excluded.
import {
  test,
  expect,
  openActions,
  control,
  field,
  copy,
  useScript,
  dialog,
  opener,
  label,
  toggle,
  capture,
  sameNode,
  reachable,
  grantScriptClipboard,
  openDialog,
  expectClosed,
  expectEdit,
} from '../lib/script-actions.mjs';

test('script actions S3: long plain code scrolls inside the card and remount restores reachable controls', async ({
  page,
  context,
}, info) => {
  const item = await openActions(page);
  await grantScriptClipboard(page, context, info);
  const originalNode = await item.card.elementHandle();
  const content =
    Array.from(
      { length: 56 },
      (_, index) => `# line ${index} <tag> ${'plain-code-'.repeat(35)}`,
    ).join('\n') + '\n';
  await field(item.script, 'Script name').fill('Setup');
  await field(item.script, 'Script description').fill('Long script callback context');
  await field(item.script, 'Script content').fill(content);
  await sameNode(item.card, originalNode);
  const code = item.card.locator('pre');
  expect(await code.textContent()).toBe(content);
  await expect(code.locator('*')).toHaveCount(0);
  const before = await reachable(item, item.frame, 'long-code-before', info);
  expect(before.code).toHaveLength(1);
  expect(before.code[0].scrollWidth).toBeGreaterThan(before.code[0].clientWidth);
  expect(before.code[0].scrollHeight).toBeGreaterThan(before.code[0].clientHeight);
  await capture(item, 'long-code-before', info);
  await code.hover();
  await page.mouse.wheel(180, 0);
  await expect.poll(() => code.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.wheel(0, 160);
  await expect.poll(() => code.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await reachable(item, item.frame, 'long-code-scrolled', info);
  await capture(item, 'long-code-scrolled', info);
  await copy(item).click();
  await expect(copy(item, true)).toBeVisible();
  await toggle(item.script, 'Script mounted', false);
  await expect(item.card).toHaveCount(0);
  expect(await originalNode.evaluate((node) => node.isConnected)).toBe(false);
  await control(item.script, 'Remount script').click();
  await expect(copy(item)).toBeVisible();
  expect(await item.card.evaluate((node, old) => node === old, originalNode)).toBe(false);
  expect(await item.card.locator('pre').textContent()).toBe(content);
  await useScript(item).click();
  await expect.poll(async () => (await item.uses()).count).toBe(1);
  expect((await item.uses()).records.at(-1)).toMatchObject({
    argumentCount: 1,
    callbackRevision: 0,
    mountRevision: 1,
    args: [{ name: 'Setup', description: 'Long script callback context', content }],
  });
  const after = await reachable(item, item.frame, 'long-code-remounted', info);
  expect(after.code[0].scrollLeft).toBe(0);
  expect(after.code[0].scrollTop).toBe(0);
  await capture(item, 'long-code-remounted', info);
  await originalNode.dispose();
  // The source leaves reset timers uncancelled: exact timer disposal is not claimed.
});

test('script actions D3: optional props local closure and remount preserve current callback ownership', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await toggle(item.edit, 'Supply open', false);
  await opener(item).click();
  expect((await item.editState()).open).toBe(true);
  await expect(dialog(item)).toHaveCount(0);
  expect((await item.edits()).records).toEqual([]);
  await control(item.edit, 'Reset parent open').click();
  await toggle(item.edit, 'Supply open', true);
  await control(item.edit, 'Replace edit callbacks').click();
  await toggle(item.edit, 'Close parent after callback', false);
  let before = await item.edits();
  let state = await item.editState();
  await openDialog(item);
  await control(dialog(item), label('chat_editRegenerate_confirm_button')).click();
  await expectClosed(item);
  await expectEdit(item, 'onConfirm', before, state);
  expect((await item.editState()).open).toBe(true);
  // Source wrapper closes locally; unchanged parent true alone does not reopen it.
  await opener(item).click();
  await expect(dialog(item)).toHaveCount(0);
  await control(item.edit, 'Reset parent open').click();
  before = await item.edits();
  state = await item.editState();
  await openDialog(item);
  await page.keyboard.press('Escape');
  await expectClosed(item);
  await expectEdit(item, 'onCancel', before, state);
  await control(item.edit, 'Reset parent open').click();
  await toggle(item.edit, 'Supply onConfirm', false);
  await toggle(item.edit, 'Supply onCancel', false);
  const omitted = await item.edits();
  await openDialog(item);
  await capture(item, 'edit-optional-open', info, dialog(item));
  await page.keyboard.press('Enter');
  await expectClosed(item);
  expect(await item.edits()).toEqual(omitted);
  await control(item.edit, 'Reset parent open').click();
  await openDialog(item);
  await page.keyboard.press('Escape');
  await expectClosed(item);
  expect(await item.edits()).toEqual(omitted);
  await control(item.edit, 'Reset parent open').click();
  await toggle(item.edit, 'Edit confirmation mounted', false);
  await expect(opener(item)).toBeDisabled();
  await expect(dialog(item)).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await item.edits()).toEqual(omitted);
  await toggle(item.edit, 'Supply onConfirm', true);
  await toggle(item.edit, 'Supply onCancel', true);
  await toggle(item.edit, 'Close parent after callback', true);
  await control(item.edit, 'Replace edit callbacks').click();
  await control(item.edit, 'Remount edit confirmation').click();
  await expect(opener(item)).toBeEnabled();
  before = await item.edits();
  state = await item.editState();
  expect(state).toMatchObject({ callbackRevision: 2, mountRevision: 1 });
  await openDialog(item, 'Space');
  await reachable(item, dialog(item), 'edit-remounted', info);
  await capture(item, 'edit-remounted', info, dialog(item));
  await page.keyboard.press('Enter');
  await expectClosed(item);
  await expectEdit(item, 'onConfirm', before, state);
  await capture(item, 'edit-remounted-return', info, opener(item));
});
