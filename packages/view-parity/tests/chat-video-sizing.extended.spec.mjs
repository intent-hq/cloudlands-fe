import {
  test,
  expect,
  openVideo,
  videoFile,
  posterFile,
  dataUrl,
  pick,
  video,
  opener,
  dialog,
  decoded,
  captureVideo,
} from '../lib/chat-video.mjs';

for (const [width, height] of [
  [12, 8],
  [320, 180],
]) {
  test(`chat video decoded sizing keeps native controls usable with ${width}x${height} poster`, async ({
    page,
  }, info) => {
    const host = await openVideo(page);
    const file = videoFile();
    const poster = posterFile(width, height);
    await pick(page, host, file);
    await pick(page, host, poster, true);
    await expect(video(host)).toHaveAttribute('poster', dataUrl(poster));
    const trigger = opener(host, file.name);
    await trigger.press('Enter');
    const surface = dialog(page, file.name);
    const player = surface.getByTestId('chat-video-player');
    await decoded(player);
    await expect(player).toHaveAttribute('poster', dataUrl(poster));
    await expect(player).toHaveAttribute('controls', '');
    await expect(player).not.toHaveAttribute('autoplay');
    await expect
      .poll(() =>
        player.evaluate((node) => {
          const { width, height } = node.getBoundingClientRect();
          return { width, height };
        }),
      )
      .toEqual({ width: 320, height: 180 });
    expect(await player.evaluate((node) => [node.paused, node.currentTime])).toEqual([true, 0]);
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await decoded(player);

    // Hit Chromium's visible native play/pause control, never invoke play() or
    // inject events. A decoded frame alone does not establish control usability.
    const bounds = await player.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds.x + 25, bounds.y + bounds.height - 48);
    await expect
      .poll(() => player.evaluate((node) => !node.paused && node.currentTime > 0))
      .toBe(true);
    await page.mouse.click(bounds.x + 25, bounds.y + bounds.height - 48);
    await expect
      .poll(() => player.evaluate((node) => node.paused && node.played.length > 0))
      .toBe(true);
    // This is a post-interaction capture. The original unplayed V8 identity
    // check stays separate and unchanged; its historical failure is not erased.
    await captureVideo(page, surface, `poster-${width}x${height}-native-paused`, info);
    // Chromium consumes Escape inside the focused native play button in both
    // renderers. Native reverse traversal leaves that control before dismissal.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Escape');
    await expect(surface).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
