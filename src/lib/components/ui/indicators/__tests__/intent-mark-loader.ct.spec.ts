import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import IntentMarkLoaderHost from './IntentMarkLoaderHost.svelte';

test.setTimeout(120_000);

async function seekLoop(root: Locator, time: number) {
  return root.evaluate((node, currentTime) => {
    const animation = node
      .getAnimations({ subtree: true })
      .find((item) => item.effect?.getTiming().iterations === Infinity)!;
    animation.pause();
    animation.currentTime = currentTime;
    return animation.effect!.getTiming().duration;
  }, time);
}

test('keeps one root and one loop through every directed handoff', async ({ mount }) => {
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'bloom', size: 128, playing: true },
  });
  const root = component.getByRole('status', { name: 'Loading' });
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await root.evaluate(
    (node) => ((window as typeof window & { markRoot?: Element }).markRoot = node),
  );

  for (const [from, to] of [
    ['bloom', 'pulse'],
    ['bloom', 'twist'],
    ['pulse', 'bloom'],
    ['pulse', 'twist'],
    ['twist', 'bloom'],
    ['twist', 'pulse'],
  ] as const) {
    await component.update({ props: { variant: from, size: 128, playing: true } });
    await expect(root).toHaveAttribute('data-motion-state', 'playing');
    await component.update({ props: { variant: to, size: 128, playing: true } });
    await expect(root).toHaveAttribute('data-motion-state', 'playing');
    const loops = await root.evaluate((node) =>
      node
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
        .map((animation) => ({
          playState: animation.playState,
          targetTag: (animation.effect as KeyframeEffect).target?.tagName,
          willChange: ((animation.effect as KeyframeEffect).target as HTMLElement | null)?.style
            .willChange,
        })),
    );
    expect(loops).toHaveLength(1);
    expect(loops.every(({ playState }) => playState === 'running')).toBe(true);
    expect(loops.every(({ targetTag }) => targetTag === 'DIV')).toBe(true);
    expect(loops.every(({ willChange }) => willChange === 'transform')).toBe(true);
    expect(
      await root.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect?.getTiming().iterations === Infinity).length,
      ),
    ).toBe(1);
  }

  expect(
    await root.evaluate(
      (node) => (window as typeof window & { markRoot?: Element }).markRoot === node,
    ),
  ).toBe(true);
});

