import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/FullNoteTabHarness.svelte';

test('bounded read failure remains visible inside the note pane', async ({ mount, page }) => {
  const component = await mount(Harness, { props: { paging: true, failPages: true } });
  expect(await page.evaluate(() => window.electronAPI?.versions.electron)).toBe('0.0.0-browser');
  const alert = component.getByRole('alert');
  await expect(alert).toBeVisible();
  const pane = (await page.getByTestId('note-pane').boundingBox())!;
  const error = (await alert.boundingBox())!;
  expect(error.y).toBeGreaterThanOrEqual(pane.y);
  expect(error.y + error.height).toBeLessThanOrEqual(pane.y + pane.height);
  await expect(component.getByTestId('wire')).toContainText('"reads":0');
});

test('same workspace metadata refresh preserves Find and the admitted reader owner', async ({
  mount,
  page,
}) => {
  const source = 'Prefix café 漢字 🙂 suffix';
  const query = 'café 漢字 🙂';
  const component = await mount(Harness, { props: { paging: true, initialContent: source } });
  const wire = component.getByTestId('wire');
  const value = async () => JSON.parse((await wire.textContent())!);
  const viewer = component.locator('.ProseMirror[contenteditable="false"]');
  await expect(viewer).toHaveText(source);
  await viewer.focus();
  await page.keyboard.press('ControlOrMeta+f');
  await component.getByRole('textbox', { name: 'Find in panel' }).fill(query);
  const next = component.getByRole('button', { name: 'Next match', exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await viewer.focus();
  console.info(
    'Find selection diagnostic',
    await viewer.evaluate((el) => ({
      dom: window.getSelection()?.toString(),
      native: (el as any).editor?.state.selection.toJSON(),
      active: document.activeElement?.outerHTML.slice(0, 200),
    })),
  );
  const before = await value();
  await component.getByRole('button', { name: 'Refresh workspace metadata', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const after = await value();
  expect(after.generation).toBe(before.generation);
  expect(after.windows['note-tab']).toEqual(before.windows['note-tab']);
  expect(after.pageReads).toBe(before.pageReads);
  expect(
    after.methods.filter((m: string) => m === 'note.subscribe' || m === 'note.unsubscribe'),
  ).toEqual(
    before.methods.filter((m: string) => m === 'note.subscribe' || m === 'note.unsubscribe'),
  );
  await expect(next).toBeEnabled();
  await viewer.focus();
  await expect(component.getByText('1 / 1', { exact: true })).toBeVisible();
  expect((await value()).reads).toBe(0);
});

test('Find selects exact Unicode text in the readonly native view', async ({ mount, page }) => {
  const query = 'café 漢字 🙂';
  const component = await mount(Harness, {
    props: { paging: true, initialContent: `Prefix ${query} suffix` },
  });
  const viewer = component.locator('.ProseMirror[contenteditable="false"]');
  await expect(viewer).toHaveText(`Prefix ${query} suffix`);
  await viewer.focus();
  await page.keyboard.press('ControlOrMeta+f');
  await component.getByRole('textbox', { name: 'Find in panel' }).fill(query);
  await expect(component.getByRole('textbox', { name: 'Find in panel' })).toBeFocused();
  const next = component.getByRole('button', { name: 'Next match', exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(viewer).toBeFocused();
  console.info(
    'Find selection diagnostic',
    await viewer.evaluate((el) => ({
      dom: window.getSelection()?.toString(),
      native: (el as any).editor?.state.selection.toJSON(),
      active: document.activeElement?.outerHTML.slice(0, 200),
    })),
  );
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(query);
});

test('Find navigates to an off-window hit through the bounded reader', async ({ mount, page }) => {
  const source = 'First prefix....Second portion..Third portion...Fourth portion..';
  const component = await mount(Harness, {
    props: { paging: true, initialContent: source, pageChunk: 16, canonicalPadding: 4500 },
  });
  const wire = component.getByTestId('wire');
  const state = async () => JSON.parse((await wire.textContent())!);
  await expect
    .poll(async () => {
      const w = (await state()).windows['note-tab'];
      return !w?.loading && w?.growth ? w.range.end : -1;
    })
    .toBe(16);
  const before = await state();
  const viewer = component.locator('.ProseMirror[contenteditable="false"]');
  await viewer.focus();
  await page.keyboard.press('ControlOrMeta+f');
  const input = component.getByRole('textbox', { name: 'Find in panel' });
  await input.fill('Third');
  const next = component.getByRole('button', { name: 'Next match', exact: true });
  await expect(next).toBeEnabled();
  await expect(input).toBeFocused();
  await next.click();
  await expect.poll(async () => (await state()).windows['note-tab']?.range.start).toBe(32);
  await expect(viewer).toHaveText(source.slice(32, 48));
  await expect(viewer).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Third');
  const after = await state();
  expect(after.generation).toBe(before.generation);
  expect(after.windows['note-tab'].scope).toEqual(before.windows['note-tab'].scope);
  expect(after.windows['note-tab'].snapshotId).toBe(before.windows['note-tab'].snapshotId);
  expect(after.windows['note-tab'].sourceRevision).toBe(before.windows['note-tab'].sourceRevision);
  expect(after.reads).toBe(0);
});

test('explicit Edit and Done admit a new window after genuine panel reopening', async ({
  mount,
}) => {
  const component = await mount(Harness, {
    props: { paging: true, initialContent: 'Current note' },
  });
  const wire = component.getByTestId('wire');
  const value = async () => JSON.parse((await wire.textContent())!);
  await expect.poll(async () => (await value()).windows['note-tab']?.loaded).toBe(true);
  const before = await value();
  await component.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(component.locator('.ProseMirror[contenteditable="true"]')).toHaveText(
    'Current note',
  );
  await component.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await value()).generation).toBeGreaterThan(before.generation);
  await expect.poll(async () => (await value()).windows['note-tab']?.loaded).toBe(true);
  const after = await value();
  expect(after.pageReads).toBeGreaterThan(before.pageReads);
  expect(after.windows['note-tab'].scope).toEqual(before.windows['note-tab'].scope);
  await expect(component.locator('.ProseMirror[contenteditable="false"]')).toHaveText(
    'Current note',
  );
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
  const component = await mount(Harness, {
    props: { initialContent: source, paging: true, nativeClipboard: true },
  });
  expect(await page.evaluate(() => window.electronAPI?.versions.electron)).toBe(
    '42.0.0-clipboard-fixture',
  );
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
  await component.unmount();
  expect(await page.evaluate(() => window.electronAPI?.versions.electron)).toBe('0.0.0-browser');
});

test('bounded growth preserves the prefix and stops at its work checkpoint', async ({ mount }) => {
  const source = 'First prefix....Second portion..Third portion...Fourth portion..';
  const component = await mount(Harness, {
    props: { paging: true, initialContent: source, pageChunk: 16 },
  });
  const wire = component.getByTestId('wire');
  const state = async () => JSON.parse((await wire.textContent())!).windows['note-tab'];
  await expect
    .poll(async () => {
      const w = await state();
      return w?.loading ? 0 : (w?.range?.end ?? 0);
    })
    .toBeGreaterThan(16);
  const viewer = component.locator('.ProseMirror[contenteditable="false"]');
  await expect(viewer).toContainText('First prefix....');
  await expect(viewer).toContainText('Second portion..');
  const w = await state();
  expect(w.range.start).toBe(0);
  const scroller = viewer.locator('xpath=ancestor::div[@aria-label][1]');
  expect(await scroller.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  await expect(
    component.getByRole('button', { name: 'Previous part', exact: true }),
  ).toBeDisabled();
  await expect(component.getByRole('alert')).toHaveCount(0);
});

test('paging controls reach the third and fourth parts and return without a scrollbar', async ({
  mount,
  page,
}) => {
  const source = 'First prefix....Second portion..Third portion...Fourth portion..';
  const component = await mount(Harness, {
    props: {
      paging: true,
      initialContent: source,
      pageChunk: 16,
      canonicalPadding: 4500,
      nativeClipboard: true,
    },
  });
  expect(await page.evaluate(() => window.electronAPI?.versions.electron)).toBe(
    '42.0.0-clipboard-fixture',
  );
  const wire = component.getByTestId('wire');
  const state = async () => JSON.parse((await wire.textContent())!).windows['note-tab'];
  const settled = async (start: number) => {
    await expect
      .poll(async () => {
        const w = await state();
        return !w?.loading && (w?.growth || w?.range?.end === source.length) ? w.range.start : -1;
      })
      .toBe(start);
  };
  const viewer = component.locator('.ProseMirror[contenteditable="false"]');
  const next = component.getByRole('button', { name: 'Next part', exact: true });
  const previous = component.getByRole('button', { name: 'Previous part', exact: true });
  await settled(0);
  await expect(viewer).toHaveText(source.slice(0, 16));
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  const scroller = viewer.locator('xpath=ancestor::div[@aria-label][1]');
  expect(await scroller.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  const before = (await state()).request;
  // Resizing after the refused growth cannot issue another automatic attempt.
  await scroller.evaluate((el) => {
    const pane = el.closest<HTMLElement>('[data-testid="note-pane"]');
    if (!pane) throw new Error('Missing note pane ancestor');
    pane.style.height = '620px';
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect((await state()).request).toBe(before);
  for (const start of [16, 32, 48]) {
    await next.focus();
    await page.keyboard.press('Enter');
    await settled(start);
    await expect(viewer).toHaveText(source.slice(start, start + 16));
  }
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  await previous.focus();
  await page.keyboard.press('Space');
  await settled(32);
  await expect(viewer).toHaveText(source.slice(32, 48));
  await component.getByRole('button', { name: 'Commands', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy full note' }).click();
  await expect(wire).toContainText('"copied":true');
  await expect(wire).toContainText('"reads":0');
  await component.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = component.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toContainText('First prefix');
  await expect(editor).toContainText('Fourth portion');
  await component.getByRole('button', { name: 'Done', exact: true }).click();
  await settled(0);
  await expect(viewer).toHaveText(source.slice(0, 16));
  await expect(component.getByRole('alert')).toHaveCount(0);
  await component.unmount();
  expect(await page.evaluate(() => window.electronAPI?.versions.electron)).toBe('0.0.0-browser');
});
