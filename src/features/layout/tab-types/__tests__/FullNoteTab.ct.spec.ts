import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/FullNoteTabHarness.svelte';

test('bounded read failure remains visible inside the note pane', async ({ mount, page }) => {
  const component = await mount(Harness, { props: { paging: true, failPages: true } });
  const alert = component.getByRole('alert');
  await expect(alert).toBeVisible();
  const pane = (await page.getByTestId('note-pane').boundingBox())!;
  const error = (await alert.boundingBox())!;
  expect(error.y).toBeGreaterThanOrEqual(pane.y);
  expect(error.y + error.height).toBeLessThanOrEqual(pane.y + pane.height);
  await expect(component.getByTestId('wire')).toContainText('"reads":0');
});

test('workspace refresh admits a new bounded window for the reopened panel', async ({ mount }) => {
  const component = await mount(Harness, {
    props: { paging: true, initialContent: 'Current note' },
  });
  const wire = component.getByTestId('wire');
  const value = async () => JSON.parse((await wire.textContent())!);
  await expect.poll(async () => (await value()).windows['note-tab']?.loaded).toBe(true);
  const before = await value();
  await component.getByRole('button', { name: 'Refresh workspace metadata', exact: true }).click();
  await expect.poll(async () => (await value()).generation).toBeGreaterThan(before.generation);
  await expect.poll(async () => (await value()).windows['note-tab']?.loaded).toBe(true);
  const after = await value();
  expect(after.pageReads).toBeGreaterThan(before.pageReads);
  expect(after.windows['note-tab'].scope).toMatchObject({
    workspaceId: 'complete-note-tab-ct',
    noteId: 'note',
  });
  expect(after.windows['note-tab'].sourceRevision).toBe('r4');
  expect(after.reads).toBe(0);
});

for (const raw of [false, true]) {
  test(`normal tab explicitly loads and saves complete ${raw ? 'raw' : 'rich'} source`, async ({
    mount,
    page,
  }) => {
    test.setTimeout(90000);
    const source = raw ? '世'.repeat(180000) : 'Complete note';
    const component = await mount(Harness, { props: { initialContent: source } });
    const wire = component.getByTestId('wire');
    await expect(wire).toContainText('client.hello');
    await expect(wire).toContainText('"reads":0');
    await expect(component.locator('.ProseMirror[contenteditable="true"]')).toHaveCount(0);
    await component.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = raw
      ? component.locator('.monaco-editor').first()
      : component.locator('.ProseMirror[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' edited');
    await component.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(wire).toContainText('"writes":1');
    await expect(wire).toContainText(' edited');
    await expect(wire).toContainText(`"length":${source.length + 7}`);
    await expect(component.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await component.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' twice');
    await component.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(wire).toContainText('"writes":2');
    await expect(wire).toContainText(`"length":${source.length + 13}`);
    await expect(wire).toContainText('"reads":2');
    await expect(wire).not.toContainText('note.setContent');
  });
}

test('normal capable tab admits a bounded viewer and returns to it after complete editing', async ({
  mount,
  page,
}) => {
  test.setTimeout(90000);
  const source = 'bounded viewing '.repeat(20000);
  const component = await mount(Harness, { props: { initialContent: source, paging: true } });
  const wire = component.getByTestId('wire');
  const viewer = component.locator('.ProseMirror[contenteditable="false"]');
  await expect(viewer).toBeVisible();
  await expect(wire).toContainText('note.get:source');
  await expect(wire).toContainText('"reads":0');
  expect((await viewer.textContent())!.length).toBeLessThanOrEqual(8192);
  await viewer.hover();
  await page.mouse.wheel(0, 5000);
  await expect
    .poll(async () => JSON.parse((await wire.textContent())!).maxPageAt)
    .toBeGreaterThan(8192);
  await component.getByRole('button', { name: 'Commands', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy full note' }).click();
  await expect(wire).toContainText('"copied":true');
  await expect(wire).toContainText('"copyCount":1');
  await viewer.click();
  await expect(viewer).toBeFocused();
  await page.keyboard.press('ControlOrMeta+f');
  await component.getByRole('textbox', { name: 'Find in panel' }).fill('viewing');
  await expect(component.getByRole('button', { name: 'Next match', exact: true })).toBeEnabled();
  await component.getByRole('button', { name: 'Next match', exact: true }).click();
  await expect(component.getByRole('button', { name: 'Next match', exact: true })).toBeEnabled();
  await component.getByRole('button', { name: 'Close find', exact: true }).click();
  await viewer.click();
  await page.keyboard.press('ControlOrMeta+a');
  await viewer.dispatchEvent('copy', { bubbles: true, cancelable: true });
  await expect(wire).toContainText('"copyCount":2', { timeout: 30000 });
  await expect(wire).toContainText('"copied":true');
  await expect(wire).toContainText('"reads":0');
  await component.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = component.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' saved');
  await component.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(wire).toContainText('"reads":1');
  await expect(wire).toContainText('"writes":1');
  await expect(wire).toContainText(' saved');
  await expect(component.getByRole('alert')).toHaveCount(0);
});
