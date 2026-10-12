// DRAFT ONLY. One case per later released invocation; inspect every distinct PNG before the next.
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
  expectIcon,
  reachable,
  pasteCurrent,
  tabToScript,
  openDialog,
  expectClosed,
  expectEdit,
} from '../lib/script-actions.mjs';

test('script actions S1: native copy uses current raw content and exposes copied then reset feedback', async ({
  page,
}, info) => {
  const item = await openActions(page);
  const first = '# raw <b>not markup</b>\n\tprintf "%s" "雪 & <tag>"\n\n';
  await field(item.script, 'Script content').fill(first);
  const code = item.card.locator('pre');
  expect(await code.textContent()).toBe(first);
  await expect(code.locator('*')).toHaveCount(0);
  await expectIcon(item.card.locator('svg[data-icon="terminal"]'), 'faTerminal', info);
  await expectIcon(copy(item).locator('svg'), 'faCopy', info);
  await reachable(item, item.frame, 'copy-before', info);
  await capture(item, 'copy-before', info);
  await copy(item).click();
  await expect(copy(item, true)).toBeVisible();
  await expectIcon(copy(item, true).locator('svg'), 'faCheck', info);
  // Record transient feedback directly above; screenshot preparation must not
  // assume it survives. Capture the stable before/reset states only.
  await pasteCurrent(item, first);
  // Observe the source's reset; no fake clock or elapsed-time budget assertion.
  await expect(copy(item)).toBeVisible();
  await expectIcon(copy(item).locator('svg'), 'faCopy', info);
  const current = '# changed caller value\n  printf "%s" "β\\literal"\n';
  await field(item.script, 'Script content').fill(current);
  expect(await code.textContent()).toBe(current);
  await tabToScript(item, copy(item));
  await expect(copy(item)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(copy(item, true)).toBeVisible();
  await pasteCurrent(item, current);
  await expect(copy(item)).toBeVisible();
  expect((await item.uses()).count).toBe(0);
  await capture(item, 'copy-current-reset', info);
});

test('script actions S2: Use reports exact current payload and callback without remounting the card', async ({
  page,
}, info) => {
  const item = await openActions(page);
  const originalNode = await item.card.elementHandle();
  const payload = {
    name: 'Prepare 雪',
    description: 'Caller <b>plain text</b>',
    content: '# first\n  echo "literal"\n',
  };
  for (const [key, name] of [
    ['name', 'Script name'],
    ['description', 'Script description'],
    ['content', 'Script content'],
  ])
    await field(item.script, name).fill(payload[key]);
  await capture(item, 'use-before', info);
  await useScript(item).click();
  await expect.poll(async () => (await item.uses()).count).toBe(1);
  expect((await item.uses()).records).toEqual([
    { args: [payload], argumentCount: 1, callbackRevision: 0, mountRevision: 0, inputs: payload },
  ]);
  const next = {
    name: 'Current script',
    description: 'Changed callback input',
    content: '# replacement\n\techo "β"\n',
  };
  for (const [key, name] of [
    ['name', 'Script name'],
    ['description', 'Script description'],
    ['content', 'Script content'],
  ])
    await field(item.script, name).fill(next[key]);
  await control(item.script, 'Replace script callback').click();
  await sameNode(item.card, originalNode);
  await tabToScript(item, useScript(item));
  await page.keyboard.press('Space');
  await expect.poll(async () => (await item.uses()).count).toBe(2);
  expect((await item.uses()).records.at(-1)).toEqual({
    args: [next],
    argumentCount: 1,
    callbackRevision: 1,
    mountRevision: 0,
    inputs: next,
  });
  await toggle(item.script, 'Supply onUseScript', false);
  await expect(useScript(item)).toHaveCount(0);
  await sameNode(item.card, originalNode);
  await copy(item).click();
  await pasteCurrent(item, next.content);
  expect((await item.uses()).count).toBe(2);
  await toggle(item.script, 'Supply onUseScript', true);
  await useScript(item).click();
  await expect.poll(async () => (await item.uses()).count).toBe(3);
  expect((await item.uses()).records.at(-1)).toEqual({
    args: [next],
    argumentCount: 1,
    callbackRevision: 1,
    mountRevision: 0,
    inputs: next,
  });
  await expect(copy(item)).toBeVisible();
  await reachable(item, item.frame, 'use-current', info);
  await capture(item, 'use-current', info);
  await originalNode.dispose();
});

test('script actions D1: portaled edit confirmation restores opener after native keyboard and pointer confirm', async ({
  page,
}, info) => {
  const item = await openActions(page);
  const initial = await item.edits();
  await capture(item, 'edit-opener-before', info, opener(item));
  await openDialog(item, 'Enter');
  await expect(
    dialog(item).getByText(label('chat_editRegenerate_confirm_description'), { exact: true }),
  ).toBeVisible();
  await reachable(item, dialog(item), 'edit-confirm', info);
  await capture(item, 'edit-confirm-open', info, dialog(item));
  const state = await item.editState();
  await page.keyboard.press('Enter');
  await expectClosed(item);
  await expectEdit(item, 'onConfirm', initial, state);
  const before = await item.edits();
  await openDialog(item);
  await control(dialog(item), label('chat_editRegenerate_confirm_button')).click();
  await expectClosed(item);
  await expectEdit(item, 'onConfirm', before, state);
  expect((await item.editState()).open).toBe(false);
  await capture(item, 'edit-confirm-return', info, opener(item));
});

test('script actions D2: cancel close and Escape each cancel once and restore opener focus', async ({
  page,
}, info) => {
  const item = await openActions(page);
  for (const mode of ['cancel', 'close', 'outside', 'Escape']) {
    const before = await item.edits();
    const state = await item.editState();
    await openDialog(item);
    await capture(item, `edit-${mode}-open`, info, dialog(item));
    if (mode === 'cancel') {
      await page.keyboard.press('Shift+Tab');
      const cancel = control(dialog(item), label('modals_bulkActionConfirm_cancel_label'));
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Space');
    } else if (mode === 'close') {
      await control(dialog(item), label('ui_dialog_close_ariaLabel')).click();
    } else if (mode === 'outside') {
      const bounds = await dialog(item).boundingBox();
      expect(bounds.x).toBeGreaterThan(0);
      await page.mouse.click(bounds.x / 2, bounds.y + bounds.height / 2);
    } else await page.keyboard.press('Escape');
    await expectClosed(item);
    await expectEdit(item, 'onCancel', before, state);
    // A further real Escape after dismissal cannot invoke a stale cancellation handler.
    const closed = await item.edits();
    await page.keyboard.press('Escape');
    expect(await item.edits()).toEqual(closed);
    await capture(item, `edit-${mode}-return`, info, opener(item));
  }
});
