import { expect, test } from '@playwright/experimental-ct-svelte';
import OverlayTriggerContractHarness from './OverlayTriggerContractHarness.svelte';

for (const name of ['Dialog default trigger', 'Tooltip default trigger']) {
  test(`${name} uses the medium control height with the 8/6 geometry`, async ({ mount, page }) => {
    const component = await mount(OverlayTriggerContractHarness);
    await expect(page.locator('#splash')).toHaveCount(0);

    const trigger = component.getByRole('button', { name });
    const style = await trigger.evaluate((element) => {
      const computed = getComputedStyle(element);
      const probe = document.createElement('div');
      probe.style.height = 'var(--control-height-medium)';
      document.body.appendChild(probe);
      const controlHeight = getComputedStyle(probe).height;
      probe.remove();
      return {
        controlHeight,
        height: computed.height,
        radius: computed.borderRadius,
        gap: computed.gap,
      };
    });
    expect(style.controlHeight).toMatch(/^[1-9]\d*px$/);
    expect(style).toEqual({
      controlHeight: style.controlHeight,
      height: style.controlHeight,
      radius: '8px',
      gap: '6px',
    });
  });
}
