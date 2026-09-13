import { expect, test } from '@playwright/experimental-ct-svelte';
import EventWakeBodyGeometryHost from './EventWakeBodyGeometryHost.svelte';

test('aligns expanded wake content with its header label column', async ({ mount, page }) => {
  const component = await mount(EventWakeBodyGeometryHost);

  for (const zoom of [1, 2]) {
    await component.update({ props: { zoom } });
    const toggle = component.getByTestId('event-wakeup-summary');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page.waitForTimeout(180);

    const geometry = await component.evaluate((root) => {
      const left = (testId: string) =>
        root.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect().left;
      return {
        label: left('event-wakeup-agent-name'),
        body: left('event-wakeup-detail'),
      };
    });

    expect(geometry.body).toBeCloseTo(geometry.label, 1);
  }
});
