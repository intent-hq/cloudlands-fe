import { expect, test } from '../../../../test/ct-test';
import Harness from './FullNoteEditorHarness.svelte';

test('small rich editing saves, reopens and continues with the acknowledged revision', async ({
  mount,
  page,
}) => {
  const view = await mount(Harness, { props: { initialContent: 'Original' } });
  const rich = view.locator('.tiptap[contenteditable="true"]');
  await expect(rich).toBeVisible();
  await rich.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' first');
  await expect(view.getByTestId('persisted')).toContainText('Original first');
  await view.getByRole('button', { name: 'Toggle editor' }).click();
  await view.getByRole('button', { name: 'Toggle editor' }).click();
  await expect(rich).toHaveText('Original first');
  await rich.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' second');
  await expect(view.getByTestId('requests')).toContainText('Original first second');
  const calls = JSON.parse((await view.getByTestId('requests').textContent())!);
  expect(calls.map((r: { rev: number }) => r.rev)).toEqual([4, 5]);
});

test('large notes mount writable Monaco past the old code limit, save complete source and reopen', async ({
  mount,
  page,
}, info) => {
  test.setTimeout(60_000);
  const initialContent = 'HEAD\n' + '漢字 sentence\n'.repeat(60_000) + 'TAIL';
  const view = await mount(Harness, { props: { initialContent } });
  const raw = view.locator('.monaco-editor');
  await expect(raw).toBeVisible();
  await raw.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' first');
  await expect(view.getByTestId('persisted')).toContainText('TAIL first');
  await view.getByRole('button', { name: 'Toggle editor' }).click();
  await view.getByRole('button', { name: 'Toggle editor' }).click();
  await expect(raw).toBeVisible();
  await raw.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' second');
  await expect(view.getByTestId('persisted')).toContainText('TAIL first second');
  const calls = JSON.parse((await view.getByTestId('requests').textContent())!);
  expect(calls).toEqual([
    {
      length: initialContent.length + 6,
      start: initialContent.slice(0, 30),
      end: (initialContent + ' first').slice(-30),
      rev: 4,
    },
    {
      length: initialContent.length + 13,
      start: initialContent.slice(0, 30),
      end: (initialContent + ' first second').slice(-30),
      rev: 5,
    },
  ]);
  await info.attach('large-note-editing', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('small notes preserve explicit raw preference and read-only permission', async ({
  mount,
  page,
}) => {
  const view = await mount(Harness, {
    props: { initialContent: 'Protected', preferRaw: true, editable: false },
  });
  await expect(view.locator('.monaco-editor')).toBeVisible();
  await view.locator('.monaco-editor').click();
  await page.keyboard.type(' forbidden');
  await expect(view.getByTestId('requests')).toHaveText('[]');
  await expect(view.getByTestId('persisted')).toContainText('Protected');
});

test('growth waits for composition end, carries the draft and selection, and starts fresh raw history', async ({
  mount,
  page,
}) => {
  const view = await mount(Harness, { props: { initialContent: 'Before' } });
  const rich = view.locator('.tiptap[contenteditable="true"]');
  await expect(rich).toBeVisible();
  await rich.click();
  await page.keyboard.press('ControlOrMeta+End');
  await rich.dispatchEvent('compositionstart');
  await page.keyboard.insertText('漢'.repeat(100_000));
  await expect(view.locator('.monaco-editor')).toHaveCount(0);
  await rich.dispatchEvent('compositionend');
  const raw = view.locator('.monaco-editor');
  await expect(raw).toBeVisible();
  await expect(view.getByTestId('persisted')).toContainText('"length":100006');
  // The transfer restores the end caret and focus without another click.
  await page.keyboard.type(' tail');
  await expect(view.getByTestId('persisted')).toContainText(' tail');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(view.getByTestId('persisted')).toContainText('"length":100006');
  // Raw undo starts at the handoff document and cannot discard the rich draft.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(view.getByTestId('persisted')).toContainText('"length":100006');
});

for (const preferRaw of [false, true]) {
  test(`Done retains a ${preferRaw ? 'raw' : 'rich'} draft when its save fails`, async ({
    mount,
    page,
  }) => {
    const view = await mount(Harness, {
      props: { initialContent: 'Original', preferRaw, holdSaves: true },
    });
    const editor = view.locator(preferRaw ? '.monaco-editor' : '.tiptap');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' draft');
    await view.getByRole('button', { name: 'Done editing' }).click();
    await expect(view.getByTestId('requests')).toContainText('Original draft');
    await editor.click();
    await page.keyboard.type(' blocked');
    await view.getByRole('button', { name: 'Reject save' }).click();
    await expect(view.getByTestId('finish-error')).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(view.getByRole('alert')).toContainText('Save acknowledgement lost');
    await expect(view.getByTestId('requests')).not.toContainText('blocked');
    await expect(view.getByTestId('persisted')).toContainText('Original');
  });
  test(`Done locks ${preferRaw ? 'raw' : 'rich'} typing until the complete draft is acknowledged`, async ({
    mount,
    page,
  }) => {
    const view = await mount(Harness, {
      props: { initialContent: 'Original', preferRaw, holdSaves: true },
    });
    const editor = view.locator(preferRaw ? '.monaco-editor' : '.tiptap');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' draft');
    await view.getByRole('button', { name: 'Done editing' }).click();
    await expect(view.getByTestId('requests')).toContainText('Original draft');
    await editor.click();
    await page.keyboard.type(' blocked');
    await view.getByRole('button', { name: 'Accept save' }).click();
    await expect(editor).toHaveCount(0);
    await expect(view.getByTestId('persisted')).toContainText('Original draft');
    await expect(view.getByTestId('requests')).not.toContainText('blocked');
  });
}
