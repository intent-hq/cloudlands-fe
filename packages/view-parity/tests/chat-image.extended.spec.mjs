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
  caption,
  label,
  pick,
  apply,
  switchTo,
  choose,
  decoded,
  sameNode,
  detached,
  captureImage,
  visibleImage,
  contained,
  menuInfo,
  captionInfo,
  pasteImage,
  waitClipboardImage,
  refresh,
} from '../lib/chat-image.mjs';

const defaultAlt = label('chat_imageBlock_fromAgent_alt');

test('chat image I6 real context menu copies PNG bytes that arrive through native paste', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const host = await openImage(page);
  await pick(page, host, imageFile());
  await apply(host);
  await visibleImage(page, imageNode(host), 0, 'i6-visible-before', info);
  await captureImage(page, frame(host), 'i6-before', info);
  await opener(host, defaultAlt).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await menuInfo(page);
  await captureImage(page, menu, 'i6-context-menu', info);
  await menu
    .getByRole('menuitem', { name: label('ui_imageActionsMenu_copyImage_label'), exact: true })
    .click();
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByText(label('ui_imageActionsMenu_imageCopied_label'), { exact: true }),
  ).toBeVisible();
  await waitClipboardImage(page, 0);
  await pasteImage(host, 0, 1, info);
  await expect(imageNode(host)).toHaveAttribute('src', dataUrl(imageFile()));
  expect((await refresh(host)).callbacks).toEqual([]);
  await captureImage(page, frame(host), 'i6-after', info);
});

test('chat image I7 preview and lightbox keyboard copy use current replacement bytes', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const host = await openImage(page);
  await pick(page, host, imageFile());
  await apply(host);
  await decoded(imageNode(host));
  const image = await imageNode(host).elementHandle();
  await captureImage(page, frame(host), 'i7-before', info);
  await opener(host, defaultAlt).press('ControlOrMeta+C');
  await expect(
    page.getByText(label('ui_imageActionsMenu_imageCopied_label'), { exact: true }),
  ).toBeVisible();
  await waitClipboardImage(page, 0);
  await pasteImage(host, 0, 1, info);
  await pick(page, host, imageFile(2));
  await apply(host);
  await sameNode(image, imageNode(host));
  await visibleImage(page, imageNode(host), 2, 'i7-current-content', info);
  await choose(host, 'Alt mode', 'current');
  await field(host, 'Current alt').fill('Current keyboard image');
  await opener(host, 'Current keyboard image').press('Enter');
  const surface = dialog(page);
  await expect(surface.locator('img[data-media-lightbox-content]')).toHaveAttribute(
    'alt',
    'Current keyboard image',
  );
  await visibleImage(
    page,
    surface.locator('img[data-media-lightbox-content]'),
    2,
    'i7-lightbox-content',
    info,
  );
  await options(surface).press('Enter');
  await menuInfo(page, 2);
  await captureImage(page, page.getByRole('menu'), 'i7-lightbox-menu', info);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(surface).toBeVisible();
  await button(surface, label('ui_imageLightbox_close_ariaLabel')).press('ControlOrMeta+C');
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(opener(host, 'Current keyboard image')).toBeFocused();
  await waitClipboardImage(page, 2);
  await pasteImage(host, 2, 2, info);
  expect((await refresh(host)).callbacks).toEqual([]);
  await captureImage(page, frame(host), 'i7-after', info);
});

test('chat image I8 file caption follows decoded metadata overflow and actual node lifetimes', async ({
  page,
}, info) => {
  const host = await openImage(page);
  const longAlt = 'Current résumé image with a deliberately long accessible description '.repeat(5);
  await choose(host, 'Variant', 'file');
  await choose(host, 'Alt mode', 'current');
  await field(host, 'Current alt').fill(longAlt);
  await pick(page, host, imageFile());
  await apply(host);
  await visibleImage(page, imageNode(host), 0, 'i8-file-image', info);
  await captionInfo(host);
  const title = caption(host).locator('span').first();
  expect(
    await title.evaluate((node) => node.scrollWidth > node.clientWidth && node.clientWidth > 0),
  ).toBe(true);
  await expect(title).toHaveAttribute('title', longAlt);
  await contained(frame(host), info, 'i8-long-caption-controls');
  await captureImage(page, frame(host), 'i8-overflow-before', info);
  const previousCaption = await title.elementHandle();
  const image = await imageNode(host).elementHandle();
  await field(host, 'Current alt').fill('Short');
  await expect(title).not.toHaveAttribute('title');
  await sameNode(previousCaption, title);
  await choose(host, 'Variant', 'default');
  await expect(caption(host)).toHaveCount(0);
  await detached(previousCaption);
  expect(await previousCaption.getAttribute('title')).toBeNull();
  await sameNode(image, imageNode(host));
  await field(host, 'Current alt').fill(longAlt);
  await choose(host, 'Variant', 'file');
  await expect(title).toHaveAttribute('title', longAlt);
  const remountedCaption = await title.elementHandle();
  await pick(page, host, imageFile(1));
  await apply(host);
  await visibleImage(page, imageNode(host), 1, 'i8-replacement-content', info);
  await captionInfo(host, 1);
  await expect(caption(host)).toContainText('JPEG');
  await sameNode(remountedCaption, title);
  await sameNode(image, imageNode(host));
  await captureImage(page, frame(host), 'i8-current-after', info);
  await button(host, 'Unmount image').click();
  await detached(remountedCaption);
  expect(await remountedCaption.getAttribute('title')).toBeNull();
  await expect(preview(host)).toHaveCount(0);
  await button(host, 'Mount image').click();
  await decoded(imageNode(host), 1);
  await expect(title).toHaveAttribute('title', longAlt);
  await captureImage(page, frame(host), 'i8-remounted', info);
});

