import type { Locator } from '@playwright/test';
import { activateHoverAction, expect, test } from '../../../test/ct-test';
import ComposerMediaPreview from './dock-composer-media.preview.svelte';
import { readDictationIndicators } from './dock-composer-ct-helpers';
import { expectDismissibleLayerArmed } from '../../../test/dismissible-layer';
import type { DockComposerAttachment } from './dock-composer-media-presentation';

async function actions(component: Locator): Promise<string[]> {
  return JSON.parse((await component.getAttribute('data-actions')) ?? '[]');
}

test('media controls request capture and recording without inventing confirmed state', async ({
  mount,
}) => {
  const component = await mount(ComposerMediaPreview);
  const editor = component.getByRole('textbox', { name: 'Message Main' });
  await editor.fill('Keep this draft');
  await component.getByRole('button', { name: 'Capture the screen', exact: true }).click();
  await component.getByRole('button', { name: 'Record the screen', exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('Keep this draft');
  expect(await actions(component)).toEqual(['capture', 'record']);
  await expect(component).toHaveAttribute('data-confirmed-recording', 'false');
  await expect(component).toHaveAttribute('data-confirmed-capture', '0');
  await expect(component.locator('[data-dock-media-attachments]')).toHaveCount(0);
});

test('screenshot modes open on hover, capture once with the chosen mode and keep the draft focused', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview);
  const editor = component.getByRole('textbox');
  await editor.fill('A draft with a caret');
  await component.getByRole('button', { name: 'Capture the screen', exact: true }).hover();
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  await expect(menu.getByRole('menuitemradio', { name: 'Full screen' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemradio', { name: 'Region' }).click();
  await expect(menu).toBeHidden();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('A draft with a caret');
  expect(await actions(component)).toEqual(['capture:region']);
  // The bar keeps the chosen mode: a click captures it again without the menu.
  const region = component.getByRole('button', { name: 'Capture a region', exact: true });
  await expect(region.locator('[data-dock-glyph="region"]')).toBeVisible();
  await region.click();
  expect(await actions(component)).toEqual(['capture:region', 'capture']);
});

test('a capture click whose press spans the menu opening still captures once', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview);
  const capture = component.getByRole('button', { name: 'Capture the screen', exact: true });
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  const box = (await capture.boundingBox())!;
  // The hover delay ends between press and release: the button must stay the same
  // element, or the browser sends the click to an ancestor and it is lost.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(menu).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => actions(component)).toEqual(['capture']);
  await expect(menu).toBeHidden();
  // Once: the closed menu left no second capture behind.
  expect(await actions(component)).toEqual(['capture']);
});

test('the open screenshot menu never locks the rest of the dock', async ({ mount, page }) => {
  const component = await mount(ComposerMediaPreview);
  await component.getByRole('button', { name: 'Capture the screen', exact: true }).hover();
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  await expect(menu).toBeVisible();
  await expectDismissibleLayerArmed(menu);
  // Another dock control takes the click directly while the picker menu is open.
  await component.getByRole('button', { name: 'Record the screen', exact: true }).click();
  expect(await actions(component)).toEqual(['record']);
});

test('screenshot modes support keyboard choice and return focus to the capture button', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview);
  const trigger = component.locator('.capture-button');
  await trigger.focus();
  await trigger.press('ArrowUp');
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  await expect(menu.getByRole('menuitemradio', { name: 'Full screen' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Window' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  expect(await actions(component)).toEqual(['capture:window']);
  const updated = component.locator('.capture-button');
  await expect(updated).toBeFocused();
  await updated.press('ArrowUp');
  await expect(menu.getByRole('menuitemradio', { name: 'Window' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(updated).toBeFocused();
  expect(await actions(component)).toEqual(['capture:window']);
});

test('without window and region capture the screenshot button stays a plain full-screen button', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview, {
    props: { state: { captureModesAvailable: false } },
  });
  const trigger = component.getByRole('button', { name: 'Capture the screen', exact: true });
  await expect(trigger).not.toHaveAttribute('aria-haspopup');
  await trigger.hover();
  await trigger.press('ArrowUp');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await trigger.click();
  expect(await actions(component)).toEqual(['capture']);
});

test('mic press and hold has one start and one release without a trailing toggle', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview);
  const mic = component.getByRole('button', { name: 'Dictate · hold to talk', exact: true });
  await mic.hover();
  await page.mouse.down();
  await expect.poll(() => actions(component)).toEqual(['dictation-hold-start']);
  // Pointer capture delivers the release even after leaving the control.
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect
    .poll(() => actions(component))
    .toEqual(['dictation-hold-start', 'dictation-hold-end']);
  await mic.click();
  expect(await actions(component)).toEqual([
    'dictation-hold-start',
    'dictation-hold-end',
    'dictation-toggle',
  ]);
});

test('image tiles expose markup, lightbox and keyboard removal through owned callbacks', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview, { props: { mode: 'captured' } });
  const tile = component.locator('[data-attachment-id="image-one"]');
  const image = tile.getByRole('button', { name: 'Screenshot with 0 marks. Open', exact: true });
  await image.focus();
  await tile.getByRole('button', { name: 'Mark up', exact: true }).click();
  expect(await actions(component)).toEqual(['markup:image-one']);
  await image.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Screenshot with 0 marks. Open' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveAttribute(
    'src',
    (await image.locator('img').getAttribute('src')) ?? '',
  );
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(image).toBeFocused();
  await image.press('Delete');
  await expect(component.locator('[data-dock-media-attachments]')).toHaveCount(0);
  expect(await actions(component)).toEqual(['markup:image-one', 'remove:image-one']);
});

