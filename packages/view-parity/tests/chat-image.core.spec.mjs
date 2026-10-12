import {
  test,
  expect,
  openImage,
  imageFile,
  dataUrl,
  button,
  field,
  output,
  frame,
  preview,
  imageNode,
  opener,
  options,
  dialog,
  placeholder,
  label,
  pick,
  apply,
  switchTo,
  choose,
  decoded,
  sameNode,
  captureImage,
  visibleImage,
  contained,
  hydrationReceipt,
  refresh,
  expectArtwork,
} from '../lib/chat-image.mjs';

const defaultAlt = label('chat_imageBlock_fromAgent_alt');

test('chat image I1 valid PNG and JPEG visibly decode and src wins over current data', async ({
  page,
}, info) => {
  const host = await openImage(page);
  const png = imageFile();
  const jpeg = imageFile(1);
  const replacement = imageFile(2);
  await expect(imageNode(host)).toHaveCount(0);
  await pick(page, host, png);
  await expect(imageNode(host)).toHaveCount(0);
  await apply(host);
  await expect(imageNode(host)).toHaveAttribute('src', dataUrl(png));
  await visibleImage(page, imageNode(host), 0, 'i1-png-content', info);
  const root = await preview(host).elementHandle();
  const image = await imageNode(host).elementHandle();
  await captureImage(page, frame(host), 'i1-before', info);
  await pick(page, host, jpeg, 'src');
  await expect(imageNode(host)).toHaveAttribute('src', dataUrl(png));
  await apply(host, 'src');
  await expect(imageNode(host)).toHaveAttribute('src', dataUrl(jpeg));
  await visibleImage(page, imageNode(host), 1, 'i1-jpeg-content', info);
  await pick(page, host, replacement);
  await apply(host);
  await expect(imageNode(host)).toHaveAttribute('src', dataUrl(jpeg));
  await decoded(imageNode(host), 1);
  await switchTo(host, 'Supply src', false);
  await expect(imageNode(host)).toHaveAttribute('src', dataUrl(replacement));
  await visibleImage(page, imageNode(host), 2, 'i1-current-data-content', info);
  await sameNode(root, preview(host));
  await sameNode(image, imageNode(host));
  await expect.poll(async () => (await refresh(host)).callbacks).toEqual([]);
  await captureImage(page, frame(host), 'i1-after', info);
});

test('chat image I2 positive integer sidecars reserve a contained aspect and omission restores legacy geometry', async ({
  page,
}, info) => {
  const host = await openImage(page);
  await pick(page, host, imageFile());
  await apply(host);
  await decoded(imageNode(host));
  const legacy = await opener(host, defaultAlt).boundingBox();
  expect(Math.abs(legacy.width - legacy.height)).toBeLessThanOrEqual(1);
  await captureImage(page, frame(host), 'i2-legacy-before', info);
  await field(host, 'Width value').fill('600');
  await field(host, 'Height value').fill('360');
  await choose(host, 'Width mode', 'value');
  await choose(host, 'Height mode', 'value');
  await decoded(imageNode(host));
  const sized = await opener(host, defaultAlt).boundingBox();
  expect(Math.abs(sized.width / sized.height - 600 / 360)).toBeLessThan(0.03);
  expect(sized.width).toBeGreaterThan(legacy.width);
  await contained(frame(host), info, 'i2-sidecar-controls');
  await visibleImage(page, imageNode(host), 0, 'i2-sidecar-visible', info);
  await captureImage(page, frame(host), 'i2-sidecar-after', info);
  // Each input targets the source's intrinsic-dimension eligibility, not decorative spacing.
  for (const width of ['0', '1.5']) {
    await field(host, 'Width value').fill(width);
    const fallback = await opener(host, defaultAlt).boundingBox();
    expect(Math.abs(fallback.width - fallback.height)).toBeLessThanOrEqual(1);
    expect(fallback.width).toBeLessThan(sized.width);
    await decoded(imageNode(host));
  }
  await field(host, 'Width value').fill('600');
  await choose(host, 'Height mode', 'omit');
  const omitted = await opener(host, defaultAlt).boundingBox();
  expect(Math.abs(omitted.width - omitted.height)).toBeLessThanOrEqual(1);
  await captureImage(page, frame(host), 'i2-omitted-after', info);
});

