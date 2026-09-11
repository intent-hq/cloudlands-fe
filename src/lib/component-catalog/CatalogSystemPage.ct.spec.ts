import { expect, test } from '@playwright/experimental-ct-svelte';
import CatalogSystemPage from './CatalogSystemPage.svelte';

test('replay moves every spring across its track on every click', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(CatalogSystemPage, { props: { slug: 'motion' } });
  const dots = component.locator('.spring-track i');
  for (let replay = 0; replay < 3; replay++) {
    await component.getByRole('button', { name: 'Replay motion' }).click();
    const travel = await dots.evaluateAll(async (elements) => {
      return await Promise.all(
        elements.map(async (dot) => {
          const animation = dot.getAnimations()[0];
          if (!animation) throw new Error('Replay did not start an animation');
          animation.pause();
          animation.currentTime = 0;
          const start = dot.getBoundingClientRect().left;
          animation.finish();
          await animation.finished;
          const end = dot.getBoundingClientRect();
          const track = dot.parentElement!.getBoundingClientRect();
          return { distance: end.left - start, remaining: track.right - end.right };
        }),
      );
    });
    expect(travel).toHaveLength(3);
    for (const dot of travel) {
      expect(dot.distance).toBeGreaterThan(100);
      expect(Math.abs(dot.remaining)).toBeLessThan(1);
    }
  }
});

for (const preference of ['system', 'catalog'] as const) {
  test(`reduced motion from ${preference} jumps to the end and explains why`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: preference === 'system' ? 'reduce' : 'no-preference',
    });
    if (preference === 'catalog') {
      await page.evaluate(() => document.documentElement.classList.add('catalog-reduced-motion'));
    }
    const component = await mount(CatalogSystemPage, { props: { slug: 'motion' } });
    await expect(component.getByText('Reduced motion is on', { exact: true })).toBeVisible();
    for (let replay = 0; replay < 2; replay++) {
      await component.getByRole('button', { name: 'Replay motion' }).click();
      const positions = await component.locator('.spring-track i').evaluateAll((dots) =>
        dots.map((dot) => ({
          animations: dot.getAnimations().length,
          remaining:
            dot.parentElement!.getBoundingClientRect().right - dot.getBoundingClientRect().right,
        })),
      );
      for (const dot of positions) {
        expect(dot.animations).toBe(0);
        expect(Math.abs(dot.remaining)).toBeLessThan(1);
      }
    }
  });
}
