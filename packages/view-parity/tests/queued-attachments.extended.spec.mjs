import {
  test,
  expect,
  openAttachments,
  attachmentExercise,
  captureAttachments,
  control,
  count,
  toggle,
  clearObservations,
  expectedCallback,
  expectCallbacks,
  expectDecoded,
  expectSameNode,
  expectAttachmentsContained,
  imageName,
  imageAlt,
  imageSource,
  fileTitle,
  defaultPrefix,
} from '../lib/queued-attachments.mjs';

test('queued attachments A4: current resolver and counts update without replacing surviving index slots', async ({
  page,
}, info) => {
  const item = attachmentExercise(await openAttachments(page));
  const first = await item.images.nth(0).elementHandle();
  const second = await item.images.nth(1).elementHandle();
  const initialImage = await item.images.nth(0).locator('img').elementHandle();
  try {
    await expectDecoded(item.images.nth(0).locator('img'));
    await captureAttachments(page, item.frame, 'resolver-before', info);
    await toggle(item, 'Return null image sources').click();
    await expect(item.frame.locator('img')).toHaveCount(0);
    await expectSameNode(first, item.images.nth(0));
    expect(await initialImage.evaluate((node) => node.isConnected)).toBe(false);
    await control(item, 'Replace image resolver').click();
    await expect(item.frame.getByTestId('queued-image-placeholder')).toHaveCount(3);
    await expectCallbacks(item, []);
    await toggle(item, 'Return null image sources').click();
    const decoded = item.images.nth(0).locator('img');
    await expect(decoded).toHaveAttribute('src', imageSource(1, 1));
    await expectDecoded(decoded);
    await expectSameNode(first, item.images.nth(0));
    const currentImage = await decoded.elementHandle();
    try {
      await control(item, 'Replace image resolver').click();
      await expect(decoded).toHaveAttribute('src', imageSource(1, 2));
      await expectDecoded(decoded);
      // A source change updates the mounted img, while null removes the img.
      expect(await decoded.evaluate((node, previous) => node === previous, currentImage)).toBe(
        true,
      );
    } finally {
      await currentImage.dispose();
    }
    await count(item, 'Image count', 5);
    await expect(item.images).toHaveCount(5);
    await expectSameNode(first, item.images.nth(0));
    await expectSameNode(second, item.images.nth(1));
    await expect(item.images.nth(0)).toHaveAccessibleName(imageName(0, 5));
    await expect(item.images.nth(4)).toHaveAccessibleName(imageName(4, 5));
    await expect(item.images.nth(4).locator('img')).toHaveAttribute('alt', imageAlt(4));
    await item.images.nth(4).press('Enter');
    const callbacks = [expectedCallback('image', 4, { resolverRevision: 2 })];
    await expectCallbacks(item, callbacks);
    await count(item, 'Image count', 1);
    await expect(item.images).toHaveCount(1);
    expect(await second.evaluate((node) => node.isConnected)).toBe(false);
    await expectSameNode(first, item.images.nth(0));
    await expect(item.images.nth(0)).toHaveAccessibleName(imageName(0, 1));
    await count(item, 'Image count', 3);
    await expect(item.images).toHaveCount(3);
    expect(await item.images.nth(1).evaluate((node, old) => node === old, second)).toBe(false);
    await expectSameNode(first, item.images.nth(0));
    await expectCallbacks(item, callbacks);
    await captureAttachments(page, item.frame, 'resolver-after', info);
  } finally {
    await Promise.all([first.dispose(), second.dispose(), initialImage.dispose()]);
  }
});

test('queued attachments A5: reorder block replacement and callback replacement preserve slot ownership', async ({
  page,
}, info) => {
  const item = attachmentExercise(await openAttachments(page));
  const image = await item.images.nth(0).elementHandle();
  const file = await item.files.nth(0).elementHandle();
  const callbacks = [];
  try {
    await captureAttachments(page, item.frame, 'identity-before', info);
    await toggle(item, 'Reverse block order').click();
    await expectSameNode(image, item.images.nth(0));
    await expectSameNode(file, item.files.nth(0));
    await expect(item.images.nth(0)).toHaveAccessibleName(imageName(0, 3));
    await expect(item.files.nth(0)).toHaveAccessibleName(`${defaultPrefix}-4.txt`);
    await item.images.nth(0).click();
    callbacks.push(expectedCallback('image', 0, { ordinal: 3 }));
    await item.files.nth(0).click();
    callbacks.push(expectedCallback('file', 0, { ordinal: 4 }));
    await expectCallbacks(item, callbacks);
    await control(item, 'Replace block identities').click();
    await expectSameNode(image, item.images.nth(0));
    await expectSameNode(file, item.files.nth(0));
    await item.images.nth(0).press('Enter');
    callbacks.push(expectedCallback('image', 0, { ordinal: 3, blockRevision: 1 }));
    await item.files.nth(0).press('Enter');
    callbacks.push(expectedCallback('file', 0, { ordinal: 4, blockRevision: 1 }));
    await expectCallbacks(item, callbacks);
    await control(item, 'Replace attachment callbacks').click();
    await expectSameNode(image, item.images.nth(0));
    await expectSameNode(file, item.files.nth(0));
    await item.images.nth(0).press('Space');
    callbacks.push(
      expectedCallback('image', 0, { ordinal: 3, blockRevision: 1, callbackRevision: 1 }),
    );
    await item.files.nth(0).press('Space');
    callbacks.push(
      expectedCallback('file', 0, { ordinal: 4, blockRevision: 1, callbackRevision: 1 }),
    );
    await expectCallbacks(item, callbacks);
    await captureAttachments(page, item.frame, 'identity-after', info);
  } finally {
    await Promise.all([image.dispose(), file.dispose()]);
  }
});

