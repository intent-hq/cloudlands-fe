import { expect, test } from '@playwright/experimental-ct-svelte';
import IntentMarkLoaderHost from './IntentMarkLoaderHost.svelte';

test.setTimeout(120_000);

test('keeps one root and five animations through every directed handoff', async ({ mount }) => {
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
    expect(loops).toHaveLength(5);
    expect(loops.every(({ playState }) => playState === 'running')).toBe(true);
    expect(loops.every(({ targetTag }) => targetTag === 'svg')).toBe(true);
    expect(loops.every(({ willChange }) => willChange === 'transform, opacity')).toBe(true);
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
