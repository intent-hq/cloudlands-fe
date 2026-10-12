import {
  test,
  expect,
  openAttachments,
  pngFile,
  textFile,
  output,
  button,
  field,
  frame,
  slot,
  leaf,
  viewName,
  chipRemoveName,
  thumbnailRemoveName,
  retryName,
  failedTitle,
  percent,
  pick,
  switchTo,
  choose,
  clearLogs,
  expectDecoded,
  sameNode,
  detached,
  expectCallbacks,
  callback,
  expectArtwork,
  captureAttachments,
  contained,
} from '../lib/attachment-preview.mjs';

test('attachment preview AP5 placement states clamp progress omit optional controls and preserve thumbnail priority', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const file = textFile();
  await pick(page, host, [file]);
  await captureAttachments(page, frame(host), 'ap5-omitted-before', info);
  await expect(leaf(host)).not.toHaveAttribute('data-placement-status');
  await expect(leaf(host)).not.toHaveAttribute('title');
  await switchTo(host, 'Remove callback enabled', false);
  await expect(slot(host).getByRole('button')).toHaveCount(0);
  await choose(host, 'Placement status', 'Placing');
  await expect(leaf(host)).toHaveAttribute('data-placement-status', 'placing');
  const progress = slot(host).getByTestId('attachment-upload-progress');
  await expect(progress).toHaveCount(0);
  for (const value of [-0.5, 0.425, 1.5]) {
    await field(host, 'Placement progress').fill(String(value));
    await expect(progress).toHaveText(percent(value));
  }
  await field(host, 'Placement progress').fill('');
  await expect(progress).toHaveCount(0);
  await choose(host, 'Placement status', 'Failed');
  await expect(leaf(host)).toHaveAttribute('title', failedTitle(file.name));
  await expect(progress).toHaveCount(0);
  await expect(slot(host).getByTestId('attachment-retry')).toHaveCount(0);
  await field(host, 'Placement failure detail').fill('Local placement failed');
  await expect(leaf(host)).toHaveAttribute(
    'title',
    failedTitle(file.name, 'Local placement failed'),
  );
  await switchTo(host, 'Retry callback enabled', true);
  await expect(button(slot(host), retryName(file.name))).toBeVisible();
  await expectArtwork(leaf(host).locator(':scope > svg').first(), 'faCircleExclamation', info);
  await expectArtwork(
    button(slot(host), retryName(file.name)).locator('svg'),
    'faRotateRight',
    info,
  );
  await captureAttachments(page, frame(host), 'ap5-failure-state', info);
  await choose(host, 'Placement status', 'Placed');
  await expect(leaf(host)).toHaveAttribute('data-placement-status', 'placed');
  await expect(leaf(host)).not.toHaveAttribute('title');
  await expect(slot(host).getByTestId('attachment-retry')).toHaveCount(0);
  await expectArtwork(leaf(host).locator(':scope > svg').first(), 'faFileAlt', info);
  await switchTo(host, 'Show replacement picker', true);
  await pick(page, host, [pngFile()], true);
  await field(host, 'Attachment type').fill('image/png');
  await choose(host, 'Attachment variant', 'Thumbnail');
  await choose(host, 'Placement status', 'Failed');
  await expectDecoded(slot(host).getByRole('img'));
  await expect(button(slot(host), viewName(file.name))).toBeVisible();
  await expect(slot(host).getByTestId('attachment-retry')).toHaveCount(0);
  await expect(leaf(host)).not.toHaveAttribute('data-placement-status');
  await captureAttachments(page, frame(host), 'ap5-thumbnail-priority-after', info);
});

test('attachment preview AP6 original MIME decisions select canonical icon artwork and accessible names', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const file = textFile();
  await pick(page, host, [file]);
  await switchTo(host, 'Supply selected File', false);
  await captureAttachments(page, frame(host), 'ap6-original-text-before', info);
  // This table is derived from the immutable Svelte branch order. It is not
  // read from the candidate or the caller's metadata observations.
  for (const [type, definition] of [
    ['folder', 'faFolder'],
    ['image', 'faImage'],
    ['image/png', 'faImage'],
    ['text/javascript', 'faFileCode'],
    ['application/typescript', 'faFileCode'],
    ['application/json', 'faFileCode'],
    ['text/plain', 'faFileAlt'],
    ['application/markdown', 'faFileAlt'],
    ['application/octet-stream', 'faFile'],
    ['', 'faFile'],
  ]) {
    await field(host, 'Attachment type').fill(type);
    await expectArtwork(leaf(host).locator(':scope > svg').first(), definition, info);
    await expect(slot(host).getByRole('img')).toHaveCount(0);
  }
  await expectArtwork(button(slot(host), chipRemoveName()).locator('svg'), 'faXmark', info);
  await switchTo(host, 'Show replacement picker', true);
  const image = pngFile();
  await pick(page, host, [image], true);
  await button(host, 'Read selected file bytes').click();
  await expect
    .poll(async () => (await output(host, 'Selected attachment controls')).retainedData?.name)
    .toBe(image.name);
  // With type omitted, an image MIME alone selects the image icon but no URL
  // until both bytes and MIME are supplied. Both conditions are public props.
  await expectArtwork(leaf(host).locator(':scope > svg').first(), 'faImage', info);
  await switchTo(host, 'Supply retained imageData', true);
  await choose(host, 'Attachment variant', 'Thumbnail');
  const name = '資料 preview.png';
  await field(host, 'Attachment name').fill(name);
  await expectDecoded(slot(host).getByRole('img', { name, exact: true }));
  await expect(button(slot(host), viewName(name))).toBeVisible();
  await expect(button(slot(host), viewName(name))).toHaveAttribute('title', name);
  await captureAttachments(page, frame(host), 'ap6-mime-fallback-after', info);
});

