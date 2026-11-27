import { expect, test, wheelUntilScrolled } from '../../../../test/ct-test';
import ChatScrollUpHost from './ChatScrollUpHost.svelte';

// Scrolling slowly up a long chat loads older history pages above the reader.
// Each page must land without painting a frame where the transcript jumps and
// then snaps back on the next frame (the scroll-up flicker).

test.setTimeout(300_000);
test.use({ viewport: { width: 900, height: 1000 } });

interface FrameSample {
  rows: Record<string, number>;
}

const SLOW_WHEEL_STEPS = 200;
const SLOW_WHEEL_DELTA = -60;
/** Well past one wheel step, so ordinary scrolling never counts as a jump. */
const FLICKER_MIN_PX = 150;
const SNAP_BACK_WINDOW_FRAMES = 3;

/** Median on-screen movement of the rows painted in both frames. */
function frameShift(prev: FrameSample, cur: FrameSample): number | null {
  const shifts: number[] = [];
  for (const [id, top] of Object.entries(cur.rows)) {
    if (prev.rows[id] !== undefined) shifts.push(top - prev.rows[id]);
  }
  if (shifts.length === 0) return null;
  shifts.sort((a, b) => a - b);
  return shifts[Math.floor(shifts.length / 2)];
}

test('slow scroll up through older history never paints a jump that snaps back', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatScrollUpHost, { props: { total: 400, initialCount: 40 } });
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  await expect(component.locator('[data-message-id="m-399"]').first()).toBeVisible();
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(3);
  // The unloaded-history spacer is what makes each page restate the extent.
  await expect(component.getByTestId('chat-virtual-scrollback-spacer')).toBeAttached();

  // Sample once per frame, in the first task after the frame renders, so each
  // sample is what the frame painted.
  await viewport.evaluate((node) => {
    const samples: FrameSample[] = [];
    (window as unknown as { __frames: FrameSample[] }).__frames = samples;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const box = node.getBoundingClientRect();
      const rows: Record<string, number> = {};
      for (const row of node.querySelectorAll<HTMLElement>('[data-message-id]')) {
        const rect = row.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom < box.top || rect.top > box.bottom) continue;
        rows[row.dataset.messageId!] = rect.top - box.top;
      }
      samples.push({ rows });
      requestAnimationFrame(next);
    };
    const next = () => channel.port2.postMessage(0);
    requestAnimationFrame(next);
  });

  const oldestRenderedIndex = () =>
    viewport.evaluate((node) =>
      Math.min(
        ...[...node.querySelectorAll<HTMLElement>('[data-message-id]')].map((row) =>
          Number(row.dataset.messageId!.replace('m-', '')),
        ),
      ),
    );
  const startingOldest = await oldestRenderedIndex();
  for (let step = 0; step < SLOW_WHEEL_STEPS; step++) {
    await wheelUntilScrolled(viewport, { deltaY: SLOW_WHEEL_DELTA });
  }
  // The walk must actually have paged older history in above the reader.
  expect(await oldestRenderedIndex()).toBeLessThan(startingOldest - 5);

  const frames = await page.evaluate(
    () => (window as unknown as { __frames: FrameSample[] }).__frames,
  );
  const shifts = frames.slice(1).map((frame, i) => frameShift(frames[i], frame));
  const flickers: string[] = [];
  shifts.forEach((shift, i) => {
    if (shift === null || Math.abs(shift) < FLICKER_MIN_PX) return;
    for (let k = i + 1; k <= i + SNAP_BACK_WINDOW_FRAMES && k < shifts.length; k++) {
      const back = shifts[k];
      if (back === null || Math.sign(back) === Math.sign(shift)) continue;
      if (Math.abs(back) < FLICKER_MIN_PX) continue;
      flickers.push(
        `frame ${i + 1} moved ${shift.toFixed(0)}px; frame ${k + 1} moved back ${back.toFixed(0)}px`,
      );
      return;
    }
  });
  expect(flickers).toEqual([]);
});
