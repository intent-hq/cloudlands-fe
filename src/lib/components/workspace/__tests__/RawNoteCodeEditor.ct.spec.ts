import { expect, test } from '../../../../test/ct-test';
import Harness from './RawNoteCodeEditorHarness.svelte';

test('raw Markdown survives the idle save and subsequent typing', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness);
  const editor = component.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' first');
  await expect(component.getByTestId('persisted')).toHaveText('# Original first');
  await expect(editor.locator('.view-lines')).toContainText('Original first');
  await page.keyboard.type(' second');
  await expect(component.getByTestId('persisted')).toHaveText('# Original first second');
  await expect
    .poll(async () => JSON.parse((await component.getByTestId('requests').textContent())!))
    .toEqual([
      {
        noteId: 'raw-note',
        content: '# Original first',
        expectedVersion: 4,
        workspaceId: 'raw-note-ct',
      },
      {
        noteId: 'raw-note',
        content: '# Original first second',
        expectedVersion: 5,
        workspaceId: 'raw-note-ct',
      },
    ]);
  await component.getByRole('button', { name: 'Toggle editor' }).click();
  await component.getByRole('button', { name: 'Toggle editor' }).click();
  await expect(editor.locator('.view-lines')).toContainText('Original first second');
  await testInfo.attach('raw-markdown-saved', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('note-save-requests', {
    body: (await component.getByTestId('requests').textContent())!,
    contentType: 'application/json',
  });
});

test('raw Markdown flushes on close and external updates do not create saves', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness);
  const editor = component.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await component.getByRole('button', { name: 'External update' }).click();
  await expect(editor.locator('.view-lines')).toContainText('External');
  await page.clock.install();
  await page.clock.runFor(2500);
  await expect(component.getByTestId('requests')).toHaveText('[]');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' draft');
  await component.getByRole('button', { name: 'Toggle editor' }).click();
  await expect(component.getByTestId('persisted')).toHaveText('# External draft');
  await expect
    .poll(async () => JSON.parse((await component.getByTestId('requests').textContent())!))
    .toEqual([
      {
        noteId: 'raw-note',
        content: '# External draft',
        expectedVersion: 5,
        workspaceId: 'raw-note-ct',
      },
    ]);
  await component.getByRole('button', { name: 'Toggle editor' }).click();
  await expect(editor.locator('.view-lines')).toContainText('External draft');
  await testInfo.attach('raw-markdown-reopened', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