test('several recordings are separate ordered tiles; removing one keeps the others', async ({
  mount,
}) => {
  const component = await mount(ComposerMediaPreview, {
    props: {
      items: [
        { kind: 'file', owner: 'attachment', id: 'file', name: 'layout-notes.txt' },
        { kind: 'clip', owner: 'evidence', id: 'clip-1', duration: '0:14', recording: false },
        { kind: 'clip', owner: 'evidence', id: 'clip-2', duration: '0:05', recording: false },
        {
          kind: 'image',
          owner: 'evidence',
          id: 'image',
          url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="96" height="62"/%3E',
          markCount: 2,
        },
      ],
    },
  });
  // Screenshots, then recordings in the order they were made, then files.
  expect(
    await component
      .locator('[data-attachment-id]')
      .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-attachment-id'))),
  ).toEqual(['image', 'clip-1', 'clip-2', 'file']);
  const first = component.locator('[data-attachment-id="clip-1"]');
  // The strip can still be sliding tiles into their sorted places, so activate the
  // hover-only action without a pointer the tile could move out from under. Watch the
  // strip, which outlives the removed tile.
  await activateHoverAction(
    first.getByRole('button', { name: 'Remove', exact: true }),
    component.locator('[data-dock-media-attachments]'),
    { requireChange: false },
  );
  expect(await actions(component)).toEqual(['remove:clip-1']);
  await expect(component.locator('[data-attachment-id="clip-2"]')).toBeVisible();
  await expect(component.locator('[data-attachment-id="image"]')).toBeVisible();
  await expect(component.locator('[data-attachment-id="file"]')).toBeVisible();
});

