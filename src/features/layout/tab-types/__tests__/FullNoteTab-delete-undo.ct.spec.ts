import { test, expect } from '../../../../test/ct-test';
import Harness from './mocks/FullNoteTabHarness.svelte';

const source = '# Kept after Undo\n\nExact Unicode: café 👩🏽‍💻\nLast sentinel.\n';
for (const nativeDelete of [false, true]) {
  test(`Delete grace and real Undo preserve the original bounded note in ${nativeDelete ? 'native' : 'browser'} fixture`, async ({
    mount,
    page,
  }) => {
    const component = await mount(Harness, {
      props: { paging: true, deleteUndo: true, nativeDelete, initialContent: source },
    });
    const state = async () => JSON.parse((await component.getByTestId('wire').textContent())!);
    expect(await page.evaluate(() => window.electronAPI?.versions?.electron)).toBe(
      nativeDelete ? '42.0.0-note-delete-fixture' : '0.0.0-browser',
    );
    await expect(component.locator('.ProseMirror[contenteditable="false"]')).toContainText(
      'Last sentinel.',
    );
    expect((await state()).reads).toBe(0);
    await expect
      .poll(async () => (await state()).graceSubscriptions)
      .toEqual([
        {
          workspaceId: 'complete-note-tab-ct',
          handle: 'grace-handle-1',
          subscriptionId: 'grace-sub-1',
        },
      ]);
    expect((await state()).graceGenericSubscriptions).toBe(0);
    const original = (await state()).original;
    await component.getByRole('button', { name: 'Commands', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete note', exact: true }).click();
    await expect.poll(async () => (await state()).graceOperation?.state).toBe('PENDING');
    expect((await state()).deleted).toBe(false);
    expect((await state()).deleteRequest).toMatchObject({
      workspaceId: 'complete-note-tab-ct',
      noteId: 'note',
      noteInstanceId: 'i',
      expectedVersion: 4,
      sourceRevision: 'r4',
      undoDelayMs: 15000,
    });
    await page.keyboard.press('Escape');
    await page
      .locator('[data-sonner-toast]')
      .getByRole('button', { name: /^Undo\b/ })
      .click();
    await expect.poll(async () => (await state()).graceOperation?.state).toBe('CANCELLED');
    expect((await state()).original).toEqual(original);
    expect((await state()).original.content).toBe(source);
    expect((await state()).reads).toBe(0);
    expect((await state()).methods).not.toContain('note.delete');
    expect((await state()).methods).not.toContain('note.create');
    expect((await state()).restored).toBeNull();
    await component
      .getByRole('button', { name: 'Stop note fixture lifecycle', exact: true })
      .click();
    await expect.poll(async () => (await state()).graceUnsubscriptions).toEqual(['grace-handle-1']);
    expect((await state()).graceSubscriptions).toHaveLength(1);
    expect((await state()).graceGenericSubscriptions).toBe(0);
  });
}

test('an older daemon keeps the bounded note without destructive fallback', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, {
    props: { paging: true, deleteUndo: true, deleteMode: 'unsupported', initialContent: source },
  });
  const state = async () => JSON.parse((await component.getByTestId('wire').textContent())!);
  await expect(component.locator('.ProseMirror[contenteditable="false"]')).toContainText(
    'Last sentinel.',
  );
  await component.getByRole('button', { name: 'Commands', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete note', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page
      .locator('[data-sonner-toast]')
      .getByText('This backend does not support Undo-safe deletion. The note was kept.', {
        exact: true,
      }),
  ).toBeVisible();
  expect((await state()).original.content).toBe(source);
  expect((await state()).methods).not.toContain('note.deleteSchedule');
  expect((await state()).methods).not.toContain('note.delete');
  expect((await state()).methods).not.toContain('note.create');
  expect((await state()).reads).toBe(0);
});

test('sidebar deletion hides only after acknowledgement and Undo reveals the same original note', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, {
    props: { paging: true, deleteUndo: true, sidebarDelete: true, initialContent: source },
  });
  const state = async () => JSON.parse((await component.getByTestId('wire').textContent())!);
  const sidebar = component.getByTestId('delete-sidebar');
  const row = sidebar.locator('[data-note-id="note"]');
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await state()).graceOperation?.state).toBe('PENDING');
  await expect(row).toHaveCount(0);
  expect((await state()).deleted).toBe(false);
  await sidebar.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await state()).graceOperation?.state).toBe('CANCELLED');
  await expect(row).toBeVisible();
  expect((await state()).original).toMatchObject({ id: 'note', content: source, rev: 4 });
  expect((await state()).reads).toBe(0);
  expect((await state()).methods).not.toContain('note.delete');
  expect((await state()).methods).not.toContain('note.create');
});

test('lost schedule acknowledgement keeps the note visible until Check status confirms the same operation', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, {
    props: {
      paging: true,
      deleteUndo: true,
      sidebarDelete: true,
      deleteMode: 'lost-ack',
      initialContent: source,
    },
  });
  const state = async () => JSON.parse((await component.getByTestId('wire').textContent())!);
  const sidebar = component.getByTestId('delete-sidebar');
  const row = sidebar.locator('[data-note-id="note"]');
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await state()).graceOperation?.state).toBe('PENDING');
  await expect(row).toBeVisible();
  await sidebar.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(row).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row).toBeVisible();
  expect(
    (await state()).methods.filter((method: string) => method === 'note.deleteSchedule'),
  ).toHaveLength(1);
  expect((await state()).methods).not.toContain('note.create');
  expect((await state()).original.content).toBe(source);
});
