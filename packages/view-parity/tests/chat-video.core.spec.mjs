import {
  test,
  expect,
  openVideo,
  videoFile,
  dataUrl,
  button,
  field,
  frame,
  preview,
  video,
  opener,
  options,
  dialog,
  label,
  pick,
  choose,
  decoded,
  readyForInitialVideoCapture,
  menuInfo,
  sameNode,
  captureVideo,
  expectArtwork,
  expectSourceArtwork,
} from '../lib/chat-video.mjs';

// Original003 is the oracle. The caller supplies inputs, never expected outcomes.
test('chat video V1 selected bytes produce genuine metadata and a decoded preview frame', async ({
  page,
  nativeMedia,
}, info) => {
  const host = await openVideo(page);
  await expect(preview(host)).toHaveCount(0);
  const file = videoFile();
  await pick(page, host, file);
  await expect(video(host)).toHaveAttribute('src', dataUrl(file));
  await decoded(video(host));
  await expect
    .poll(() =>
      nativeMedia.some(
        (event) => event.type === 'loadeddata' && event.src === dataUrl(file) && event.trusted,
      ),
    )
    .toBe(true);
  expect(
    await video(host).evaluate((node) => ({
      controls: node.controls,
      muted: node.muted,
      playsInline: node.playsInline,
      autoplay: node.autoplay,
      tabIndex: node.tabIndex,
      paused: node.paused,
    })),
  ).toEqual({
    controls: false,
    muted: true,
    playsInline: true,
    autoplay: false,
    tabIndex: -1,
    paused: true,
  });
  await expect(video(host)).toHaveAttribute('aria-hidden', 'true');
  await expect(opener(host, file.name)).toBeVisible();
  await expectSourceArtwork(opener(host, file.name).locator('svg').nth(0), 0, info);
  await expectSourceArtwork(opener(host, file.name).locator('svg').nth(1), 1, info);
  await captureVideo(page, frame(host), 'v1-decoded-before', info);
  await button(host, 'Use selected video').click();
  await decoded(video(host));
  await captureVideo(page, frame(host), 'v1-selected-return-after', info);
});

test('chat video V2 pointer lightbox exposes real playback and restores focus on close', async ({
  page,
  nativeMedia,
}, info) => {
  const host = await openVideo(page);
  const file = videoFile();
  await pick(page, host, file);
  await decoded(video(host));
  await captureVideo(page, frame(host), 'v2-closed-before', info);
  const trigger = opener(host, file.name);
  await trigger.click();
  const surface = dialog(page, file.name);
  const player = surface.getByTestId('chat-video-player');
  await expect(surface).toBeVisible();
  await decoded(player);
  expect(
    await player.evaluate((node) => ({
      controls: node.controls,
      autoplay: node.autoplay,
      paused: node.paused,
    })),
  ).toEqual({ controls: true, autoplay: false, paused: true });
  await expect(button(surface, label('chat_videoBlock_close_ariaLabel'))).toBeFocused();
  await expectArtwork(
    button(surface, label('chat_videoBlock_close_ariaLabel')).locator('svg'),
    'faXmark',
    info,
  );
  await readyForInitialVideoCapture(player, info);
  await captureVideo(page, surface, 'v2-open-before-play', info);
  // Native Chromium media keyboard handling; never call play(), assign time, or synthesize events.
  await player.press('Space');
  await expect
    .poll(() => player.evaluate((node) => node.currentTime > 0 && node.played.length > 0))
    .toBe(true);
  await expect
    .poll(() => nativeMedia.some((event) => event.type === 'playing' && event.trusted))
    .toBe(true);
  if (!(await player.evaluate((node) => node.paused))) await player.press('Space');
  await expect.poll(() => player.evaluate((node) => node.paused)).toBe(true);
  await captureVideo(page, surface, 'v2-native-playback-after', info);
  await button(surface, label('chat_videoBlock_close_ariaLabel')).click();
  await expect(surface).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await decoded(video(host));
  await captureVideo(page, frame(host), 'v2-closed-after', info);
});

test('chat video V3 Enter and Space open the dialog and Escape restores the real opener', async ({
  page,
}, info) => {
  const host = await openVideo(page);
  const file = videoFile();
  await pick(page, host, file);
  await decoded(video(host));
  const trigger = opener(host, file.name);
  const retained = await trigger.elementHandle();
  await captureVideo(page, frame(host), 'v3-before', info);
  for (const key of ['Enter', 'Space']) {
    await trigger.press(key);
    const surface = dialog(page, file.name);
    await expect(surface).toBeVisible();
    await decoded(surface.getByTestId('chat-video-player'));
    await expect(button(surface, label('chat_videoBlock_close_ariaLabel'))).toBeFocused();
    await captureVideo(page, surface, `v3-open-${key}`, info);
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await sameNode(retained, trigger);
  }
  await captureVideo(page, frame(host), 'v3-after', info);
});

test('chat video V4 keyboard menu reads actual duration dimensions and byte size', async ({
  page,
}, info) => {
  const host = await openVideo(page);
  const file = videoFile();
  await pick(page, host, file);
  await decoded(video(host));
  await captureVideo(page, frame(host), 'v4-before', info);
  await opener(host, file.name).press('Tab');
  const trigger = options(preview(host));
  await expect(trigger).toBeFocused();
  await expectSourceArtwork(trigger.locator('svg'), 'kebab', info);
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menuInfo(page);
  await expect(
    menu.getByRole('menuitem', { name: label('ui_videoActionsMenu_copyLink_label'), exact: true }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole('menuitem', { name: label('ui_videoActionsMenu_copyPath_label'), exact: true }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole('menuitem', { name: label('ui_videoActionsMenu_download_label'), exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await captureVideo(page, menu, 'v4-native-menu-info', info);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await captureVideo(page, frame(host), 'v4-after', info);
});

test('chat video V5 remote kind copies the real selected data URL through native clipboard paste', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const host = await openVideo(page);
  const file = videoFile();
  await pick(page, host, file);
  await choose(host, 'Source kind', 'remote');
  await expect(field(host, 'Source URL')).toHaveValue(dataUrl(file));
  await button(host, 'Apply source').click();
  await decoded(video(host));
  await captureVideo(page, frame(host), 'v5-before', info);
  await options(preview(host)).press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menuInfo(page);
  await page.keyboard.press('End');
  await expect(
    menu.getByRole('menuitem', { name: label('ui_videoActionsMenu_copyLink_label'), exact: true }),
  ).toBeFocused();
  await captureVideo(page, menu, 'v5-copy-link-menu', info);
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByText(label('ui_videoActionsMenu_linkCopied_label'), { exact: true }),
  ).toBeVisible();
  const paste = field(host, 'Source URL');
  await paste.fill('');
  await paste.press('ControlOrMeta+V');
  await expect(paste).toHaveValue(dataUrl(file));
  await expect(video(host)).toHaveAttribute('src', dataUrl(file));
  await captureVideo(page, frame(host), 'v5-after', info);
});