test('chat image I9 omitted defaults current alt and absent hydration retain source behavior', async ({
  page,
}, info) => {
  const host = await openImage(page);
  await pick(page, host, imageFile());
  await apply(host);
  await decoded(imageNode(host));
  await expect(imageNode(host)).toHaveAttribute('alt', defaultAlt);
  await expect(caption(host)).toHaveCount(0);
  const image = await imageNode(host).elementHandle();
  await captureImage(page, frame(host), 'i9-default-before', info);
  await choose(host, 'Alt mode', 'empty');
  await expect(imageNode(host)).toHaveAttribute('alt', '');
  await expect(opener(host, '')).toHaveCount(1);
  await choose(host, 'Alt mode', 'current');
  await field(host, 'Current alt').fill('Current optional image');
  await choose(host, 'dataIsThumbnail', 'true');
  await switchTo(host, 'Supply onHydrate', false);
  await expect(options(preview(host))).toHaveCount(0);
  // Original source opens present thumbnail bytes when no hydration callback exists.
  await opener(host, 'Current optional image').press('Enter');
  await visibleImage(
    page,
    dialog(page).locator('img[data-media-lightbox-content]'),
    0,
    'i9-thumbnail-without-callback',
    info,
  );
  await expect(options(dialog(page))).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(opener(host, 'Current optional image')).toBeFocused();
  await choose(host, 'dataIsThumbnail', 'omit');
  await choose(host, 'dataTruncated', 'omit');
  await choose(host, 'hydrationLoading', 'omit');
  await choose(host, 'Variant', 'omit');
  await choose(host, 'Alt mode', 'omit');
  await expect(options(preview(host))).toHaveCount(1);
  await expect(imageNode(host)).toHaveAttribute('alt', defaultAlt);
  await sameNode(image, imageNode(host));
  const state = await output(host, 'Chat image caller state');
  for (const key of ['dataIsThumbnail', 'dataTruncated', 'hydrationLoading', 'variant', 'alt'])
    expect(state.suppliedProps).not.toContain(key);
  expect((await refresh(host)).callbacks).toEqual([]);
  await captureImage(page, frame(host), 'i9-after', info);
});

test('chat image I10 narrow controls and settled remounts retain usable image composition', async ({
  page,
}, info) => {
  const host = await openImage(page);
  await choose(host, 'Variant', 'file');
  await choose(host, 'Alt mode', 'long');
  await pick(page, host, imageFile());
  await apply(host);
  await decoded(imageNode(host));
  const alt = await imageNode(host).getAttribute('alt');
  await opener(host, alt).press('Tab');
  await expect(options(preview(host))).toBeFocused();
  await contained(frame(host), info, 'i10-narrow-before');
  await captureImage(page, frame(host), 'i10-before', info);
  const root = await preview(host).elementHandle();
  const image = await imageNode(host).elementHandle();
  await button(host, 'Remount image').click();
  await detached(root);
  await detached(image);
  await visibleImage(page, imageNode(host), 0, 'i10-remounted-content', info);
  await captionInfo(host);
  await opener(host, alt).press('Space');
  const surface = dialog(page);
  await visibleImage(
    page,
    surface.locator('img[data-media-lightbox-content]'),
    0,
    'i10-lightbox-content',
    info,
  );
  await contained(surface, info, 'i10-lightbox-controls');
  await captureImage(page, surface, 'i10-lightbox', info);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(opener(host, alt)).toBeFocused();
  await button(host, 'Unmount image').click();
  await expect(preview(host)).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  await button(host, 'Mount image').click();
  await decoded(imageNode(host));
  await contained(frame(host), info, 'i10-narrow-after');
  await captureImage(page, frame(host), 'i10-after', info);
  // Settled observable nodes only: error identities and pending-resource release remain unverified.
});