test('queued attachments A6: unmount and keyed remount detach old controls and use the current owner', async ({
  page,
}, info) => {
  const item = attachmentExercise(await openAttachments(page));
  const oldLeaf = await item.leaf.elementHandle();
  const oldImage = await item.images.nth(0).elementHandle();
  const oldFile = await item.files.nth(0).elementHandle();
  const callbacks = [];
  try {
    await captureAttachments(page, item.frame, 'mount-before', info);
    await item.images.nth(0).click();
    callbacks.push(expectedCallback('image', 0));
    await expectCallbacks(item, callbacks);
    await toggle(item, 'Mount queued attachments').click();
    await expect(item.leaf).toHaveCount(0);
    await expect(item.frame.getByRole('button')).toHaveCount(0);
    for (const old of [oldLeaf, oldImage, oldFile]) {
      expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    }
    await control(item, 'Replace block identities').click();
    await control(item, 'Replace attachment callbacks').click();
    await control(item, 'Replace image resolver').click();
    await toggle(item, 'Reverse block order').click();
    await count(item, 'Image count', 2);
    await count(item, 'File count', 2);
    await expectCallbacks(item, callbacks);
    await captureAttachments(page, item.frame, 'mount-absent', info);
    await toggle(item, 'Mount queued attachments').click();
    await expect(item.images).toHaveCount(2);
    await expect(item.files).toHaveCount(2);
    await expectDecoded(item.images.nth(0).locator('img'));
    await expect(item.images.nth(0).locator('img')).toHaveAttribute('src', imageSource(2, 1));
    await expect(item.images.nth(0)).toHaveAccessibleName(imageName(0, 2));
    const current = { ordinal: 2, blockRevision: 1, callbackRevision: 1, resolverRevision: 1 };
    await item.images.nth(0).press('Enter');
    callbacks.push(expectedCallback('image', 0, current));
    await item.files.nth(0).press('Space');
    callbacks.push(expectedCallback('file', 0, current));
    await expectCallbacks(item, callbacks);
    const mountedLeaf = await item.leaf.elementHandle();
    const mountedImage = await item.images.nth(0).elementHandle();
    const mountedFile = await item.files.nth(0).elementHandle();
    try {
      await control(item, 'Remount queued attachments').click();
      for (const old of [mountedLeaf, mountedImage, mountedFile]) {
        expect(await old.evaluate((node) => node.isConnected)).toBe(false);
      }
    } finally {
      await Promise.all([mountedLeaf.dispose(), mountedImage.dispose(), mountedFile.dispose()]);
    }
    await item.images.nth(0).press('Space');
    callbacks.push(expectedCallback('image', 0, { ...current, mountRevision: 1 }));
    await item.files.nth(0).press('Enter');
    callbacks.push(expectedCallback('file', 0, { ...current, mountRevision: 1 }));
    await expectCallbacks(item, callbacks);
    for (const old of [oldLeaf, oldImage, oldFile]) {
      expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    }
    await captureAttachments(page, item.frame, 'mount-after', info);
  } finally {
    await Promise.all([oldLeaf.dispose(), oldImage.dispose(), oldFile.dispose()]);
  }
});

test('queued attachments A7: narrow wrapping keeps every attachment named reachable and operable', async ({
  page,
}, info) => {
  const item = attachmentExercise(await openAttachments(page));
  await captureAttachments(page, item.frame, 'keyboard-before', info);
  await count(item, 'Image count', 8);
  await count(item, 'File count', 8);
  const prefix = '設計 résumé ' + 'unbroken'.repeat(12);
  await item.section.getByRole('textbox', { name: 'File name prefix', exact: true }).fill(prefix);
  await expect(item.images).toHaveCount(8);
  await expect(item.files).toHaveCount(8);
  for (let index = 0; index < 8; index += 1) {
    await expectDecoded(item.images.nth(index).locator('img'));
    await expect(item.images.nth(index)).toHaveAccessibleName(imageName(index, 8));
    await expect(item.files.nth(index)).toHaveAccessibleName(`${prefix}-${index + 1}.txt`);
    await expect(item.files.nth(index)).toHaveAttribute(
      'title',
      fileTitle(`${prefix}-${index + 1}.txt`),
    );
  }
  await expectAttachmentsContained(item.frame, info, 'keyboard-wrapped');
  await clearObservations(item);
  // The clear button is the actual last caller control before the leaf. Native
  // Tab must visit all sixteen attachment controls in source order.
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expect(item.images.nth(index)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  const callbacks = [expectedCallback('image', 7)];
  await expectCallbacks(item, callbacks);
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expect(item.files.nth(index)).toBeFocused();
  }
  await page.keyboard.press('Space');
  callbacks.push(expectedCallback('file', 7, { prefix }));
  await expectCallbacks(item, callbacks);
  // Returning through the wrap uses browser focus order, with no focus() calls.
  await page.keyboard.press('Shift+Tab');
  await expect(item.files.nth(6)).toBeFocused();
  await captureAttachments(page, item.frame, 'keyboard-after', info);
});
