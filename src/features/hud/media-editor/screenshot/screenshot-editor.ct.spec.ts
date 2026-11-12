import { expect, test } from '../../../../test/ct-test';
import ScreenshotEditorHarness from './__fixtures__/ScreenshotEditorHarness.svelte';
import type { DockMediaEdit, DockMediaEditMark } from '$shared/dock-media-edit';

test('screenshot keyboard edits, notes and save share the shell transaction', async ({
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
    note: '',
    context: { selector: null, text: null, url: null },
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
  await fixture
    .getByRole('textbox', { name: 'Note for mark 1', exact: true })
    .fill('Keep this card');
  await expect(
    fixture.getByRole('textbox', { name: 'Note for mark 2', exact: true }),
  ).toBeVisible();
  await fixture.getByRole('button', { name: 'Pointer', exact: true }).click();
  await fixture.getByRole('button', { name: 'Mark 1 · Box', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => {
      const m = (await draft()).marks[0].geometry;
      return m.kind === 'rect' ? { x: m.x, w: m.w } : null;
    })
    .toEqual({ x: 46, w: 236 });
  await fixture.getByRole('button', { name: 'Delete mark 1', exact: true }).click();
  await expect.poll(async () => (await draft()).marks.length).toBe(3);
  await expect(fixture.getByRole('textbox', { name: 'Note for mark 4', exact: true })).toHaveCount(
    0,
  );
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await draft()).marks.length).toBe(4);
  await expect.poll(async () => (await draft()).blurRegions.length).toBe(1);
  await expect(fixture.getByRole('textbox', { name: /Note for mark/ })).toHaveCount(4);
  await fixture.getByRole('textbox', { name: 'Text for mark 3', exact: true }).fill('Fix this');
  await fixture
    .getByRole('textbox', { name: 'Element selector for mark 4', exact: true })
    .fill('button.save');
  await fixture
    .getByRole('textbox', { name: 'Element text for mark 4', exact: true })
    .fill('Save changes');
  const hold = fixture.getByRole('button', {
    name: 'Hold to dictate note for mark 4',
    exact: true,
  });
  await hold.focus();
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await expect(fixture.getByRole('textbox', { name: 'Note for mark 4', exact: true })).toHaveValue(
    'Synthetic dictated note',
  );
  await info.attach('screenshot-editor-tools-and-notes', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expect(fixture.getByRole('button', { name: 'Retake', exact: true })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(fixture).not.toHaveAttribute('data-saved', '');
  const saved = JSON.parse((await fixture.getAttribute('data-saved')) ?? '{}') as DockMediaEdit;
  expect(saved.blurRegions).toHaveLength(1);
  expect(saved.marks[3].context).toMatchObject({ selector: 'button.save', text: 'Save changes' });
  expect(saved.marks[3].note).toBe('Synthetic dictated note');
  await expect(fixture.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await info.attach('screenshot-editor-saved-draft', {
    body: JSON.stringify({ syntheticSource: true, syntheticDictation: true, saved }, null, 2),
    contentType: 'application/json',
  });
  await info.attach('screenshot-editor-saved', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
