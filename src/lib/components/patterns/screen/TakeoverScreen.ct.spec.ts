import { expect, test } from '../../../../test/ct-test';
import TakeoverScrollHarness from './TakeoverScrollHarness.svelte';

test('a bounded takeover scrolls to its last row while its body height is animating', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(TakeoverScrollHarness, {
    props: { count: 40 },
  });
  const viewport = page.locator('[data-slot="takeover-screen-body"]');
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);

  await viewport.hover();
  await page.mouse.wheel(0, 10000);
  await expect(page.locator('[data-scroll-row]').last()).toBeInViewport();

  // Removing rows retargets the real spring. Sample on animation frames, not a timed midpoint.
  await component.update({ props: { count: 30 } });
  const sample = await viewport.evaluate(async (node) => {
    for (let frame = 0; frame < 120; frame++) {
      const body = node.querySelector<HTMLElement>('[data-slot="screen-body"]')!;
      const wrapper = body.parentElement!;
      if (
        Math.abs(wrapper.getBoundingClientRect().height - body.getBoundingClientRect().height) > 1
      ) {
        node.scrollTop = 0;
        node.scrollTop = node.scrollHeight;
        return {
          animating: true,
          scrollTop: node.scrollTop,
          bounded: node.scrollHeight > node.clientHeight,
        };
      }
      await new Promise(requestAnimationFrame);
    }
    return { animating: false, scrollTop: node.scrollTop, bounded: false };
  });
  expect(sample.animating).toBe(true);
  expect(sample.bounded).toBe(true);
  expect(sample.scrollTop).toBeGreaterThan(0);
  await viewport.hover();
  await page.mouse.wheel(0, 10000);
  await expect(page.locator('[data-scroll-row]').last()).toBeInViewport();
});
