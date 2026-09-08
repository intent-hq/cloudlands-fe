import { expect, test } from '@playwright/experimental-ct-svelte';
import ScenarioContractHost from './ScenarioContractHost.svelte';

for (const width of [360, 960] as const) {
  test(`setup remains contained at the ${width}px width contract`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 900 });
    const component = await mount(ScenarioContractHost, {
      props: { scenarioId: 'setup-options-open' },
    });
    const shell = component.locator('[data-controller-phase]');
    const panel = component.getByTestId('project-setup-panel');
    const [shellBox, panelBox, overflow] = await Promise.all([
      shell.boundingBox(),
      panel.boundingBox(),
      panel.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })),
    ]);

    expect(shellBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThanOrEqual(shellBox!.x);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(shellBox!.x + shellBox!.width + 1);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await expect(component.getByTestId('draft-composer')).toBeVisible();
  });
}
