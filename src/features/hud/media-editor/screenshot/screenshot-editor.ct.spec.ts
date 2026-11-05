import { expect, test } from '../../../../test/ct-test';
import ScreenshotEditorHarness from './__fixtures__/ScreenshotEditorHarness.svelte';
import type { DockMediaEdit } from '$shared/dock-media-edit';

test('screenshot draft tools, notes, crop and retake share the shell transaction', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  const fixture = await mount(ScreenshotEditorHarness);
  const canvas = fixture.getByRole('application');
  const draft = async () =>
    JSON.parse((await fixture.getAttribute('data-draft')) ?? '{}') as DockMediaEdit;
  async function draw(tool: string, from: { x: number; y: number }, to: { x: number; y: number }) {
    await fixture.getByRole('button', { name: tool, exact: true }).click();
    const rect = await canvas.boundingBox();
    if (!rect) throw new Error('Screenshot canvas missing');
    const source = JSON.parse((await fixture.getAttribute('data-source')) ?? '{}');
    const crop = (await draft()).crop ?? { x: 0, y: 0, w: source.width, h: source.height };
    const at = (p: { x: number; y: number }) => ({
      x: rect.x + ((p.x - crop.x) / crop.w) * rect.width,
      y: rect.y + ((p.y - crop.y) / crop.h) * rect.height,
    });
    const a = at(from),
      b = at(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  }
  await expect(fixture.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await draw('Box', { x: 45, y: 55 }, { x: 280, y: 195 });
  await fixture
    .getByRole('textbox', { name: 'Note for mark 1', exact: true })
    .fill('Keep this card');
  await draw('Box', { x: 420, y: 250 }, { x: 630, y: 380 });
  await expect(
    fixture.getByRole('textbox', { name: 'Note for mark 2', exact: true }),
  ).toBeVisible();
  await fixture.getByRole('button', { name: 'Pointer', exact: true }).click();
  await fixture.getByRole('button', { name: 'Mark 1 · box', exact: true }).click();
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
  await expect.poll(async () => (await draft()).marks.length).toBe(1);
  await expect(fixture.getByRole('textbox', { name: 'Note for mark 2', exact: true })).toHaveCount(
    0,
  );
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await draft()).marks.length).toBe(2);
  await draw('Blur sensitive content', { x: 65, y: 100 }, { x: 250, y: 165 });
  await expect.poll(async () => (await draft()).blurRegions.length).toBe(1);
  await expect(fixture.getByRole('textbox', { name: /Note for mark/ })).toHaveCount(2);
  await draw('Text', { x: 300, y: 80 }, { x: 410, y: 120 });
  await fixture.getByRole('textbox', { name: 'Text for mark 3', exact: true }).fill('Fix this');
  await draw('Element', { x: 420, y: 250 }, { x: 630, y: 380 });
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
  await draw('Crop', { x: 0, y: 0 }, { x: 300, y: 220 });
  await expect.poll(async () => (await draft()).marks.length).toBe(1);
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await draft()).marks.length).toBe(4);
  await fixture.getByRole('button', { name: 'Retake', exact: true }).click();
  await expect(fixture).toHaveAttribute('data-source', /"width":600/);
  await expect.poll(async () => (await draft()).marks.length).toBe(2);
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(fixture).toHaveAttribute('data-source', /"width":800/);
  await expect.poll(async () => (await draft()).marks.length).toBe(4);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(fixture).not.toHaveAttribute('data-saved', '');
  const saved = JSON.parse((await fixture.getAttribute('data-saved')) ?? '{}') as DockMediaEdit;
  expect(saved.blurRegions).toHaveLength(1);
  expect(saved.marks[3].context).toMatchObject({ selector: 'button.save', text: 'Save changes' });
  expect(saved.marks[3].note).toBe('Synthetic dictated note');
  await expect(fixture.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await info.attach('screenshot-editor-saved-draft', {
    body: JSON.stringify(
      { syntheticSource: true, syntheticRetake: true, syntheticDictation: true, saved },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await info.attach('screenshot-editor-saved', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
