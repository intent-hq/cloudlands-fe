import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import IntentMarkLoaderHost from './IntentMarkLoaderHost.svelte';

test.setTimeout(120_000);

interface ClockWindow extends Window {
  markClock: {
    now: number;
    callbacks: Map<number, FrameRequestCallback>;
    origins: WeakMap<Element, number>;
  };
}

// Control only the browser clock inputs; the real production frame clock and
// pose driver still run. Timers/WAAPI remain real for the bounded crossfade.
// No expected geometry is assigned to the DOM and no production test hook exists.
async function controlClock(page: Page) {
  await page.evaluate(() => {
    const clock: ClockWindow['markClock'] = {
      now: 0,
      callbacks: new Map(),
      origins: new WeakMap(),
    };
    (window as unknown as ClockWindow).markClock = clock;
    let id = 0;
    performance.now = () => clock.now;
    window.requestAnimationFrame = (callback) => {
      clock.callbacks.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      clock.callbacks.delete(id);
    };
  });
}

async function seekLoop(root: Locator, time: number) {
  await root.evaluate((node, elapsed) => {
    const clock = (window as unknown as ClockWindow).markClock;
    const layer = node.querySelector('[data-mark-layer]')!;
    if (!clock.origins.has(layer))
      clock.origins.set(layer, Math.floor(clock.now / (1000 / 30)) * (1000 / 30));
    clock.now = clock.origins.get(layer)! + elapsed + 1e-6;
    const due = [...clock.callbacks.values()];
    clock.callbacks.clear();
    due.forEach((callback) => callback(clock.now));
  }, time);
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
    return { animationCount: animations.length, x: screenPoint.x, y: screenPoint.y };
  });
  expect(sample.animationCount).toBe(2);
  return sample;
}

async function drivenArms(root: Locator) {
  return root.evaluate((node) =>
    Array.from(node.querySelectorAll<SVGPathElement>('[data-mark-arm]')).map((arm) => ({
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
        const arm = node.querySelector<SVGPathElement>('[data-mark-arm]')!;
        let writes = 0;
        let last = arm.style.cssText;
        const observer = new MutationObserver(() => {
          if (arm.style.cssText === last) return;
          last = arm.style.cssText;
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
    await expect(root).toHaveAttribute('data-motion-state', 'playing');
    const arms = await drivenArms(root);
    expect(arms).toHaveLength(5);
    expect(arms.every(({ transform }) => transform !== '')).toBe(true);
    expect(arms.every(({ willChange }) => willChange === '')).toBe(true);
    // eslint-disable-next-line intent/no-one-shot-animation-count -- counts only infinite animations, which cannot end between reads: the loop must not be a Web Animation.
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
      page,
    }) => {
      await controlClock(page);
      const component = await mount(IntentMarkLoaderHost, {
        props: { variant, size: 256, playing: true },
      });
      const root = component.getByRole('status', { name: 'Loading' });
      await expect(root).toHaveAttribute('data-motion-state', 'playing');
      await seekLoop(root, 600);
      const before = await root
        .locator('[data-mark-arm]')
        .first()
        .evaluate((path) => {
          const svgPath = path as SVGPathElement;
          const point = svgPath.getPointAtLength(0);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(svgPath.getScreenCTM()!);
          return { x: screen.x, y: screen.y };
        });

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
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(0.5);
    });
  }
}

test('freezes the filled Twist pose during a theme change in a handoff', async ({
  mount,
  page,
}) => {
  await controlClock(page);
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
  page,
}) => {
  await controlClock(page);
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
  test(`holds ${variant} vectors within a clock slot and advances without image or media requests`, async ({
    mount,
    page,
  }) => {
    await controlClock(page);
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
    for (const time of [500, 510, 520, 540]) {
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
    expect(new Set(poses.slice(0, 3)).size).toBe(1);
    expect(poses[3]).not.toBe(poses[0]);
    expect(assetRequests).toEqual([]);
  });
}

test('does no continuous work while the window is blurred', async ({ mount, page }) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'bloom', size: 128, playing: true },
  });
  const root = component.getByRole('status', { name: 'Loading' });
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  // eslint-disable-next-line intent/no-one-shot-animation-count -- the loader cancels its fades before it reports neutral, so neutral means zero animations.
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  const neutral = await drivenArms(root);

  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  expect((await drivenArms(root)).every(({ transform }) => transform !== '')).toBe(true);
  expect(await poseWritesOver(root, 500)).toBeGreaterThan(0);

  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  // eslint-disable-next-line intent/no-one-shot-animation-count -- the loader cancels its fades before it reports neutral, so neutral means zero animations.
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await poseWritesOver(root, 500)).toBe(0);
  expect(await drivenArms(root)).toEqual(neutral);
});

test('changes the Bloom pose at most 30 times per second and no compositor layer is promoted', async ({
  mount,
}) => {
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'bloom', size: 128, playing: true },
  });
  const root = component.getByRole('status', { name: 'Loading' });
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  // eslint-disable-next-line intent/no-one-shot-animation-count -- counts only infinite animations, which cannot end between reads: the loop must not be a Web Animation.
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
  // eslint-disable-next-line intent/no-one-shot-animation-count -- the loader cancels its fades before it reports neutral, so neutral means zero animations.
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  // eslint-disable-next-line intent/no-one-shot-animation-count -- the loader cancels its fades before it reports neutral, so neutral means zero animations.
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});
