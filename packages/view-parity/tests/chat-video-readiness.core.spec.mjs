import {
  test,
  expect,
  openVideo,
  videoFile,
  posterFile,
  pick,
  opener,
  dialog,
  decoded,
} from '../lib/chat-video.mjs';
import { waitForUnplayedNativeVideoControls } from '../lib/chat-video-native-readiness.mjs';

test('chat video native readiness can observe the same already-settled unplayed player twice', async ({
  page,
}, info) => {
  const host = await openVideo(page);
  const file = videoFile();
  await pick(page, host, file);
  await pick(page, host, posterFile(), true);
  await opener(host, file.name).press('Enter');
  const surface = dialog(page, file.name);
  const player = surface.getByTestId('chat-video-player');
  await decoded(player);
  const receipts = [];
  const evidence = {
    attach: async (name, attachment) => {
      receipts.push(JSON.parse(attachment.body));
      await info.attach(name, attachment);
    },
  };
  await waitForUnplayedNativeVideoControls(page, player, evidence, 'first-observation');
  await waitForUnplayedNativeVideoControls(page, player, evidence, 'already-settled');
  expect(receipts[1].backendNodeId).toBe(receipts[0].backendNodeId);
  expect(receipts[1].observation.reason).toBe('already settled');
  for (const receipt of receipts) {
    expect(receipt.cleanupErrors).toEqual([]);
    expect(receipt.observation.observersCleaned).toBe(true);
    expect(receipt.observation.after.media).toMatchObject({
      paused: true,
      currentTime: 0,
      played: [],
      controls: true,
      error: null,
    });
    expect(receipt.observation.after.panel).toMatchObject({
      connected: true,
      display: 'none',
      children: 0,
    });
  }
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(opener(host, file.name)).toBeFocused();
});
