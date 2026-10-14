import { expect, test } from '../../../../test/ct-test';
import TimeScrubber from '../TimeScrubber.svelte';

test('narrow scrubber keeps timestamps clear of the pointer track and supports keyboard seeking', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 420, height: 360 });
  const seeks: string[] = [];
  const component = await mount(TimeScrubber, {
    props: {
      minTime: '2026-01-01T00:00:00.000Z',
      currentTime: '2026-01-01T00:00:05.000Z',
      maxTime: '2026-01-01T00:00:10.000Z',
      isLive: false,
      onTimeChange: (time: string) => seeks.push(time),
      onGoLive: () => {},
    },
  });
  const slider = component.getByRole('slider');
  const track = component.locator('[data-slot="slider-track"]');
  await expect(slider).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await component.evaluate((root) => {
    const trackNode = root.querySelector('[data-slot="slider-track"]');
    if (!trackNode) throw new Error('Missing slider track');
    const track = trackNode.getBoundingClientRect();
    const hit = document.elementFromPoint(track.x + track.width / 2, track.y + track.height / 2);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const overlapping: string[] = [];
    while (walker.nextNode()) {
      const content = walker.currentNode.textContent?.trim();
      if (!content) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      const text = range.getBoundingClientRect();
      if (
        text.left < track.right &&
        text.right > track.left &&
        text.top < track.bottom &&
        text.bottom > track.top
      )
        overlapping.push(content);
    }
    return {
      client: root.clientWidth,
      scroll: root.scrollWidth,
      track: track.toJSON(),
      hit: hit === trackNode || trackNode.contains(hit),
      overlapping,
    };
  });
  await info.attach('narrow-scrubber-geometry', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  expect(geometry.hit).toBe(true);
  expect(geometry.overlapping).toEqual([]);
  await info.attach('narrow-scrubber', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await slider.focus();
  await page.keyboard.press('End');
  await expect.poll(() => seeks).toEqual(['2026-01-01T00:00:10.000Z']);
  await track.click({ position: { x: 1, y: 10 } });
  await expect.poll(() => seeks).toEqual(['2026-01-01T00:00:10.000Z', '2026-01-01T00:00:00.000Z']);
});