test('attachment preview AP7 stable slots retain nodes while replacement unmount and remount use current files', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const a = pngFile('first.png');
  const b = pngFile('second.png', 9, 13);
  await pick(page, host, [a]);
  await expectDecoded(slot(host).getByRole('img'));
  const wrapper = await slot(host).elementHandle();
  const root = await leaf(host).elementHandle();
  const image = await slot(host).getByRole('img').elementHandle();
  const opener = await button(slot(host), viewName(a.name)).elementHandle();
  await captureAttachments(page, frame(host), 'ap7-before-replacement', info);
  await field(host, 'Attachment ID').fill('replaced-id');
  await field(host, 'Attachment name').fill(b.name);
  await button(host, 'Replace callbacks').click();
  await switchTo(host, 'Show replacement picker', true);
  await pick(page, host, [b], true);
  await expectDecoded(slot(host).getByRole('img'), 9, 13);
  await sameNode(wrapper, slot(host));
  await sameNode(root, leaf(host));
  await sameNode(image, slot(host).getByRole('img'));
  await sameNode(opener, button(slot(host), viewName(b.name)));
  await button(host, 'Remount previews').click();
  await detached(root);
  await detached(image);
  await detached(opener);
  await sameNode(wrapper, slot(host));
  await expectDecoded(slot(host).getByRole('img'), 9, 13);
  await button(host, 'Unmount previews').click();
  await detached(wrapper);
  await expect(frame(host).locator('[data-attachment-slot]')).toHaveCount(0);
  await button(host, 'Mount previews').click();
  await expectDecoded(slot(host).getByRole('img'), 9, 13);
  await captureAttachments(page, frame(host), 'ap7-current-remounted-after', info);
  await clearLogs(host);
  await slot(host).hover();
  await button(slot(host), thumbnailRemoveName(b.name)).click();
  await expectCallbacks(host, [callback('remove', 'replaced-id', 'local-1', 1)]);
  await expect.poll(() => output(host, 'Local attachment files')).toEqual([]);
  await expect(frame(host).locator('[data-attachment-slot]')).toHaveCount(0);
  // Detached DOM establishes component lifetime only. Never fetch a revoked
  // URL or invent a revoke counter; native resource release is unverified.
  await info.attach('ap7-resource-limit.json', {
    body: JSON.stringify({
      objectUrlRevocation: 'static source review only',
      fileReaderDisposal: 'static caller review only',
    }),
    contentType: 'application/json',
  });
});

test('attachment preview AP8 long filenames keep retry and remove reachable by keyboard at 420', async ({
  page,
}, info) => {
  const host = await openAttachments(page);
  const name =
    'an-intentionally-long-local-attachment-name-that-must-leave-both-controls-operable.txt';
  await pick(page, host, [textFile(name)]);
  await choose(host, 'Placement status', 'Failed');
  await switchTo(host, 'Retry callback enabled', true);
  await clearLogs(host);
  await captureAttachments(page, frame(host), 'ap8-narrow-before', info);
  const retry = button(slot(host), retryName(name));
  const remove = button(slot(host), chipRemoveName());
  await button(host, 'Choose local attachments').focus();
  await page.keyboard.press('Tab');
  await expect(retry).toBeFocused();
  await contained(frame(host), info, 'ap8-retry-focus');
  await page.keyboard.press('Enter');
  await expectCallbacks(host, [callback('retry', 'local-1')]);
  await expect(retry).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await contained(frame(host), info, 'ap8-remove-focus');
  await captureAttachments(page, frame(host), 'ap8-narrow-after-retry', info);
  await page.keyboard.press('Space');
  await expectCallbacks(host, [callback('retry', 'local-1'), callback('remove', 'local-1')]);
  await expect(slot(host)).toHaveCount(0);
  await expect.poll(() => output(host, 'Removed attachment IDs')).toEqual(['local-1']);
});
