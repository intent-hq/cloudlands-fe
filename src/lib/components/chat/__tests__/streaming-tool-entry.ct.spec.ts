import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import StreamingToolEntryHost from './StreamingToolEntryHost.svelte';

interface FrameSample {
  heights: number[];
  scrollTop: number;
  bottomDistance: number;
  anchorTop: number;
}

type SampledHost = HTMLElement & { entrySamples?: FrameSample[] };
type MotionWindow = Window & {
  entryAnimations?: { animation: Animation; duration: number; step: number }[];
};

function expectStableHeights(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((height, index) => expect(height).toBeCloseTo(expected[index], 2));
}

// Keep native animations running but advance their timeline ourselves. Svelte's
// tick transitions read WAAPI currentTime, which page.clock does not control.
// This exercises production geometry without racing a busy worker's wall clock.
async function controlRowMotion(page: Page) {
  await page.evaluate(() => {
    const state = window as MotionWindow;
    state.entryAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      const duration = animation.effect?.getTiming().duration;
      if (this.matches('[data-tool-entry]') && typeof duration === 'number' && duration > 0) {
        animation.playbackRate = 0;
        state.entryAnimations!.push({ animation, duration, step: 0 });
      }
      return animation;
    };
  });
}

async function startSampling(host: Locator) {
  await host.evaluate((element) => {
    const root = element as SampledHost;
    const scroll = root.querySelector<HTMLElement>('[data-testid="tool-entry-transcript"]')!;
    const anchor = root.querySelector<HTMLElement>('[data-testid="tool-entry-anchor"]')!;
    root.entrySamples = [];
    const sample = () => {
      root.entrySamples!.push({
        heights: Array.from(
          root.querySelectorAll('[data-tool-entry]'),
          (row) => row.getBoundingClientRect().height,
        ),
        scrollTop: scroll.scrollTop,
        bottomDistance: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        anchorTop: anchor.getBoundingClientRect().top,
      });
      for (const entry of (window as MotionWindow).entryAnimations ?? []) {
        if (entry.step >= 24 || entry.animation.playState === 'idle') continue;
        entry.step += 1;
        entry.animation.currentTime = (entry.duration * entry.step) / 24;
        if (entry.step === 24) {
          entry.animation.playbackRate = 1;
          entry.animation.finish();
        }
      }
      if (root.entrySamples!.length < 64) requestAnimationFrame(sample);
    };
    sample();
  });
}

async function finishSampling(host: Locator, page: Page) {
  await expect
    .poll(() => host.evaluate((root) => (root as SampledHost).entrySamples?.length))
    .toBe(64);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const samples = await host.evaluate((root) => (root as SampledHost).entrySamples!);
  expect(samples).toHaveLength(64);
  return samples;
}

async function expectBottomLocked(host: Locator) {
  await expect(host).toHaveAttribute('data-following', 'true');
  await expect
    .poll(() =>
      host
        .getByTestId('tool-entry-transcript')
        .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
    )
    .toBeLessThanOrEqual(2);
}

for (const grouped of [false, true]) {
  test(`grows a new ${grouped ? 'grouped' : 'top-level'} tool row while following the bottom`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await controlRowMotion(page);
    const host = await mount(StreamingToolEntryHost, { props: { grouped } });
    if (grouped) {
      const disclosure = host.getByTestId('response-group-disclosure');
      await disclosure.dispatchEvent('click');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect
        .poll(() =>
          host
            .locator('[data-operational-expanded-content]')
            .evaluate((node) => node.getAnimations().length),
        )
        .toBe(0);
    }
    await expectBottomLocked(host);
    await startSampling(host);
    await host.update({ props: { grouped, count: 3 } });
    const samples = await finishSampling(host, page);
    await test.info().attach('tool-entry-frames', {
      body: JSON.stringify({
        samples,
        animations: await page.evaluate(() =>
          (window as MotionWindow).entryAnimations?.map(({ duration, step }) => ({
            duration,
            step,
          })),
        ),
      }),
      contentType: 'application/json',
    });
    const finalHeight = samples.at(-1)!.heights[2];
    expect(finalHeight).toBeGreaterThan(10);
    for (const sample of samples)
      expectStableHeights(sample.heights.slice(0, 2), samples[0].heights);
    const intermediate = samples
      .map((sample) => sample.heights[2] ?? 0)
      .filter((height) => height > 1 && height < finalHeight - 1);
    expect(new Set(intermediate.map((height) => Math.round(height))).size).toBeGreaterThan(2);
    expect(
      Math.max(...samples.map((sample) => Math.abs(sample.bottomDistance))),
    ).toBeLessThanOrEqual(2);
    const scrollSteps = samples
      .slice(1)
      .map((sample, index) => Math.abs(sample.scrollTop - samples[index].scrollTop));
    expect(Math.max(...scrollSteps)).toBeLessThan(finalHeight * 0.8);
    expect(samples.at(-1)!.scrollTop - samples[0].scrollTop).toBeGreaterThan(finalHeight * 0.8);
    await expectBottomLocked(host);
  });
}

test('does not replay existing row entrances on mount, input updates, or stream completion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await controlRowMotion(page);
  const host = await mount(StreamingToolEntryHost);
  await startSampling(host);
  const mounted = await finishSampling(host, page);
  const initialHeights = mounted[0].heights;
  expect(initialHeights).toHaveLength(2);
  expect(Math.min(...initialHeights)).toBeGreaterThan(10);
  for (const sample of mounted) expectStableHeights(sample.heights, initialHeights);

  await startSampling(host);
  await host.update({ props: { count: 3 } });
  await finishSampling(host, page);
  await startSampling(host);
  await host.update({ props: { count: 3, revision: 1 } });
  const updated = await finishSampling(host, page);
  for (const sample of updated) expectStableHeights(sample.heights, updated[0].heights);

  await startSampling(host);
  await host.update({ props: { count: 3, revision: 1, isStreaming: false } });
  const completed = await finishSampling(host, page);
  for (const sample of completed) expectStableHeights(sample.heights, updated[0].heights);
  await expectBottomLocked(host);
});

test('keeps user scrollback fixed while new tool rows arrive', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await controlRowMotion(page);
  const host = await mount(StreamingToolEntryHost);
  await expectBottomLocked(host);
  await host.getByTestId('tool-entry-transcript').evaluate((node) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 }));
    node.scrollTop -= 240;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect(host).toHaveAttribute('data-following', 'false');
  await startSampling(host);
  await host.update({ props: { count: 3 } });
  const samples = await finishSampling(host, page);
  expect(samples.at(-1)!.heights).toHaveLength(3);
  expect(samples.at(-1)!.bottomDistance).toBeGreaterThan(samples[0].bottomDistance);
  for (const sample of samples) {
    expect(sample.scrollTop).toBeCloseTo(samples[0].scrollTop, 1);
    expect(sample.anchorTop).toBeCloseTo(samples[0].anchorTop, 1);
  }
  await expect(host).toHaveAttribute('data-following', 'false');
});

test('inserts a reduced-motion tool row immediately without intermediate heights', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await controlRowMotion(page);
  const host = await mount(StreamingToolEntryHost);
  await expectBottomLocked(host);
  await host.update({ props: { count: 3 } });
  await startSampling(host);
  const samples = await finishSampling(host, page);
  const finalHeight = samples.at(-1)!.heights[2];
  expect(finalHeight).toBeGreaterThan(10);
  for (const sample of samples) expect(sample.heights[2]).toBeCloseTo(finalHeight, 1);
  await expectBottomLocked(host);
});
