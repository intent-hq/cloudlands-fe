import {
  test,
  expect,
  openAttachments,
  pngFile,
  textFile,
  metadata,
  output,
  button,
  field,
  frame,
  slot,
  viewName,
  thumbnailRemoveName,
  chipRemoveName,
  retryName,
  label,
  pick,
  switchTo,
  choose,
  clearLogs,
  expectDecoded,
  sameNode,
  expectCallbacks,
  callback,
  expectPropagation,
  captureAttachments,
} from '../lib/attachment-preview.mjs';

test('attachment preview AP1 real files keep same-name identities and remove exactly one slot', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const a = pngFile('shared.png');
  const b = pngFile('shared.png', 9, 13);
  const plain = textFile();
  await pick(page, host, [a, b, plain]);
  const expected = [metadata('local-1', a), metadata('local-2', b), metadata('local-3', plain)];
  await expect.poll(() => output(host, 'Local attachment files')).toEqual(expected);
  await expectDecoded(slot(host, 'local-1').getByRole('img'), 16, 10);
  await expectDecoded(slot(host, 'local-2').getByRole('img'), 9, 13);
  await expect(slot(host, 'local-3').getByRole('img')).toHaveCount(0);
  await expect(
    slot(host, 'local-3').getByRole('button', { name: chipRemoveName(), exact: true }),
  ).toBeVisible();
  const survivor = await slot(host, 'local-2').getByRole('img').elementHandle();
  await captureAttachments(page, frame(host), 'ap1-before-removal', info);
  await slot(host, 'local-1').hover();
  await button(slot(host, 'local-1'), thumbnailRemoveName(a.name)).click();
  await expect.poll(() => output(host, 'Local attachment files')).toEqual(expected.slice(1));
  await expect.poll(() => output(host, 'Removed attachment IDs')).toEqual(['local-1']);
  await expectCallbacks(host, [callback('remove', 'local-1')]);
  await expect(slot(host, 'local-1')).toHaveCount(0);
  await sameNode(survivor, slot(host, 'local-2').getByRole('img'));
  await expectDecoded(slot(host, 'local-2').getByRole('img'), 9, 13);
  await captureAttachments(page, frame(host), 'ap1-after-removal', info);
});

test('attachment preview AP2 real retained bytes take precedence over the current File', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const a = pngFile('original.png');
  const b = pngFile('replacement.png', 9, 13);
  await pick(page, host, [a]);
  const image = slot(host).getByRole('img');
  await expectDecoded(image);
  expect(await image.getAttribute('src')).toMatch(/^blob:/);
  await captureAttachments(page, frame(host), 'ap2-file-before', info);
  await button(host, 'Read selected file bytes').click();
  await expect
    .poll(async () => (await output(host, 'Selected attachment controls')).retainedData)
    .toEqual({
      name: a.name,
      size: a.buffer.length,
      mimeType: a.mimeType,
      base64Length: a.buffer.toString('base64').length,
    });
  await switchTo(host, 'Show replacement picker', true);
  await pick(page, host, [b], true);
  await expectDecoded(image, 9, 13);
  await switchTo(host, 'Supply retained imageData', true);
  await expect(image).toHaveAttribute(
    'src',
    `data:${a.mimeType};base64,${a.buffer.toString('base64')}`,
  );
  await expectDecoded(image);
  await captureAttachments(page, frame(host), 'ap2-retained-preference', info);
  await button(host, 'Read selected file bytes').click();
  await expect(image).toHaveAttribute(
    'src',
    `data:${b.mimeType};base64,${b.buffer.toString('base64')}`,
  );
  await expectDecoded(image, 9, 13);
  await switchTo(host, 'Supply retained image MIME type', false);
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expectDecoded(image, 9, 13);
  await switchTo(host, 'Supply selected File', false);
  await expect(slot(host).getByRole('img')).toHaveCount(0);
  await expect(button(slot(host), viewName(a.name))).toHaveCount(0);
  await switchTo(host, 'Supply retained image MIME type', true);
  await expectDecoded(image, 9, 13);
  await field(host, 'Attachment type').fill('text/plain');
  await expectDecoded(image, 9, 13);
  await button(host, 'Clear retained bytes').click();
  await expect(slot(host).getByRole('img')).toHaveCount(0);
  await expect.poll(async () => (await output(host, 'Attachment lifecycle')).readError).toBe('');
  await captureAttachments(page, frame(host), 'ap2-null-source', info);
  await switchTo(host, 'Supply selected File', true);
  await field(host, 'Attachment type').fill('image/png');
  await expectDecoded(image, 9, 13);
  const firstReturn = await image.getAttribute('src');
  await field(host, 'Attachment type').fill('text/plain');
  await expect(slot(host).getByRole('img')).toHaveCount(0);
  await field(host, 'Attachment type').fill('image/png');
  await expectDecoded(image, 9, 13);
  expect(await image.getAttribute('src')).toMatch(/^blob:/);
  expect(await image.getAttribute('src')).not.toBe(firstReturn);
  await captureAttachments(page, frame(host), 'ap2-same-file-return-after', info);
});

