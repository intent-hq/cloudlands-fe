import { expect, test } from '@playwright/experimental-ct-svelte';
import OverlayTriggerContractHarness from './OverlayTriggerContractHarness.svelte';

for (const name of ['Dialog default trigger', 'Tooltip default trigger']) {
  test(`${name} uses the 36/8/6 geometry`, async ({ mount, page }) => {
    const component = await mount(OverlayTriggerContractHarness);
    await expect(page.locator('#splash')).toHaveCount(0);

    const trigger = component.getByRole('button', { name });
    const style = await trigger.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        height: computed.height,
        radius: computed.borderRadius,
        gap: computed.gap,
      };
    });
    expect(style).toEqual({ height: '36px', radius: '8px', gap: '6px' });
  });
}
