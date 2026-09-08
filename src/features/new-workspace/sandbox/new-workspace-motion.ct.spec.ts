import { expect, test } from '@playwright/experimental-ct-svelte';
import ScenarioContractHost from './ScenarioContractHost.svelte';

test('reduced-motion preference disables active shell animations', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ScenarioContractHost, {
    props: { scenarioId: 'setup-options-open' },
  });

  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
  await expect
    .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
});
