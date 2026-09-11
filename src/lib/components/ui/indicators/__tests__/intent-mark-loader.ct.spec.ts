import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import IntentMarkLoaderHost from './IntentMarkLoaderHost.svelte';

test.setTimeout(120_000);

async function seekLoop(root: Locator, time: number) {
  return root.evaluate((node, currentTime) => {
    const animations = node
      .getAnimations({ subtree: true })
      .filter((item) => item.effect?.getTiming().iterations === Infinity);
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = currentTime;
    }
    return animations[0].effect!.getTiming().duration;
  }, time);
}

test('keeps one root and five vector strokes through every directed handoff', async ({ mount }) => {
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
        })),
    );
    expect(loops).toHaveLength(5);
    expect(loops.every(({ playState }) => playState === 'running')).toBe(true);
    expect(loops.every(({ targetTag }) => targetTag === 'path')).toBe(true);
    expect(
      await root.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect?.getTiming().iterations === Infinity).length,
      ),
    ).toBe(5);
  }

  expect(
    await root.evaluate(
      (node) => (window as typeof window & { markRoot?: Element }).markRoot === node,
    ),
  ).toBe(true);
});

test('freezes the filled Twist pose during a theme change in a handoff', async ({
  mount,
  page,
}) => {
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'twist', playing: true },
  });
  const root = component.getByRole('status');
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await seekLoop(root, 1600);
  const before = await root
    .locator('[data-mark-arm]')
    .first()
    .evaluate((path) => {
      const style = getComputedStyle(path);
      return {
        fill: style.fill,
        stroke: style.stroke,
        width: style.strokeWidth,
        d: style.getPropertyValue('d'),
      };
    });
  await root.evaluate((node) => {
    (window as typeof window & { frozenTwist?: Promise<unknown> }).frozenTwist = new Promise(
      (resolve) => {
        const observer = new MutationObserver(() => {
          const path = node.querySelector<SVGPathElement>(
            '[data-mark-layer="twist"] [data-mark-arm]',
          );
          if (!path || !node.querySelector('[data-mark-layer="pulse"]')) return;
          observer.disconnect();
          (node as SVGSVGElement).style.color = 'rgb(220, 180, 140)';
          const style = getComputedStyle(path);
          resolve({
            fill: style.fill,
            stroke: style.stroke,
            width: style.strokeWidth,
            d: style.getPropertyValue('d'),
          });
        });
        observer.observe(node, { childList: true });
      },
    );
  });
  await component.update({ props: { variant: 'pulse', playing: true } });
  const frozen = await page.evaluate(
    () => (window as typeof window & { frozenTwist: Promise<unknown> }).frozenTwist,
  );
  expect(frozen).toEqual(before);
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await component.update({ props: { variant: 'pulse', playing: false } });
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  const neutral = await root
    .locator('[data-mark-arm]')
    .first()
    .evaluate((path) => {
      const style = getComputedStyle(path);
      return {
        fill: style.fill,
        stroke: style.stroke,
        color: style.color,
        width: Number.parseFloat(style.strokeWidth),
      };
    });
  expect(neutral.fill).toBe('none');
  expect(neutral.stroke).toBe(neutral.color);
  expect(neutral.width).toBeGreaterThan(0);
});

test('resolves currentColor again when replaying cached Twist frames in another theme', async ({
  mount,
}) => {
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'twist', playing: true, theme: 'light' },
  });
  const root = component.getByRole('status');
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await seekLoop(root, 1600);
  const firstFill = await root
    .locator('[data-mark-arm]')
    .first()
    .evaluate((path) => getComputedStyle(path).fill);
  await component.update({ props: { variant: 'pulse', playing: true, theme: 'dark' } });
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await component.update({ props: { variant: 'twist', playing: true, theme: 'dark' } });
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await seekLoop(root, 1600);
  const replay = await root
    .locator('[data-mark-arm]')
    .first()
    .evaluate((path) => {
      const style = getComputedStyle(path);
      return { fill: style.fill, color: style.color };
    });
  expect(replay.fill).toBe(replay.color);
  expect(replay.fill).not.toBe(firstFill);
});

