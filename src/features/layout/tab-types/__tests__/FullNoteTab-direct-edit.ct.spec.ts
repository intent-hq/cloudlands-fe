import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/FullNoteTabHarness.svelte';

for (const paging of [false, true]) {
  test(`keeps a disposable large spec read-only until explicit raw editing with paging ${paging}`, async ({
    mount,
    page,
  }, info) => {
    const source =
      '# Disposable large spec\n\n' +
      'Acceptance criterion: preserve café and 漢字 across complete-source saves.\n'.repeat(7000) +
      '\nFinal sentinel.';
    const component = await mount(Harness, {
      props: { initialContent: source, paging },
    });
    const wire = component.getByTestId('wire');
    const state = async () => JSON.parse((await wire.textContent())!);
    const editor = component.locator('.monaco-editor').first();
    await expect(editor).toHaveCount(0);
    if (paging) await expect(component.locator('.ProseMirror')).toBeVisible();
    else await expect(component.getByRole('alert')).toContainText('Update the workspace host');
    expect((await state()).reads).toBe(0);
    await info.attach('large-note-default-reader', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await component.getByRole('button', { name: 'Commands' }).click();
    await page.getByRole('menuitem', { name: 'Edit Raw Markdown', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(component.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(component.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
    await expect(component.getByRole('alert')).toHaveCount(0);
    expect((await state()).reads).toBe(1);
    if (!paging) expect((await state()).pageReads).toBe(0);
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Direct edit saved.');
    await expect.poll(async () => (await state()).writes).toBe(1);
    expect((await state()).original.content).toBe(source + ' Direct edit saved.');
    expect((await state()).methods).not.toContain('note.setContent');
    await info.attach('direct-edit-large-spec', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('opens an ambiguous ASCII note directly only after bounded size classification', async ({
  mount,
}) => {
  const source = 'A short line.\n'.repeat(12000);
  const component = await mount(Harness, { props: { initialContent: source, paging: true } });
  await expect(component.locator('.ProseMirror[contenteditable="true"]')).toBeVisible();
  const state = JSON.parse((await component.getByTestId('wire').textContent())!);
  expect(state.reads).toBe(1);
  expect(state.pageReads).toBeGreaterThan(0);
});

test('initially renders a disposable 2 MB spec read-only without a whole-note read', async ({
  mount,
}, info) => {
  const line = 'Disposable acceptance criterion: keep large notes read-only by default.\n';
  const source = '# Disposable 2 MB spec\n\n' + line.repeat(29000) + '\nFinal sentinel.';
  const bytes = new TextEncoder().encode(source).length;
  expect(bytes).toBeGreaterThanOrEqual(2_000_000);
  expect(bytes).toBeLessThan(2_100_000);
  const component = await mount(Harness, { props: { initialContent: source, paging: true } });
  const viewer = component.locator('.ProseMirror[contenteditable="false"]');
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText('Disposable 2 MB spec');
  await expect(
    component.locator('.monaco-editor, .ProseMirror[contenteditable="true"]'),
  ).toHaveCount(0);
  const state = JSON.parse((await component.getByTestId('wire').textContent())!);
  expect(state.reads).toBe(0);
  expect(state.writes).toBe(0);
  expect(state.pageReads).toBeGreaterThan(0);
  expect(state.windows['note-tab'].range.end).toBeLessThan(source.length);
  await info.attach('disposable-spec-size', {
    body: JSON.stringify({ utf8Bytes: bytes, wholeReads: state.reads, pageReads: state.pageReads }),
    contentType: 'application/json',
  });
  await info.attach('disposable-2MB-readonly', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
});

test('returns to bounded rendering after flushing an immediate raw edit', async ({
  mount,
  page,
}, info) => {
  const source = '# Disposable return test\n\n' + 'Read-only large note body.\n'.repeat(14000);
  const component = await mount(Harness, {
    props: { initialContent: source, paging: true, viewMode: 'raw', holdSave: true },
  });
  const editor = component.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Saved before returning.');
  await component.getByRole('button', { name: 'Back to rendered view' }).click();
  await expect(component.getByRole('button', { name: 'Acknowledge fixture save' })).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(component.getByRole('button', { name: 'Back to rendered view' })).toBeDisabled();
  await component.getByRole('button', { name: 'Acknowledge fixture save' }).click();
  await expect(editor).toHaveCount(0);
  await expect(component.locator('.ProseMirror[contenteditable="false"]')).toBeVisible();
  const state = JSON.parse((await component.getByTestId('wire').textContent())!);
  expect(state.original.content).toBe(source + ' Saved before returning.');
  expect(state.original.rev).toBe(5);
  expect(state.windows['note-tab'].sourceRevision).toBe('r5');
  expect(state.windows['note-tab'].snapshotId).toBe('s5');
  expect(state.writes).toBe(1);
  expect(state.reads).toBe(1);
  expect(state.pageReads).toBeGreaterThan(0);
  await info.attach('raw-return-rendered', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
});

test('raw access does not bypass a matching rendered-page failure', async ({ mount, page }) => {
  const source =
    '# Disposable unavailable rendered note\n\n' + 'Bounded pages unavailable.\n'.repeat(14000);
  const component = await mount(Harness, {
    props: { initialContent: source, paging: true, failPages: true },
  });
  await expect(component.getByRole('alert')).toContainText('Failed to load note content');
  const state = async () => JSON.parse((await component.getByTestId('wire').textContent())!);
  expect((await state()).reads).toBe(0);
  await component.getByRole('button', { name: 'Commands' }).click();
  await page.getByRole('menuitem', { name: 'Edit Raw Markdown', exact: true }).click();
  await expect(component.locator('.monaco-editor').first()).toBeVisible();
  expect((await state()).reads).toBe(1);
  await component.getByRole('button', { name: 'Back to rendered view' }).click();
  await expect(component.locator('.monaco-editor')).toHaveCount(0);
  await expect(component.getByRole('alert')).toContainText('Failed to load note content');
  expect((await state()).reads).toBe(1);
  expect((await state()).writes).toBe(0);
});

test('keeps raw Markdown open during composition and returns after composition ends', async ({
  mount,
}) => {
  const component = await mount(Harness, {
    props: { initialContent: '# Composition draft', paging: true, viewMode: 'raw' },
  });
  const raw = component.getByTestId('raw-note-view');
  await expect(component.locator('.monaco-editor').first()).toBeVisible();
  await raw.dispatchEvent('compositionstart');
  await component.getByRole('button', { name: 'Back to rendered view' }).click();
  await expect(component.getByRole('alert')).toContainText(
    'Your draft is still open in Raw Markdown',
  );
  await expect(component.locator('.monaco-editor').first()).toBeVisible();
  expect(JSON.parse((await component.getByTestId('wire').textContent())!).writes).toBe(0);
  await raw.dispatchEvent('compositionend');
  await component.getByRole('button', { name: 'Back to rendered view' }).click();
  await expect(component.locator('.monaco-editor')).toHaveCount(0);
  await expect(component.locator('.ProseMirror[contenteditable="false"]')).toBeVisible();
  expect(JSON.parse((await component.getByTestId('wire').textContent())!).writes).toBe(0);
});