test('chat image I3 pointer Enter and Space open real lightbox and Escape restores opener focus', async ({
  page,
}, info) => {
  const host = await openImage(page);
  await pick(page, host, imageFile());
  await apply(host);
  await decoded(imageNode(host));
  await captureImage(page, frame(host), 'i3-before', info);
  for (const activation of ['pointer', 'Enter', 'Space']) {
    const trigger = opener(host, defaultAlt);
    if (activation === 'pointer') await trigger.click();
    else await trigger.press(activation);
    const surface = dialog(page);
    await expect(surface).toBeVisible();
    await expect(surface).toHaveAttribute('aria-modal', 'true');
    const content = surface.locator('img[data-media-lightbox-content]');
    await expect(content).toHaveAttribute('src', dataUrl(imageFile()));
    await visibleImage(page, content, 0, `i3-${activation}-content`, info);
    await expect(button(surface, label('ui_imageLightbox_close_ariaLabel'))).toBeFocused();
    await captureImage(page, surface, `i3-${activation}-dialog`, info);
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  expect((await refresh(host)).callbacks).toEqual([]);
  await captureImage(page, frame(host), 'i3-after', info);
});

test('chat image I4 hydration uses current callbacks and ordinary full props need a later open action', async ({
  page,
  loadingStates,
}, info) => {
  const host = await openImage(page);
  await choose(host, 'Alt mode', 'current');
  await field(host, 'Current alt').fill('Thumbnail requiring original');
  await choose(host, 'Width mode', 'value');
  await choose(host, 'Height mode', 'value');
  await choose(host, 'dataTruncated', 'true');
  await choose(host, 'dataIsThumbnail', 'true');
  await pick(page, host, imageFile());
  await apply(host);
  const alt = 'Thumbnail requiring original';
  await visibleImage(page, imageNode(host), 0, 'i4-thumbnail-content', info);
  const image = await imageNode(host).elementHandle();
  await expect(options(preview(host))).toHaveCount(0);
  await expect(opener(host, alt, true)).toHaveAttribute(
    'title',
    label('chat_imageBlock_thumbnail_tooltip'),
  );
  await captureImage(page, frame(host), 'i4-before', info);
  await opener(host, alt, true).click();
  await hydrationReceipt(host, 1, 0, { alt, dataTruncated: true, dataIsThumbnail: true });
  await expect(dialog(page)).toHaveCount(0);
  await choose(host, 'hydrationLoading', 'true');
  await button(host, 'Replace callbacks').click();
  await opener(host, alt, true).press('Enter');
  await hydrationReceipt(host, 2, 1, { alt, hydrationLoading: true });
  await expect(dialog(page)).toHaveCount(0);
  const loadingStart = loadingStates.length;
  await pick(page, host, imageFile(2));
  await apply(host, 'full');
  await sameNode(image, imageNode(host));
  await visibleImage(page, imageNode(host), 2, 'i4-full-content', info);
  await expect(preview(host).getByTestId('media-loading-placeholder')).toHaveCount(0);
  expect(
    loadingStates
      .slice(loadingStart)
      .filter((state) => state.oldValue === 'false' || state.value === 'false'),
    'A decoded thumbnail must stay revealed during an ordinary full-image replacement',
  ).toEqual([]);
  await expect(dialog(page)).toHaveCount(0);
  await expect(options(preview(host))).toHaveCount(1);
  await captureImage(page, frame(host), 'i4-replaced-before-open', info);
  await opener(host, alt).press('Space');
  await visibleImage(
    page,
    dialog(page).locator('img[data-media-lightbox-content]'),
    2,
    'i4-open-full',
    info,
  );
  await expect(options(dialog(page))).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect((await refresh(host)).callbacks).toHaveLength(2);
  await captureImage(page, frame(host), 'i4-after', info);
});

test('chat image I5 missing data placeholder follows loading and optional current hydration callback', async ({
  page,
}, info) => {
  const host = await openImage(page);
  await expect(imageNode(host)).toHaveCount(0);
  await expect(placeholder(host)).toHaveCount(0);
  await choose(host, 'dataTruncated', 'true');
  await expect(placeholder(host)).toBeEnabled();
  await expect(placeholder(host)).toHaveAccessibleName(
    label('chat_imageBlock_loadFullImage_ariaLabel', { alt: defaultAlt }),
  );
  await expectArtwork(placeholder(host).locator('svg'), 'faImage', info);
  await contained(frame(host), info, 'i5-placeholder-containment');
  await captureImage(page, frame(host), 'i5-before', info);
  await placeholder(host).press('Enter');
  await hydrationReceipt(host, 1, 0, { dataTruncated: true });
  await choose(host, 'hydrationLoading', 'true');
  await expect(placeholder(host)).toContainText(label('chat_imageBlock_loadingImage_label'));
  await button(host, 'Replace callbacks').click();
  await placeholder(host).press('Space');
  await hydrationReceipt(host, 2, 1, { dataTruncated: true, hydrationLoading: true });
  await expect(imageNode(host)).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  await switchTo(host, 'Supply onHydrate', false);
  await expect(placeholder(host)).toBeDisabled();
  expect((await refresh(host)).callbacks).toHaveLength(2);
  await captureImage(page, frame(host), 'i5-disabled', info);
  await switchTo(host, 'Supply onHydrate', true);
  await choose(host, 'hydrationLoading', 'omit');
  await placeholder(host).click();
  await hydrationReceipt(host, 3, 1, { dataTruncated: true });
  await choose(host, 'dataTruncated', 'omit');
  await expect(placeholder(host)).toHaveCount(0);
  await expect(preview(host).locator('button,img')).toHaveCount(0);
  await captureImage(page, frame(host), 'i5-empty-after', info);
  expect((await output(host, 'Chat image caller state')).suppliedProps).not.toContain(
    'dataTruncated',
  );
});