for (const variant of ['pulse', 'bloom', 'twist'] as const) {
  test(`matches every measured ${variant} source pose and the loop boundary`, async ({
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
    expect(metadata.count).toBe(variant === 'twist' ? 92 : 51);
    const duration = ((variant === 'twist' ? 110 : 61) * 1000) / 30;
    expect(await seekLoop(root, 0)).toBe(duration);
    const measurements: {
      frame: number;
      mean: number;
      iou: number;
      expectedArea: number;
      opaquePixels: number;
      coverageError: number;
      centroidError: number;
    }[] = [];
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
          let error = 0,
            intersection = 0,
            union = 0;
          let expectedArea = 0,
            actualArea = 0,
            opaquePixels = 0;
          const quadrants = Array.from({ length: 4 }, () => ({
            expectedArea: 0,
            actualArea: 0,
            expectedMoment: [0, 0],
            actualMoment: [0, 0],
          }));
          for (let pixel = 0; pixel < actual.length; pixel += 4) {
            // Remove the original GIF's white matte with mean RGB, retaining
            // coverage while allowing currentColor instead of its near-black ink.
            // This oracle never reads production geometry or keyframes.
            const gray = Math.round(
              (expected[pixel] + expected[pixel + 1] + expected[pixel + 2]) / 3,
            );
            error += Math.abs(actual[pixel] - gray);
            const expectedInk = (255 - gray) / 255,
              actualInk = (255 - actual[pixel]) / 255;
            expectedArea += expectedInk;
            actualArea += actualInk;
            const x = (pixel / 4) % 256,
              y = Math.floor(pixel / 4 / 256);
            const quadrant = quadrants[(x >= 128 ? 1 : 0) + (y >= 128 ? 2 : 0)];
            quadrant.expectedArea += expectedInk;
            quadrant.actualArea += actualInk;
            quadrant.expectedMoment[0] += x * expectedInk;
            quadrant.expectedMoment[1] += y * expectedInk;
            quadrant.actualMoment[0] += x * actualInk;
            quadrant.actualMoment[1] += y * actualInk;
            if (gray < 128) opaquePixels++;
            if (actual[pixel] < 128 && gray < 128) intersection++;
            if (actual[pixel] < 128 || gray < 128) union++;
          }
          return {
            mean: error / (256 * 256),
            iou: union ? intersection / union : 1,
            expectedArea,
            opaquePixels,
            coverageError: Math.abs(expectedArea - actualArea),
            // Measure each arm separately: palette coverage must not move a
            // whole-logo centroid simply by weighting distant fragments unevenly.
            centroidError: Math.max(
              ...quadrants.map((q) =>
                q.expectedArea > 1
                  ? q.actualArea > 0
                    ? Math.hypot(
                        ...q.expectedMoment.map(
                          (value, axis) =>
                            value / q.expectedArea - q.actualMoment[axis] / q.actualArea,
                        ),
                      )
                    : Infinity
                  : 0,
              ),
            ),
          };
        },
        { png: screenshot.toString('base64'), frame },
      );
      measurements.push({ frame, ...difference });
    };
    for (let index = 0; index < metadata.count; index++) {
      // The 25fps reference samples its 30fps source with floor(frame * 6/5).
      // Native SVG motion remains continuous between those reference samples.
      await seekLoop(root, (Math.floor((index * 6) / 5) * 1000) / 30);
      await compareFrame(
        index,
        index === Math.floor(metadata.count / 2) ? `${variant}-reference-frame` : undefined,
      );
    }
    for (const [time, frame] of [
      [duration - 0.1, 0],
      [duration + 0.1, 0],
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
        measurements,
        size: await root.boundingBox(),
      }),
    );
    await testInfo.attach('pixel-comparison', {
      path: reportPath,
      contentType: 'application/json',
    });
    for (const {
      frame,
      mean,
      iou,
      expectedArea,
      opaquePixels,
      coverageError,
      centroidError,
    } of measurements) {
      expect(mean, `${variant} frame ${frame}: mean channel error`).toBeLessThan(2.5);
      if (expectedArea >= 100 || opaquePixels === 0) {
        expect(iou, `${variant} frame ${frame}: silhouette overlap`).toBeGreaterThan(
          variant === 'pulse' ? 0.98 : 0.96,
        );
      } else {
        // Binary IoU is unstable for subpixel fragments: one edge pixel crossing
        // 50% coverage can dominate the score. Retain a much tighter pixel-error
        // limit here and independently bound ink loss and displacement instead.
        expect(mean, `${variant} frame ${frame}: fragment channel error`).toBeLessThan(0.05);
        expect(coverageError, `${variant} frame ${frame}: fragment ink area`).toBeLessThan(4);
        expect(centroidError, `${variant} frame ${frame}: fragment position`).toBeLessThan(0.5);
      }
    }
  });
}

for (const variant of ['pulse', 'bloom', 'twist'] as const) {
  test(`interpolates ${variant} vectors between reference frames without image or media requests`, async ({
    mount,
    page,
  }) => {
    const assetRequests: string[] = [];
    page.on('request', (request) => {
      if (['image', 'media'].includes(request.resourceType())) assetRequests.push(request.url());
    });
    const component = await mount(IntentMarkLoaderHost, {
      props: { variant, playing: true },
    });
    const root = component.getByRole('status');
    await expect(root).toHaveAttribute('data-motion-state', 'playing');
    const poses = [];
    for (const time of [500, 510, 520]) {
      await seekLoop(root, time);
      poses.push(
        await root
          .locator('[data-mark-arm]')
          .first()
          .evaluate((path) => {
            const style = getComputedStyle(path);
            return [style.transform, style.getPropertyValue('d'), style.strokeDasharray].join('|');
          }),
      );
    }
    expect(new Set(poses).size).toBe(3);
    expect(assetRequests).toEqual([]);
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
        ink: getComputedStyle(node.querySelector('[data-mark-arm]')!).stroke,
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
