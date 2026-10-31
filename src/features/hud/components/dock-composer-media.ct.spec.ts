import type { Locator } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerMediaPreview from './dock-composer-media.preview.svelte';
import { readDictationIndicators } from './dock-composer-ct-helpers';
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

test('a missing permission marks the blocked control, whose click opens Settings instead of starting', async ({
  mount,
  page,
}, testInfo) => {
  const accessibility = 'Allow Accessibility in System Settings.';
  const component = await mount(ComposerMediaPreview, {
    props: {
      width: 420,
      state: { alerts: { annotate: accessibility, pick: accessibility } },
    },
  });
  // No separate settings button: the footer keeps exactly its four media controls.
  await expect(component.locator('[data-dock-media-footer] .controls button')).toHaveCount(4);
  const annotation = component.getByRole('button', {
    name: /^Annotate the screen\. Current tool:/,
  });
  await expect(annotation).toHaveAttribute('data-alert', '');
  await expect(annotation.locator('[data-dock-glyph="pencil"]')).toBeVisible();
  await expect(annotation.locator('.tool-alert-dot')).toBeVisible();
  // Hover opens the tools: pick shows the same error state with the permission line;
  // box, pen and arrow do not need Accessibility.
  await page.mouse.move(0, 0);
  await annotation.hover();
  const tools = page.getByRole('toolbar', { name: 'Annotation tools' });
  await expect(tools).toBeVisible();
  const pick = tools.getByRole('button', { name: 'Pick an element' });
  await expect(pick).toHaveAttribute('data-alert', '');
  await expect(tools.getByRole('button', { name: 'Box' })).not.toHaveAttribute('data-alert');
  await pick.hover();
  await expect(page.getByRole('tooltip')).toHaveText(accessibility);
  await page.screenshot({ path: testInfo.outputPath('dock-permission-error-state.png') });
  await testInfo.attach('dock-permission-error-state', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await pick.click();
  expect(await actions(component)).toEqual(['open-settings:pick']);
  // With pick current, the annotate click opens Settings instead of starting.
  await annotation.click();
  expect(await actions(component)).toEqual(['open-settings:pick', 'open-settings:annotate']);
  await page.mouse.move(0, 0);
  await annotation.hover();
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: 'Box' }).click();
  expect(await actions(component)).toEqual([
    'open-settings:pick',
    'open-settings:annotate',
    'tool:box',
  ]);
});

test('unavailable annotation exposes the supplied explanation without opening tools or settings', async ({
  mount,
  page,
}) => {
  const notice = 'The screen could not be checked for annotation.';
  const component = await mount(ComposerMediaPreview, {
    props: {
      state: { annotationDisabled: true },
      annotationNotice: notice,
    },
  });
  const annotation = component.getByRole('button', {
    name: /^Annotate the screen\. Current tool:/,
  });
  await expect(annotation).toBeDisabled();
  const box = await annotation.boundingBox();
  if (!box) throw new Error('Missing annotation button bounds');
  // A disabled button's tooltip wrapper receives the user's pointer even when
  // the button itself cannot receive clicks.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText(notice);
  await expect(page.getByRole('toolbar', { name: 'Annotation tools' })).toHaveCount(0);
  expect(await actions(component)).toEqual([]);
});

test('annotation picker supports keyboard tool selection and returns focus', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview);
  const trigger = component.getByRole('button', {
    name: 'Annotate the screen. Current tool: Pick an element',
  });
  await trigger.focus();
  await trigger.press('Space');
  const picker = page.getByRole('toolbar', { name: 'Annotation tools' });
  await expect(picker.getByRole('button', { name: 'Pick an element', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(picker.getByRole('button', { name: 'Box', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await actions(component)).toEqual(['tool:box']);
  const updated = component.getByRole('button', { name: 'Annotate the screen. Current tool: Box' });
  await expect(updated).toBeFocused();
  await expect(updated).toHaveAttribute('aria-pressed', 'true');
  await updated.press('ArrowUp');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(updated).toBeFocused();
  expect(await actions(component)).toEqual(['tool:box']);
});

test('hover tool selection preserves the editing caret and does not toggle twice', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerMediaPreview);
  const editor = component.getByRole('textbox');
  await editor.fill('A draft with a caret');
  const trigger = component.getByRole('button', { name: /^Annotate the screen\. Current tool:/ });
  await trigger.hover();
  const picker = page.getByRole('toolbar', { name: 'Annotation tools' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Arrow', exact: true }).hover();
  await picker.getByRole('button', { name: 'Arrow', exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('A draft with a caret');
  expect(await actions(component)).toEqual(['tool:arrow']);
  await trigger.click();
  expect(await actions(component)).toEqual(['tool:arrow', 'annotation-toggle']);
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
  await first.hover();
  await first.getByRole('button', { name: 'Remove', exact: true }).click();
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
  await tile.hover();
  await tile.getByRole('button', { name: 'Retry', exact: true }).click();
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
  await tile.hover();
  await tile.getByRole('button', { name: 'Retry', exact: true }).click();
  expect(await actions(component)).toEqual(['retry:failed-file']);
  await expect(tile).toBeVisible();
  await expect(tile.getByRole('alert')).toHaveText('Upload interrupted');
});

test('annotation long press opens tools without starting a session', async ({ mount, page }) => {
  const component = await mount(ComposerMediaPreview);
  const trigger = component.getByRole('button', { name: /^Annotate the screen\. Current tool:/ });
  await trigger.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 8, button: 0 });
  await expect(page.getByRole('toolbar', { name: 'Annotation tools' })).toBeVisible();
  await trigger.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 8, button: 0 });
  await trigger.dispatchEvent('click');
  expect(await actions(component)).toEqual([]);
  await page
    .getByRole('toolbar', { name: 'Annotation tools' })
    .getByRole('button', { name: 'Pen', exact: true })
    .click();
  expect(await actions(component)).toEqual(['tool:pen']);
});

for (const mode of [
  'idle',
  'captured',
  'annotate-hovered',
  'annotating',
  'dictating',
  'recording',
] as const) {
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
      component.getByRole('button', { name: /^Annotate the screen\. Current tool:/ }),
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
    if (mode === 'annotate-hovered') {
      await controls[2].hover();
      // Exercise the production body-level popup owner while the surrounding app
      // is light. The attached screenshot is the palette review, not a color oracle.
      const portal = page.locator(
        '[data-dock-conversation-portals][data-workspace-id="composer-media-preview"]',
      );
      const tools = portal.getByRole('toolbar', { name: 'Annotation tools' });
      await expect(tools).toBeVisible();
      await expect
        .poll(async () => {
          const box = await tools.boundingBox();
          const regions = JSON.parse(
            (await component.getAttribute('data-popup-regions')) ?? '[]',
          ) as { x: number; y: number; width: number; height: number }[];
          return (
            !!box &&
            regions.some(
              (region) =>
                box.x + box.width / 2 >= region.x &&
                box.x + box.width / 2 <= region.x + region.width &&
                box.y + box.height / 2 >= region.y &&
                box.y + box.height / 2 <= region.y + region.height,
            )
          );
        })
        .toBe(true);
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
