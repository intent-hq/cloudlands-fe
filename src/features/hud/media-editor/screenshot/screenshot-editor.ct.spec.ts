import { expect, test } from '../../../../test/ct-test';
import ScreenshotEditorHarness from './__fixtures__/ScreenshotEditorHarness.svelte';
import type { DockMediaEdit, DockMediaEditMark } from '$shared/dock-media-edit';

test('screenshot keyboard edits, text and legacy metadata survive the save transaction', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  const mark = (
    id: string,
    kind: DockMediaEditMark['kind'],
    geometry: DockMediaEditMark['geometry'],
  ): DockMediaEditMark => ({
    id,
    kind,
    geometry,
    atMs: 0,
    batchId: 'initial',
    source: 'editor',
    included: true,
    label: kind === 'box' ? 'Box' : '',
    note: id === 'element' ? 'Legacy note' : id === 'box-one' ? 'Keep this card' : '',
    context:
      id === 'element'
        ? { selector: 'button.save', text: 'Save changes', url: 'https://example.test/settings' }
        : { selector: null, text: null, url: null },
  });
  const fixture = await mount(ScreenshotEditorHarness, {
    props: {
      initialMarks: [
        mark('box-one', 'box', { kind: 'rect', x: 45, y: 55, w: 235, h: 140 }),
        mark('box-two', 'box', { kind: 'rect', x: 420, y: 250, w: 210, h: 130 }),
        mark('text', 'text', { kind: 'text', x: 300, y: 80, text: 'Original note', fontSize: 18 }),
        mark('element', 'element', { kind: 'rect', x: 420, y: 250, w: 210, h: 130 }),
      ],
      initialBlurRegions: [{ id: 'blur', x: 65, y: 100, w: 185, h: 65 }],
    },
  });
  const canvas = fixture.getByRole('application');
  const draft = async () =>
    JSON.parse((await fixture.getAttribute('data-draft')) ?? '{}') as DockMediaEdit;
  await expect(fixture.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await fixture.getByRole('button', { name: 'Pointer', exact: true }).click();
  await fixture.getByRole('option', { name: 'Mark 1 · Box', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => {
      const m = (await draft()).marks[0].geometry;
      return m.kind === 'rect' ? { x: m.x, w: m.w } : null;
    })
    .toEqual({ x: 46, w: 236 });
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await draft()).marks.length).toBe(3);
  await expect(fixture.getByRole('option', { name: /^Mark / })).toHaveCount(3);
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await draft()).marks.length).toBe(4);
  await expect.poll(async () => (await draft()).blurRegions.length).toBe(1);
  await expect(fixture.getByRole('option', { name: /^Mark / })).toHaveCount(4);
  await canvas.locator('[data-shape-id="text"]').dblclick();
  await fixture.getByRole('textbox', { name: 'Text', exact: true }).fill('Fix this');
  await fixture.getByRole('option', { name: 'Mark 1 · Box', exact: true }).click();
  await expect
    .poll(async () => (await draft()).marks.find((mark) => mark.id === 'text')?.geometry)
    .toMatchObject({ kind: 'text', text: 'Fix this' });
  await info.attach('screenshot-editor-edits', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expect(fixture.getByRole('button', { name: 'Retake', exact: true })).toHaveCount(0);
  const save = fixture.getByRole('button', { name: 'Save changes', exact: true });
  await expect(save).toBeEnabled();
  await save.focus();
  await save.press('Enter');
  await expect(fixture).not.toHaveAttribute('data-saved', '');
  const saved = JSON.parse((await fixture.getAttribute('data-saved')) ?? '{}') as DockMediaEdit;
  expect(saved.blurRegions).toHaveLength(1);
  expect(saved.marks[3].context).toMatchObject({ selector: 'button.save', text: 'Save changes' });
  expect(saved.marks.map((mark) => mark.id)).toEqual(['box-one', 'box-two', 'text', 'element']);
  expect(saved.marks[0].geometry).toEqual({ kind: 'rect', x: 46, y: 55, w: 236, h: 140 });
  expect(saved.marks[0].note).toBe('Keep this card');
  expect(saved.marks[2].geometry).toMatchObject({ kind: 'text', text: 'Fix this' });
  expect(saved.marks[3].context.url).toBe('https://example.test/settings');
  expect(saved.marks[3].note).toBe('Legacy note');
  expect(saved.blurRegions).toEqual([{ id: 'blur', x: 65, y: 100, w: 185, h: 65 }]);
  await expect(fixture.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await info.attach('screenshot-editor-saved-draft', {
    body: JSON.stringify({ syntheticSource: true, seededLegacyMetadata: true, saved }, null, 2),
    contentType: 'application/json',
  });
  await info.attach('screenshot-editor-saved', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