test('pending image previews retain removal and retry before restoring open and markup when ready', async ({
  mount,
  page,
}) => {
  const url =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="96" height="62"/%3E';
  const pending: DockComposerAttachment = {
    kind: 'image',
    owner: 'evidence',
    id: 'pending-image',
    url,
    markCount: 2,
    status: 'placing',
  };
  const component = await mount(ComposerMediaPreview, {
    props: {
      items: [
        pending,
        { kind: 'image', owner: 'evidence', id: 'no-preview', url: '', markCount: 0 },
      ],
    },
  });
  for (const id of ['pending-image', 'no-preview']) {
    const tile = component.locator(`[data-attachment-id="${id}"]`);
    await expect(tile.getByRole('status')).toBeVisible();
    await expect(tile.locator('img')).toHaveCount(0);
    await expect(tile.getByRole('button', { name: /Screenshot/ })).toHaveCount(0);
    await expect(tile.getByRole('button', { name: 'Mark up', exact: true })).toHaveCount(0);
  }
  const noPreview = component.locator('[data-attachment-id="no-preview"]');
  const removePending = noPreview.getByRole('button', { name: 'Remove', exact: true });
  await removePending.focus();
  await expect(removePending).toBeVisible();
  await removePending.press('Enter');
  await expect(noPreview).toHaveCount(0);
  expect(await actions(component)).toEqual(['remove:no-preview']);

  await component.update({
    props: { items: [{ ...pending, url: '', status: 'failed', error: 'Preview unavailable' }] },
  });
  const tile = component.locator('[data-attachment-id="pending-image"]');
  await expect(tile.getByRole('alert')).toBeVisible();
  await activateHoverAction(tile.getByRole('button', { name: 'Retry', exact: true }), tile, {
    requireChange: false,
  });
  expect(await actions(component)).toEqual(['remove:no-preview', 'retry:pending-image']);
  await expect(tile.getByRole('alert')).toBeVisible();
  await expect(tile.locator('img')).toHaveCount(0);

  // A controller acknowledgment supplies a usable preview. The production tile
  // restores its actions without creating another attachment or losing its ID.
  await component.update({ props: { items: [{ ...pending, status: undefined }] } });
  await expect(tile.getByRole('status')).toHaveCount(0);
  const open = tile.getByRole('button', { name: 'Screenshot with 2 marks. Open', exact: true });
  await open.focus();
  await open.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Screenshot with 2 marks. Open' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Mark up', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await actions(component)).toEqual([
    'remove:no-preview',
    'retry:pending-image',
    'markup:pending-image',
  ]);
  await open.focus();
  await open.press('Delete');
  await expect(tile).toHaveCount(0);
  expect(await actions(component)).toEqual([
    'remove:no-preview',
    'retry:pending-image',
    'markup:pending-image',
    'remove:pending-image',
  ]);
});

test('failed attachment keeps its error and requests retry without removing the tile', async ({
  mount,
}) => {
  const component = await mount(ComposerMediaPreview, {
    props: {
      items: [
        {
          kind: 'file',
          owner: 'attachment',
          id: 'failed-file',
          name: 'recording.webm',
          status: 'failed',
          error: 'Upload interrupted',
        },
      ],
    },
  });
  const tile = component.locator('[data-attachment-id="failed-file"]');
  await expect(tile.getByRole('alert')).toHaveText('Upload interrupted');
  await activateHoverAction(tile.getByRole('button', { name: 'Retry', exact: true }), tile, {
    requireChange: false,
  });
  expect(await actions(component)).toEqual(['retry:failed-file']);
  await expect(tile).toBeVisible();
  await expect(tile.getByRole('alert')).toHaveText('Upload interrupted');
});

for (const mode of ['idle', 'captured', 'annotating', 'dictating', 'recording'] as const) {
  test(`composer media ${mode} keeps all controls reachable at narrow width`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ComposerMediaPreview, { props: { mode, width: 320 } });
    const controls = [
      component.getByRole('button', { name: 'Capture the screen', exact: true }),
      component.getByRole('button', {
        name: mode === 'recording' ? 'Stop recording' : 'Record the screen',
        exact: true,
      }),
      component.getByRole('button', {
        name: mode === 'dictating' ? 'Stop dictating' : 'Dictate · hold to talk',
        exact: true,
      }),
      component.getByRole('button', { name: 'Send', exact: true }),
    ];
    const bounds = await component.boundingBox();
    if (!bounds) throw new Error('Missing composer bounds');
    let previousRight = bounds.x;
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      if (!box) throw new Error('Missing control bounds');
      expect(box.x).toBeGreaterThanOrEqual(previousRight);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      previousRight = box.x + box.width;
    }
    if (mode === 'dictating') {
      await expect(component.locator('[data-dock-dictation-time]')).toBeVisible();
      await expect
        .poll(() => readDictationIndicators(component))
        .toEqual({
          timerUnclipped: true,
          separate: true,
          usefulHistory: true,
        });
    }
    await testInfo.attach(`composer-media-${mode}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(await actions(component)).toEqual([]);
  });
}