for (const variant of ['pulse', 'bloom', 'twist'] as const) {
  test(`matches every ${variant} GIF frame, its hold time, and the loop boundary`, async ({
    mount,
    page,
  }, testInfo) => {
    const gif = await readFile(
      new URL(`../../../../../../test/fixtures/intent-mark/${variant}.gif`, import.meta.url),
    );
    const component = await mount(IntentMarkLoaderHost, {
      props: { variant, size: 256, playing: true, reference: true },
    });
    const root = component.getByRole('status');
    await expect(root).toHaveAttribute('data-motion-state', 'playing');
    await root.evaluate(async (node) => {
      const url = getComputedStyle(node.querySelector('[data-mark-sheet]')!).maskImage.slice(5, -2);
      const image = new Image();
      image.src = url;
      await image.decode();
    });
    const metadata = await page.evaluate(async (base64) => {
      const Decoder = (
        window as unknown as {
          ImageDecoder: new (options: { data: Uint8Array; type: string }) => {
            tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } };
            decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
            close(): void;
          };
        }
      ).ImageDecoder;
      const decoder = new Decoder({
        data: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
        type: 'image/gif',
      });
      await decoder.tracks.ready;
      const frames: Uint8ClampedArray[] = [];
      const durations: number[] = [];
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      for (let index = 0; index < decoder.tracks.selectedTrack.frameCount; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        context.clearRect(0, 0, 256, 256);
        context.drawImage(image, 0, 0);
        frames.push(context.getImageData(0, 0, 256, 256).data);
        durations.push(image.duration!);
        image.close();
      }
      decoder.close();
      (window as typeof window & { referenceFrames?: Uint8ClampedArray[] }).referenceFrames =
        frames;
      return { count: frames.length, durations };
    }, gif.toString('base64'));
    expect(new Set(metadata.durations)).toEqual(new Set([40_000]));
    expect(await seekLoop(root, 0)).toBe(
      metadata.durations.reduce((sum, duration) => sum + duration / 1000, 0),
    );
    let maximumDifference = 0;
    const compareFrame = async (frame: number, name?: string) => {
      const screenshot = await root.screenshot({
        animations: 'allow',
        ...(name ? { path: testInfo.outputPath(`${name}.png`) } : {}),
      });
      const difference = await page.evaluate(
        async ({ png, frame }) => {
          const expected = (window as typeof window & { referenceFrames: Uint8ClampedArray[] })
            .referenceFrames[frame];
          const image = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${png}`)).blob(),
          );
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          image.close();
          const actual = context.getImageData(0, 0, 256, 256).data;
          let max = 0;
          for (let pixel = 0; pixel < actual.length; pixel += 4) {
            // Remove the original GIF's white matte with mean RGB, retaining
            // coverage while allowing currentColor instead of its near-black ink.
            // This oracle never reads the generated masks or production keyframes.
            const gray = Math.round(
              (expected[pixel] + expected[pixel + 1] + expected[pixel + 2]) / 3,
            );
            for (let channel = 0; channel < 3; channel++)
              max = Math.max(max, Math.abs(actual[pixel + channel] - gray));
            max = Math.max(max, Math.abs(actual[pixel + 3] - 255));
          }
          return max;
        },
        { png: screenshot.toString('base64'), frame },
      );
      expect(difference, `${variant} frame ${frame}`).toBeLessThanOrEqual(1);
      maximumDifference = Math.max(maximumDifference, difference);
    };
    for (let index = 0; index < metadata.count; index++) {
      // Seek into the middle of each hold, not an interpolated or guessed pose.
      await seekLoop(root, index * 40 + 20);
      await compareFrame(
        index,
        index === Math.floor(metadata.count / 2) ? `${variant}-reference-frame` : undefined,
      );
    }
    // Check both sides of a row change and loop wrap, where an off-by-one index
    // or interpolated translation would expose a different cell (or an empty one).
    for (const [time, frame] of [
      [319.9, 7],
      [320.1, 8],
      [metadata.count * 40 - 0.1, metadata.count - 1],
      [metadata.count * 40 + 0.1, 0],
    ]) {
      await seekLoop(root, time);
      await compareFrame(frame);
    }
    if (variant === 'pulse') {
      await component.update({ props: { variant, size: 256, playing: false, reference: true } });
      await expect(root).toHaveAttribute('data-motion-state', 'neutral');
      await compareFrame(0, 'neutral-reference-frame');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await component.update({
        props: { variant: 'twist', size: 256, playing: true, reference: true },
      });
      await expect(root).toHaveAttribute('data-motion-state', 'neutral');
      await compareFrame(0);
    }
    const reportPath = testInfo.outputPath('pixel-comparison.json');
    await writeFile(
      reportPath,
      JSON.stringify({
        variant,
        frames: metadata.count,
        maximumDifference,
        size: await root.boundingBox(),
      }),
    );
    await testInfo.attach('pixel-comparison', {
      path: reportPath,
      contentType: 'application/json',
    });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2] as const) {
    test(`keeps square geometry and currentColor in ${theme} at ${zoom * 100}%`, async ({
      mount,
    }) => {
      const component = await mount(IntentMarkLoaderHost, {
        props: { theme, zoom, size: 128, playing: false },
      });
      const root = component.getByRole('status', { name: 'Loading' });
      await expect(component).toHaveAttribute('data-theme', theme);
      const box = await root.boundingBox();
      expect(box?.width).toBe(128 * zoom);
      expect(box?.height).toBe(128 * zoom);
      const colors = await root.evaluate((node) => ({
        color: getComputedStyle(node).color,
        contain: getComputedStyle(node).contain,
        ink: getComputedStyle(node.querySelector('[data-mark-sheet]')!).backgroundColor,
      }));
      expect(colors.ink).toBe(colors.color);
      expect(colors.contain).toBe('content');
    });
  }
}

test('does no continuous work for reduced motion or a hidden document', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'twist', size: 128, playing: true },
  });
  const root = component.getByRole('status', { name: 'Loading' });
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});
