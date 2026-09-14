import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import IntentMarkLoaderHost from './IntentMarkLoaderHost.svelte';

test.setTimeout(120_000);

interface PoseLogWindow extends Window {
  markPoseLog?: Array<{ transform: string; x: number; y: number }>;
}

/**
 * Records the first arm's screen-space path start every time the pose driver
 * writes it, so the last driven pose is known even though the driver keeps
 * moving at 30 fps between test steps.
 */
async function startPoseLog(root: Locator) {
  await root.evaluate((node) => {
    const log: NonNullable<PoseLogWindow['markPoseLog']> = [];
    (window as PoseLogWindow).markPoseLog = log;
    const arm = node.querySelector<SVGSVGElement>('[data-mark-arm-box]')!;
    const path = arm.querySelector<SVGPathElement>('[data-mark-arm]')!;
    const observer = new MutationObserver(() => {
      if (!arm.style.transform) return;
      const point = path.getPointAtLength(0);
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      log.push({ transform: arm.style.transform, x: screenPoint.x, y: screenPoint.y });
    });
    observer.observe(arm, { attributes: true, attributeFilter: ['style'] });
  });
}

async function transitionStartAt(root: Locator) {
  const sample = await root.evaluate((node) => {
    const animations = node
      .getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getTiming().duration === 160);
    animations.forEach((animation) => {
      animation.pause();
      animation.currentTime = 0;
    });
    const path = node.querySelector<SVGPathElement>('[data-mark-arm]')!;
    const point = path.getPointAtLength(0);
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    const log = (window as PoseLogWindow).markPoseLog ?? [];
    return { animationCount: animations.length, x: screenPoint.x, y: screenPoint.y, log };
  });
  expect(sample.animationCount).toBe(5);
  return sample;
}

async function drivenArms(root: Locator) {
  return root.evaluate((node) =>
    Array.from(node.querySelectorAll<SVGSVGElement>('[data-mark-arm-box]')).map((arm) => ({
      transform: arm.style.transform,
      willChange: arm.style.willChange,
    })),
  );
}

async function loopAnimationCount(root: Locator) {
  return root.evaluate(
    (node) =>
      node
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations === Infinity).length,
  );
}

/** Counts pose writes to the first arm over `windowMs`. */
async function poseWritesOver(root: Locator, windowMs: number) {
  return root.evaluate(
    (node, duration) =>
      new Promise<number>((resolve) => {
        const arm = node.querySelector<SVGSVGElement>('[data-mark-arm-box]')!;
        let writes = 0;
        let last = arm.style.transform;
        const observer = new MutationObserver(() => {
          if (arm.style.transform === last) return;
          last = arm.style.transform;
          writes += 1;
        });
        observer.observe(arm, { attributes: true, attributeFilter: ['style'] });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(writes);
        }, duration);
      }),
    windowMs,
  );
}

test('keeps one root and five driven arms through every directed handoff', async ({ mount }) => {
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
    await expect(root).toHaveAttribute('data-motion-state', 'morphing');
    expect(
      await root.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect?.getTiming().duration === 160).length,
      ),
    ).toBe(5);
    await expect(root).toHaveAttribute('data-motion-state', 'playing');
    const arms = await drivenArms(root);
    expect(arms).toHaveLength(5);
    expect(arms.every(({ transform }) => transform !== '')).toBe(true);
    expect(arms.every(({ willChange }) => willChange === '')).toBe(true);
    expect(await loopAnimationCount(root)).toBe(0);
  }

  expect(
    await root.evaluate(
      (node) => (window as typeof window & { markRoot?: Element }).markRoot === node,
    ),
  ).toBe(true);
});

for (const variant of ['twist', 'bloom'] as const) {
  for (const handoff of ['morph', 'settle'] as const) {
    test(`keeps the ${variant} screen pose continuous at ${handoff} time zero`, async ({
      mount,
    }) => {
      const component = await mount(IntentMarkLoaderHost, {
        props: { variant, size: 256, playing: true },
      });
      const root = component.getByRole('status', { name: 'Loading' });
      await expect(root).toHaveAttribute('data-motion-state', 'playing');
      await startPoseLog(root);
      await expect.poll(() => poseWritesOver(root, 100)).toBeGreaterThan(0);

      await component.update({
        props: {
          variant: handoff === 'morph' ? 'pulse' : variant,
          size: 256,
          playing: handoff === 'morph',
        },
      });
      await expect(root).toHaveAttribute(
        'data-motion-state',
        handoff === 'morph' ? 'morphing' : 'settling',
      );
      const after = await transitionStartAt(root);
      const before = after.log.at(-1);
      expect(before).toBeDefined();

      expect(Math.hypot(after.x - before!.x, after.y - before!.y)).toBeLessThanOrEqual(0.5);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2] as const) {
    test(`keeps vector geometry and currentColor in ${theme} at ${zoom * 100}%`, async ({
      mount,
    }) => {
      const component = await mount(IntentMarkLoaderHost, {
        props: { theme, zoom, size: 128, playing: false },
      });
      const root = component.getByRole('status', { name: 'Loading' });
      await expect(root).toHaveAttribute('viewBox', '0 0 256 208');
      await expect(component).toHaveAttribute('data-theme', theme);
      await expect(root.locator('[data-mark-arm-box]')).toHaveCount(5);
      await expect(root.locator('[data-mark-arm-box]').first()).toHaveAttribute(
        'viewBox',
        '0 0 256 208',
      );
      await expect(root.locator('[data-mark-arm]')).toHaveCount(5);
      const box = await root.boundingBox();
      expect(box?.width).toBe(128 * zoom);
      expect(box?.height).toBe(128 * zoom);
      const colors = await root.evaluate((node) => ({
        color: getComputedStyle(node).color,
        contain: getComputedStyle(node).contain,
        stroke: getComputedStyle(node.querySelector('[data-mark-arm]')!).stroke,
      }));
      expect(colors.stroke).toBe(colors.color);
      expect(colors.contain).toBe('content');
    });
  }
}

test('does no continuous work while the window is blurred', async ({ mount, page }) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'bloom', size: 128, playing: true },
  });
  const root = component.getByRole('status', { name: 'Loading' });
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  expect((await drivenArms(root)).every(({ transform }) => transform === '')).toBe(true);

  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  expect((await drivenArms(root)).every(({ transform }) => transform !== '')).toBe(true);
  expect(await poseWritesOver(root, 500)).toBeGreaterThan(0);

  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await poseWritesOver(root, 500)).toBe(0);
  expect((await drivenArms(root)).every(({ transform }) => transform === '')).toBe(true);
});

test('changes the Bloom pose at most 30 times per second and no compositor layer is promoted', async ({
  mount,
}) => {
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'bloom', size: 128, playing: true },
  });
  const root = component.getByRole('status', { name: 'Loading' });
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  expect(await loopAnimationCount(root)).toBe(0);
  expect((await drivenArms(root)).every(({ willChange }) => willChange === '')).toBe(true);

  const writes = await poseWritesOver(root, 2_000);
  expect(writes).toBeLessThanOrEqual(62);
  expect(writes).toBeGreaterThanOrEqual(50);
});

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
