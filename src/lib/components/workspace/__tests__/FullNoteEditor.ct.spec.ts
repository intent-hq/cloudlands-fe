import { readFile } from 'node:fs/promises';
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

test('dirty anonymous edits stay with their original editor across repeated note-ID requests', async ({
  mount,
  page,
}) => {
  const view = await mount(Harness, {
    props: { initialContent: 'Original', initiallyAnonymous: true, recoveryCapacityFull: true },
  });
  const editor = view.locator('.tiptap');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' anonymous draft');
  await view.getByRole('button', { name: 'Assign note ID', exact: true }).click();
  const draft = view.getByTestId('anonymous-note-draft');
  await expect(draft).toBeVisible();
  await expect(editor).toHaveText('Original anonymous draft');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await view.getByRole('button', { name: 'Assign another note ID' }).click();
  await expect(editor).toHaveText('Original anonymous draft');
  await expect(draft).toBeVisible();
  await expect(view.getByTestId('requests')).toHaveText('[]');
  const downloading = page.waitForEvent('download');
  await draft.getByRole('button', { name: 'Export draft' }).click();
  const download = await downloading;
  expect(await readFile((await download.path())!, 'utf8')).toContain('Original anonymous draft');
  // Export does not discard or adopt the newly requested owner.
  await expect(draft).toBeVisible();
  await expect(editor).toHaveText('Original anonymous draft');
  await view.getByRole('button', { name: 'Assign note ID', exact: true }).click();
  await draft.getByRole('button', { name: 'Discard draft' }).click();
  await expect(draft).toHaveCount(0);
  await expect(editor).toHaveText('Original');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(view.getByRole('alert')).toContainText('recovery storage is full');
  await expect(view.getByTestId('requests')).toHaveText('[]');
  await view.getByRole('button', { name: 'Release recovery slot' }).click();
  await view.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' assigned edit');
  await expect(view.getByTestId('persisted')).toContainText('Original assigned edit');
  await expect(view.getByTestId('requests')).not.toContainText('anonymous draft');
});

test('a clean anonymous editor adopts a note ID and respects its existing deletion hold', async ({
  mount,
}) => {
  const view = await mount(Harness, {
    props: { initialContent: 'Original', initiallyAnonymous: true },
  });
  const editor = view.locator('.tiptap');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await view.getByRole('button', { name: 'Hold persisted note' }).click();
  await view.getByRole('button', { name: 'Assign note ID', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(view.getByTestId('anonymous-note-draft')).toHaveCount(0);
  await expect(view.getByTestId('requests')).toHaveText('[]');
});

test('an initially persisted editor still requires a recovery slot before accepting input', async ({
  mount,
}) => {
  const view = await mount(Harness, {
    props: { initialContent: 'Original', recoveryCapacityFull: true },
  });
  await expect(view.locator('.tiptap')).toHaveAttribute('contenteditable', 'false');
  await expect(view.getByRole('alert')).toContainText('recovery storage is full');
  await expect(view.getByTestId('requests')).toHaveText('[]');
  await view.getByRole('button', { name: 'Release recovery slot' }).click();
  await view.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(view.locator('.tiptap')).toHaveAttribute('contenteditable', 'true');
});

test('anonymous editors preserve an explicit read-only permission', async ({ mount }) => {
  const view = await mount(Harness, {
    props: { initialContent: 'Original', initiallyAnonymous: true, editable: false },
  });
  await expect(view.locator('.tiptap')).toHaveAttribute('contenteditable', 'false');
  await expect(view.getByTestId('requests')).toHaveText('[]');
});

test('losing a persisted note ID cannot turn a held editor into an anonymous editable draft', async ({
  mount,
}) => {
  const view = await mount(Harness, { props: { initialContent: 'Original' } });
  const editor = view.locator('.tiptap');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await view.getByRole('button', { name: 'Hold persisted note' }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await view.getByRole('button', { name: 'Remove note ID' }).click();
  await expect(view.getByRole('alert')).toContainText('no longer linked to a note');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(view.getByTestId('anonymous-note-draft')).toHaveCount(0);
  await expect(view.getByTestId('requests')).toHaveText('[]');
  // Reattaching the same ID restores the identified-note guard, including its hold.
  await view.getByRole('button', { name: 'Assign note ID', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(view.getByRole('alert')).toHaveCount(0);
});

test('an existing note incarnation without its note ID is not an anonymous editor', async ({
  mount,
}) => {
  const view = await mount(Harness, {
    props: {
      initialContent: 'Original',
      initiallyAnonymous: true,
      initialInstanceId: 'persisted-instance',
    },
  });
  await expect(view.getByRole('alert')).toContainText('no longer linked to a note');
  await expect(view.locator('.tiptap')).toHaveAttribute('contenteditable', 'false');
  await expect(view.getByTestId('requests')).toHaveText('[]');
});