test('attachment preview AP3 public lightbox opens by pointer Enter Space and restores focus on Escape', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const file = pngFile();
  await pick(page, host, [file]);
  const opener = button(slot(host), viewName(file.name));
  await expectDecoded(slot(host).getByRole('img'));
  await captureAttachments(page, frame(host), 'ap3-closed-before', info);
  const dialog = page.getByRole('dialog', {
    name: label('ui_imageLightbox_preview_ariaLabel'),
    exact: true,
  });
  for (const activation of ['pointer', 'Enter', 'Space']) {
    if (activation === 'pointer') await opener.click();
    else await opener.press(activation);
    await expect(dialog).toBeVisible();
    await expectDecoded(dialog.getByRole('img', { name: file.name, exact: true }));
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    if (activation === 'pointer')
      await captureAttachments(page, dialog, 'ap3-open-public-lightbox', info);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
  await choose(host, 'Attachment variant', 'Chip');
  await expect(opener).toHaveCount(0);
  await expectDecoded(slot(host).getByRole('img'));
  await slot(host).getByRole('img').click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => output(host, 'Attachment callback log')).toEqual([]);
  await captureAttachments(page, frame(host), 'ap3-chip-after', info);
});

test('attachment preview AP4 current callback IDs and chip versus thumbnail propagation stay distinct', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const image = pngFile();
  await pick(page, host, [textFile(), image, textFile('retry.txt')]);
  await captureAttachments(page, frame(host), 'ap4-before-callbacks', info);
  await field(host, 'Attachment ID').fill('current-text-id');
  await button(host, 'Replace callbacks').click();
  await clearLogs(host);
  await slot(host).hover();
  await button(slot(host), chipRemoveName()).click();
  await expectCallbacks(host, [callback('remove', 'current-text-id', 'local-1', 1)]);
  await expectPropagation(host, { currentId: 'current-text-id', revision: 1, bubbles: true });
  await expect.poll(() => output(host, 'Removed attachment IDs')).toEqual(['current-text-id']);
  await clearLogs(host);
  await slot(host, 'local-2').hover();
  await button(slot(host, 'local-2'), thumbnailRemoveName(image.name)).click();
  await expectCallbacks(host, [callback('remove', 'local-2', 'local-2', 1)]);
  await expectPropagation(host, {
    currentId: 'local-2',
    slotId: 'local-2',
    revision: 1,
    bubbles: false,
  });
  await choose(host, 'Placement status', 'Failed');
  await switchTo(host, 'Retry callback enabled', true);
  await field(host, 'Attachment ID').fill('current-retry-id');
  await button(host, 'Replace callbacks').click();
  await clearLogs(host);
  const retry = button(slot(host, 'local-3'), retryName('retry.txt'));
  const retained = await retry.elementHandle();
  await retry.click();
  await expectCallbacks(host, [callback('retry', 'current-retry-id', 'local-3', 2)]);
  await expectPropagation(host, {
    currentId: 'current-retry-id',
    slotId: 'local-3',
    revision: 2,
    bubbles: false,
  });
  await sameNode(retained, retry);
  await captureAttachments(page, frame(host), 'ap4-retry-after', info);
});
