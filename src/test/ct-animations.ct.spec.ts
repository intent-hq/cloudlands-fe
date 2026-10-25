import AnimationProbeHarness from './__tests__/AnimationProbeHarness.svelte';
import {
  activeAnimations,
  expect,
  expectAnimationsToSettle,
  expectNoAnimations,
  test,
} from './ct-test';

const loader = { within: '[data-slot="fake-loader"]', maxDurationMs: 160 };

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('settle waits out a finite fade that a one-time count would catch', async ({
  mount,
  page,
}) => {
  const component = await mount(AnimationProbeHarness);
  const probe = page.getByTestId('probe');
  // Hold the fade paused while inspecting it, so no read can race its end.
  await component.getByTestId('outside').evaluate((node) => {
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, id: 'fade-out' }).pause();
  });
  expect(await probe.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(1);
  expect((await activeAnimations(probe)).map(({ name }) => name)).toEqual(['fade-out']);

  await probe.evaluate((node) => node.getAnimations({ subtree: true }).forEach((a) => a.play()));
  await expectAnimationsToSettle(probe);
  expect(await activeAnimations(probe)).toEqual([]);
});

test('settle fails and names an infinite animation', async ({ mount, page }) => {
  await mount(AnimationProbeHarness);
  const probe = page.getByTestId('probe');
  await page.getByTestId('outside').evaluate((node) => {
    node.animate([{ rotate: '0deg' }, { rotate: '360deg' }], {
      duration: 200,
      iterations: Infinity,
      id: 'spin',
    });
  });
  const failure = await expectAnimationsToSettle(probe, { timeout: 500 }).then(
    () => null,
    (error: Error) => error.message,
  );
  expect(failure).toContain('should settle');
  expect(failure).toContain('"spin"');
  expect(failure).toContain('div[data-testid=\\"outside\\"]');
});

test('ignore skips only the named component’s short finite fades', async ({ mount, page }) => {
  await mount(AnimationProbeHarness);
  const probe = page.getByTestId('probe');
  await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="loader-layer"]')!;
    const outside = document.querySelector('[data-testid="outside"]')!;
    const fade = [{ opacity: 0 }, { opacity: 1 }];
    // Paused, so every animation is still present for each later read.
    layer.animate(fade, { duration: 160, id: 'loader-crossfade' }).pause();
    layer.animate(fade, { duration: 160, iterations: Infinity, id: 'loader-loop' }).pause();
    layer.animate(fade, { duration: 1000, id: 'loader-long' }).pause();
    outside.animate(fade, { duration: 160, id: 'outside-fade' }).pause();
  });

  const counted = await activeAnimations(probe, { ignore: [loader] });
  expect(counted.map(({ name }) => name).sort()).toEqual([
    'loader-long',
    'loader-loop',
    'outside-fade',
  ]);
  const loop = counted.find(({ name }) => name === 'loader-loop')!;
  expect(loop).toMatchObject({
    target: 'span[data-testid="loader-layer"]',
    type: 'Animation',
    playState: 'paused',
    durationMs: null,
    iterations: null,
  });

  const failure = await expectNoAnimations(probe, { ignore: [loader] }).then(
    () => null,
    (error: Error) => error.message,
  );
  expect(failure).toContain('should animate');
  expect(failure).toContain('outside-fade');
  expect(failure).not.toContain('loader-crossfade');
});

test('a named component’s short fade alone passes expectNoAnimations', async ({ mount, page }) => {
  await mount(AnimationProbeHarness);
  const probe = page.getByTestId('probe');
  await page.getByTestId('loader-layer').evaluate((node) => {
    const fade = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    fade.pause();
  });
  await expectNoAnimations(probe, { ignore: [loader] });
  await expect(expectNoAnimations(probe)).rejects.toThrow(/loader-layer/);
  // The fade is the loader's own: the default 400 ms ceiling also covers it.
  await expectNoAnimations(probe, { ignore: [{ within: loader.within }] });
});

test('finished and instant animations are not reported; paused ones are', async ({
  mount,
  page,
}) => {
  await mount(AnimationProbeHarness);
  const probe = page.getByTestId('probe');
  await page.evaluate(async () => {
    const outside = document.querySelector('[data-testid="outside"]')!;
    const held = outside.animate([{ opacity: 1 }, { opacity: 0.5 }], {
      duration: 10,
      fill: 'forwards',
      id: 'held',
    });
    await held.finished;
    const instant = outside.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 0.01,
      id: 'instant',
    });
    instant.pause();
    const paused = outside.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 300,
      id: 'paused',
    });
    paused.pause();
  });
  expect(await probe.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(3);
  expect(await activeAnimations(probe)).toEqual([
    expect.objectContaining({ name: 'paused', playState: 'paused', durationMs: 300 }),
  ]);
  // Cleanup checks also count the finished-but-attached `fill: 'forwards'` leftover.
  expect(
    (await activeAnimations(probe, { includeFinished: true })).map(({ name }) => name),
  ).toEqual(['held', 'paused']);
});

test('reports CSS transitions by property and dedupes overlapping locators', async ({
  mount,
  page,
}) => {
  await mount(AnimationProbeHarness);
  await page.getByTestId('outside').evaluate((node) => {
    const element = node as HTMLElement;
    element.style.transition = 'opacity 2s linear';
    void getComputedStyle(element).opacity;
    element.style.opacity = '0';
    element.getAnimations().forEach((animation) => animation.pause());
  });
  const both = page.locator('[data-testid="probe"], [data-testid="outside"]');
  expect(await both.count()).toBe(2);
  expect(await activeAnimations(both)).toEqual([
    expect.objectContaining({
      target: 'div[data-testid="outside"]',
      type: 'CSSTransition',
      name: 'opacity',
      durationMs: 2000,
    }),
  ]);
  expect(await activeAnimations(page.getByTestId('probe'), { subtree: false })).toEqual([]);
});

test('only narrows the check to matching targets', async ({ mount, page }) => {
  await mount(AnimationProbeHarness);
  const probe = page.getByTestId('probe');
  await page.evaluate(() => {
    const fade = [{ opacity: 0 }, { opacity: 1 }];
    document.querySelector('[data-testid="loader-layer"]')!.animate(fade, 300).pause();
    document.querySelector('[data-testid="outside"]')!.animate(fade, 300).pause();
  });
  expect((await activeAnimations(probe, { only: 'span' })).map(({ target }) => target)).toEqual([
    'span[data-testid="loader-layer"]',
  ]);
  await expectNoAnimations(probe, { only: 'button' });
});

test('a locator that matches nothing fails instead of passing', async ({ mount, page }) => {
  await mount(AnimationProbeHarness);
  const missing = page.getByTestId('not-rendered');
  await expect(expectNoAnimations(missing)).rejects.toThrow(/matched no elements/);
  await expect(expectAnimationsToSettle(missing, { timeout: 500 })).rejects.toThrow(
    /matched no elements/,
  );
});
