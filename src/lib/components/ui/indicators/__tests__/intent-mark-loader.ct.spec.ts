import { expect, test } from '../../../../../test/ct-test';
import IntentMarkLoaderHost from './IntentMarkLoaderHost.svelte';

test('pauses the loader while the window is blurred', async ({ mount, page }) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  const component = await mount(IntentMarkLoaderHost, {
    props: { variant: 'bloom', size: 128, playing: true },
  });
  const root = component.getByRole('status', { name: 'Loading' });
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  // eslint-disable-next-line intent/no-one-shot-animation-count -- the loader cancels its fades before it reports neutral, so neutral means zero animations.
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect(root).toHaveAttribute('data-motion-state', 'playing');

  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  // eslint-disable-next-line intent/no-one-shot-animation-count -- the loader cancels its fades before it reports neutral, so neutral means zero animations.
  expect(await root.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});

test('pauses the loader for reduced motion or a hidden document', async ({ mount, page }) => {
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
