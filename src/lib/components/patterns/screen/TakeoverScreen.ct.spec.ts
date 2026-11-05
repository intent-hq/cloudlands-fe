import { expect, test, wheelUntilScrolled } from '../../../../test/ct-test';
import TakeoverScrollHarness from './TakeoverScrollHarness.svelte';

test('a bounded takeover keeps the last row reachable after its content changes', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(TakeoverScrollHarness, {
    props: { count: 40 },
  });
  const viewport = page.locator('[data-slot="takeover-screen-body"]');
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);

  await wheelUntilScrolled(viewport, { deltaY: 10_000 });
  await expect(page.locator('[data-scroll-row]').last()).toBeInViewport();

  await component.update({ props: { count: 30 } });
  await viewport.evaluate((node) => {
    node.scrollTop = 0;
  });
  await wheelUntilScrolled(viewport, { deltaY: 10_000 });
  await expect(page.locator('[data-scroll-row]').last()).toBeInViewport();
});
