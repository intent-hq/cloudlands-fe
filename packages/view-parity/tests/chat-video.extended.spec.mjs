import {
  test,
  expect,
  openVideo,
  videoFile,
  posterFile,
  dataUrl,
  button,
  field,
  output,
  frame,
  preview,
  video,
  opener,
  options,
  dialog,
  label,
  pick,
  switchTo,
  choose,
  decoded,
  menuInfo,
  sameNode,
  detached,
  captureVideo,
  observePausedVideo,
  contained,
} from '../lib/chat-video.mjs';

test('chat video V6 current valid source and name replace media without remounting the preview', async ({
  page,
}, info) => {
  const host = await openVideo(page);
  const first = videoFile();
  const next = videoFile(1);
  await pick(page, host, first);
  await decoded(video(host));
  const root = await preview(host).elementHandle();
  const media = await video(host).elementHandle();
  const trigger = await opener(host, first.name).elementHandle();
  await captureVideo(page, frame(host), 'v6-before', info);
  await options(preview(host)).press('Enter');
  await menuInfo(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await pick(page, host, next);
  await decoded(video(host), 1);
  await sameNode(root, preview(host));
  await sameNode(media, video(host));
  await sameNode(trigger, opener(host, next.name));
  await expect(video(host)).toHaveAttribute('src', dataUrl(next));
  await field(host, 'Video name').fill('Current résumé video');
  await expect(opener(host, 'Current résumé video')).toBeVisible();
  await options(preview(host)).press('Enter');
  await menuInfo(page, 1);
  await captureVideo(page, page.getByRole('menu'), 'v6-current-metadata', info);
  await page.keyboard.press('Escape');
  await opener(host, 'Current résumé video').click();
  const surface = dialog(page, 'Current résumé video');
  await decoded(surface.getByTestId('chat-video-player'), 1);
  await expect(surface.getByTestId('chat-video-player')).toHaveAttribute(
    'aria-label',
    'Current résumé video',
  );
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(opener(host, 'Current résumé video')).toBeFocused();
  await captureVideo(page, frame(host), 'v6-after', info);
});

test('chat video V7 denied workspace and file sources expose no request or recovery action', async ({
  page,
  videoNetwork,
}, info) => {
  const host = await openVideo(page);
  await switchTo(host, 'Supply name', true);
  await field(host, 'Video name').fill('Denied local video');
  // Denial is active before a file-like URL is ever committed to the component.
  await switchTo(host, 'Supply allowFileMedia', true);
  await switchTo(host, 'Allow file media', false);
  await choose(host, 'Source kind', 'workspace');
  const denied = [
    'workspace-file://no-access/__chat-video-denied__/clip.webm',
    'file:///__chat-video-denied__/clip.webm',
  ];
  const fallback = preview(host).getByTestId('media-unavailable');
  async function blocked() {
    await expect(fallback).toHaveAttribute('data-reason', 'load-failed');
    await expect(
      fallback.getByText(label('ui_mediaUnavailable_loadFailed_description'), { exact: true }),
    ).toBeVisible();
    await expect(video(host)).toHaveCount(0);
    await expect(preview(host).locator('button,a,[href]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => output(host, 'Chat video link calls')).toEqual([]);
    expect(
      videoNetwork.requests.filter(({ url }) => url.includes('__chat-video-denied__')),
    ).toEqual([]);
  }
  await field(host, 'Source URL').fill(denied[0]);
  await button(host, 'Apply source').click();
  await blocked();
  await expect(fallback.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await captureVideo(page, frame(host), 'v7-allow-denied', info);
  // A supplied false callback also denies when allowFileMedia is omitted/default true.
  await switchTo(host, 'canOpenFile result', false);
  await switchTo(host, 'Supply canOpenFile callback', true);
  await switchTo(host, 'Supply allowFileMedia', false);
  await blocked();
  await button(host, 'Replace callbacks').click();
  await choose(host, 'Source kind', 'remote');
  await field(host, 'Source URL').fill(denied[1]);
  await button(host, 'Apply source').click();
  await blocked();
  await captureVideo(page, frame(host), 'v7-callback-denied', info);
  // Return to genuine selected embedded bytes before relaxing any admission input.
  const file = videoFile();
  await pick(page, host, file);
  await decoded(video(host));
  await expect(fallback).toHaveCount(0);
  await expect.poll(() => output(host, 'Chat video link calls')).toEqual([]);
  await captureVideo(page, frame(host), 'v7-embedded-return', info);
});

test('chat video V8 selected raster poster is admitted and rejected sources never become DOM posters', async ({
  page,
  videoNetwork,
}, info) => {
  const host = await openVideo(page);
  const file = videoFile();
  const poster = posterFile();
  await pick(page, host, file);
  await decoded(video(host));
  await expect(video(host)).not.toHaveAttribute('poster');
  await captureVideo(page, frame(host), 'v8-no-poster-before', info);
  await pick(page, host, poster, true);
  await expect(video(host)).toHaveAttribute('poster', dataUrl(poster));
  await opener(host, file.name).click();
  const surface = dialog(page, file.name);
  await decoded(surface.getByTestId('chat-video-player'));
  await expect(surface.getByTestId('chat-video-player')).toHaveAttribute('poster', dataUrl(poster));
  await captureVideo(page, surface, 'v8-admitted-dialog-poster', info);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  // These strings are rejected before DOM/network use; never supply allowed external HTTPS.
  const rejected = [
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,not valid base64',
    'http://poster.invalid/never-request.png',
    'https://user:password@poster.invalid/never-request.png',
    'workspace-file://no-access/__chat-video-denied__/poster.png',
    'file:///__chat-video-denied__/poster.png',
  ];
  for (const value of rejected) {
    await field(host, 'Poster URL').fill(value);
    await expect(video(host)).not.toHaveAttribute('poster');
    await decoded(video(host));
  }
  expect(
    videoNetwork.requests.filter(
      ({ url }) => url.includes('poster.invalid') || url.includes('__chat-video-denied__'),
    ),
  ).toEqual([]);
  await field(host, 'Poster URL').fill(dataUrl(poster));
  await expect(video(host)).toHaveAttribute('poster', dataUrl(poster));
  await switchTo(host, 'Supply poster', false);
  await expect(video(host)).not.toHaveAttribute('poster');
  await captureVideo(page, frame(host), 'v8-omitted-after', info);
});

test('chat video V9 omitted and current props retain valid embedded media and original default names', async ({
  page,
}, info) => {
  const host = await openVideo(page);
  const file = videoFile();
  await pick(page, host, file);
  await decoded(video(host));
  const media = await video(host).elementHandle();
  await captureVideo(page, frame(host), 'v9-supplied-before', info);
  await switchTo(host, 'Supply name', false);
  const defaultName = label('chat_videoBlock_fromAgent_label');
  await expect(opener(host, defaultName)).toBeVisible();
  await switchTo(host, 'Supply allowFileMedia', false);
  await switchTo(host, 'canOpenFile result', false);
  await switchTo(host, 'Supply canOpenFile callback', true);
  await decoded(video(host));
  await sameNode(media, video(host));
  await opener(host, defaultName).press('Enter');
  const surface = dialog(page, defaultName);
  await decoded(surface.getByTestId('chat-video-player'));
  await captureVideo(page, surface, 'v9-default-dialog', info);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await switchTo(host, 'Supply canOpenFile callback', false);
  await switchTo(host, 'Supply name', true);
  await field(host, 'Video name').fill('');
  await expect(opener(host, '')).toBeVisible();
  await field(host, 'Video name').fill('Current name after omitted props');
  await button(host, 'Replace callbacks').click();
  await expect(opener(host, 'Current name after omitted props')).toBeVisible();
  await expect.poll(() => output(host, 'Chat video link calls')).toEqual([]);
  await sameNode(media, video(host));
  await decoded(video(host));
  await captureVideo(page, frame(host), 'v9-current-after', info);
});

test('chat video V10 narrow keyboard controls remain reachable through settled mount lifetimes', async ({
  page,
}, info) => {
  const host = await openVideo(page);
  const file = videoFile(0, 'A very long résumé and 演示 video name for keyboard access.webm');
  await pick(page, host, file);
  await decoded(video(host));
  await opener(host, file.name).press('Tab');
  await expect(options(preview(host))).toBeFocused();
  await contained(frame(host), info, 'v10-preview-controls');
  await captureVideo(page, frame(host), 'v10-before', info);
  const root = await preview(host).elementHandle();
  const media = await video(host).elementHandle();
  await button(host, 'Remount video').click();
  await detached(root);
  await detached(media);
  await decoded(video(host));
  const remounted = await preview(host).elementHandle();
  await button(host, 'Unmount video').click();
  await detached(remounted);
  await expect(preview(host)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await button(host, 'Mount video').click();
  await decoded(video(host));
  await opener(host, file.name).press('Enter');
  const surface = dialog(page, file.name);
  await decoded(surface.getByTestId('chat-video-player'));
  await contained(surface, info, 'v10-dialog-controls');
  await captureVideo(page, surface, 'v10-remounted-dialog', info);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(opener(host, file.name)).toBeFocused();
  await captureVideo(page, frame(host), 'v10-after', info);
  // Settled DOM lifetimes only: no inference about cancelled reads/probes or resource release.
});

test('chat video V8 functional follow-up; paused image acceptance pending', async ({
  page,
  videoNetwork,
}, info) => {
  info.annotations.push({
    type: 'acceptance-pending',
    description: 'Functional evidence only; the original paused-image case remains unresolved.',
  });
  const host = await openVideo(page);
  const file = videoFile();
  const poster = posterFile();
  await pick(page, host, file);
  await decoded(video(host));
  await expect(video(host)).not.toHaveAttribute('poster');
  await captureVideo(page, frame(host), 'v8-no-poster-before', info);
  await pick(page, host, poster, true);
  await expect(video(host)).toHaveAttribute('poster', dataUrl(poster));
  await opener(host, file.name).click();
  const surface = dialog(page, file.name);
  await decoded(surface.getByTestId('chat-video-player'));
  await expect(surface.getByTestId('chat-video-player')).toHaveAttribute('poster', dataUrl(poster));
  await observePausedVideo(surface, 'v8-functional-admitted-dialog-poster', info);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  // These strings are rejected before DOM/network use; never supply allowed external HTTPS.
  const rejected = [
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,not valid base64',
    'http://poster.invalid/never-request.png',
    'https://user:password@poster.invalid/never-request.png',
    'workspace-file://no-access/__chat-video-denied__/poster.png',
    'file:///__chat-video-denied__/poster.png',
  ];
  for (const value of rejected) {
    await field(host, 'Poster URL').fill(value);
    await expect(video(host)).not.toHaveAttribute('poster');
    await decoded(video(host));
  }
  expect(
    videoNetwork.requests.filter(
      ({ url }) => url.includes('poster.invalid') || url.includes('__chat-video-denied__'),
    ),
  ).toEqual([]);
  await field(host, 'Poster URL').fill(dataUrl(poster));
  await expect(video(host)).toHaveAttribute('poster', dataUrl(poster));
  await switchTo(host, 'Supply poster', false);
  await expect(video(host)).not.toHaveAttribute('poster');
  await captureVideo(page, frame(host), 'v8-omitted-after', info);
});

test('chat video V9 functional follow-up; paused image acceptance pending', async ({
  page,
}, info) => {
  info.annotations.push({
    type: 'acceptance-pending',
    description: 'Functional evidence only; the original paused-image case remains unresolved.',
  });
  const host = await openVideo(page);
  const file = videoFile();
  await pick(page, host, file);
  await decoded(video(host));
  const media = await video(host).elementHandle();
  await captureVideo(page, frame(host), 'v9-supplied-before', info);
  await switchTo(host, 'Supply name', false);
  const defaultName = label('chat_videoBlock_fromAgent_label');
  await expect(opener(host, defaultName)).toBeVisible();
  await switchTo(host, 'Supply allowFileMedia', false);
  await switchTo(host, 'canOpenFile result', false);
  await switchTo(host, 'Supply canOpenFile callback', true);
  await decoded(video(host));
  await sameNode(media, video(host));
  await opener(host, defaultName).press('Enter');
  const surface = dialog(page, defaultName);
  await decoded(surface.getByTestId('chat-video-player'));
  await observePausedVideo(surface, 'v9-functional-default-dialog', info);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await switchTo(host, 'Supply canOpenFile callback', false);
  await switchTo(host, 'Supply name', true);
  await field(host, 'Video name').fill('');
  await expect(opener(host, '')).toBeVisible();
  await field(host, 'Video name').fill('Current name after omitted props');
  await button(host, 'Replace callbacks').click();
  await expect(opener(host, 'Current name after omitted props')).toBeVisible();
  await expect.poll(() => output(host, 'Chat video link calls')).toEqual([]);
  await sameNode(media, video(host));
  await decoded(video(host));
  await captureVideo(page, frame(host), 'v9-current-after', info);
});

test('chat video V10 functional follow-up; paused image acceptance pending', async ({
  page,
}, info) => {
  info.annotations.push({
    type: 'acceptance-pending',
    description: 'Functional evidence only; the original paused-image case remains unresolved.',
  });
  const host = await openVideo(page);
  const file = videoFile(0, 'A very long résumé and 演示 video name for keyboard access.webm');
  await pick(page, host, file);
  await decoded(video(host));
  await opener(host, file.name).press('Tab');
  await expect(options(preview(host))).toBeFocused();
  await contained(frame(host), info, 'v10-preview-controls');
  await captureVideo(page, frame(host), 'v10-before', info);
  const root = await preview(host).elementHandle();
  const media = await video(host).elementHandle();
  await button(host, 'Remount video').click();
  await detached(root);
  await detached(media);
  await decoded(video(host));
  const remounted = await preview(host).elementHandle();
  await button(host, 'Unmount video').click();
  await detached(remounted);
  await expect(preview(host)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await button(host, 'Mount video').click();
  await decoded(video(host));
  await opener(host, file.name).press('Enter');
  const surface = dialog(page, file.name);
  await decoded(surface.getByTestId('chat-video-player'));
  await contained(surface, info, 'v10-dialog-controls');
  await observePausedVideo(surface, 'v10-functional-remounted-dialog', info);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(opener(host, file.name)).toBeFocused();
  await captureVideo(page, frame(host), 'v10-after', info);
  // Settled DOM lifetimes only: no inference about cancelled reads/probes or resource release.
});
