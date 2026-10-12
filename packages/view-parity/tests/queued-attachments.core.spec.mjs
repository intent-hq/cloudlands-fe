import {
  test,
  expect,
  openAttachments,
  attachmentExercise,
  captureAttachments,
  content,
  count,
  toggle,
  clearObservations,
  expectedCallback,
  expectCallbacks,
  expectParent,
  expectDecoded,
  expectAttachmentsContained,
  imageName,
  imageAlt,
  imageSource,
  fileTitle,
} from '../lib/queued-attachments.mjs';

test('queued attachments A1: content changes separate decoded images, placeholders and empty rows', async ({
  page,
}, info) => {
  const item = attachmentExercise(await openAttachments(page));
  await expect(item.images).toHaveCount(3);
  await expect(item.files).toHaveCount(4);
  for (let index = 0; index < 3; index += 1) {
    const image = item.images.nth(index).getByRole('img', { name: imageAlt(index), exact: true });
    await expectDecoded(image);
    await expect(image).toHaveAttribute('src', imageSource(index + 1));
    await expect(item.images.nth(index)).toHaveAccessibleName(imageName(index, 3));
  }
  await captureAttachments(page, item.frame, 'content-before', info);
  await content(item, 'empty');
  await expect(item.frame.getByRole('button')).toHaveCount(0);
  await expect(item.frame.locator('img')).toHaveCount(0);
  await content(item, 'images');
  await expect(item.images).toHaveCount(3);
  await expect(item.files).toHaveCount(0);
  await toggle(item, 'Return null image sources').click();
  await expect(item.frame.locator('img')).toHaveCount(0);
  await expect(item.frame.getByTestId('queued-image-placeholder')).toHaveCount(3);
  await captureAttachments(page, item.frame, 'content-placeholders', info);
  await content(item, 'files');
  await expect(item.images).toHaveCount(0);
  await expect(item.frame.getByTestId('queued-image-placeholder')).toHaveCount(0);
  await expect(item.files).toHaveCount(4);
  await content(item, 'mixed');
  await count(item, 'Image count', 0);
  await count(item, 'File count', 0);
  await expect(item.frame.getByRole('button')).toHaveCount(0);
  await expectCallbacks(item, []);
  await captureAttachments(page, item.frame, 'content-zero-after', info);
});

test('queued attachments A2: pointer Enter and Space deliver one original image block and real opener', async ({
  page,
}, info) => {
  const item = attachmentExercise(await openAttachments(page));
  const callbacks = [];
  const activations = [];
  await expectDecoded(item.images.nth(1).locator('img'));
  await captureAttachments(page, item.frame, 'image-activation-before', info);
  await clearObservations(item);
  // Target the nested real image, exercising currentTarget rather than target.
  await item.images.nth(1).locator('img').click();
  callbacks.push(expectedCallback('image', 1));
  activations.push({ kind: 'image', pointer: true });
  await expectCallbacks(item, callbacks);
  await expectParent(item, activations);
  expect((await item.state()).observations.parent.map(({ targetTag }) => targetTag)).toEqual([
    'IMG',
    'IMG',
    'IMG',
  ]);
  for (const [index, key] of [
    [0, 'Enter'],
    [2, 'Space'],
  ]) {
    await item.images.nth(index).press(key);
    callbacks.push(expectedCallback('image', index));
    activations.push({ kind: 'image', pointer: false });
    await expectCallbacks(item, callbacks);
    await expectParent(item, activations);
  }
  await toggle(item, 'Return null image sources').click();
  await expect(item.frame.locator('img')).toHaveCount(0);
  await item.images.nth(1).press('Space');
  callbacks.push(expectedCallback('image', 1));
  activations.push({ kind: 'image', pointer: false });
  await expectCallbacks(item, callbacks);
  await expectParent(item, activations);
  await captureAttachments(page, item.frame, 'image-activation-after', info);
});

test('queued attachments A3: files preserve current Unicode names and original blocks for native activation', async ({
  page,
}, info) => {
  const item = attachmentExercise(await openAttachments(page));
  await content(item, 'files');
  await captureAttachments(page, item.frame, 'file-activation-before', info);
  const prefix = '雪 résumé <literal>& quoted "report" — ' + 'long-name-'.repeat(6);
  await item.section.getByRole('textbox', { name: 'File name prefix', exact: true }).fill(prefix);
  for (let index = 0; index < 4; index += 1) {
    const name = `${prefix}-${index + 1}.txt`;
    await expect(item.files.nth(index)).toHaveAccessibleName(name);
    await expect(item.files.nth(index)).toHaveAttribute('title', fileTitle(name));
  }
  await expectAttachmentsContained(item.frame, info, 'long-file-names');
  await clearObservations(item);
  const callbacks = [];
  const activations = [];
  for (const [index, key] of [
    [1, null],
    [0, 'Enter'],
    [3, 'Space'],
  ]) {
    if (key) await item.files.nth(index).press(key);
    else
      await item.files
        .nth(index)
        .getByText(`${prefix}-${index + 1}.txt`, { exact: true })
        .click();
    callbacks.push(expectedCallback('file', index, { prefix }));
    activations.push({ kind: 'file', pointer: !key });
    await expectCallbacks(item, callbacks);
    await expectParent(item, activations);
  }
  await captureAttachments(page, item.frame, 'file-activation-after', info);
});
