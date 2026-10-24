import { expect, test } from '../../../../test/ct-test';
import MonitoredPrsRowGeometryHost from './MonitoredPrsRowGeometryHost.svelte';

test('keeps PR menu and disclosure controls separate when expanded', async ({ mount, page }) => {
  const component = await mount(MonitoredPrsRowGeometryHost);

  for (const zoom of [1, 2]) {
    await component.update({ props: { zoom } });
    const summary = component.getByTestId('monitored-pr-summary');
    if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
    await page.waitForTimeout(180);

    const kebab = component.getByTestId('monitored-pr-chip');
    const chevron = component.getByTestId('monitored-pr-chevron');
    const kebabBox = (await kebab.boundingBox())!;
    const chevronBox = (await chevron.boundingBox())!;
    expect(kebabBox.x + kebabBox.width).toBeLessThanOrEqual(chevronBox.x);
  }
});

for (const width of [360, 720]) {
  test(`qualified MR details leave both controls accessible at ${width}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 520 });
    const component = await mount(MonitoredPrsRowGeometryHost, {
      props: { provider: 'gitlab', width, referenceState: 'restricted' },
    });
    const summary = component.getByTestId('monitored-pr-summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(component.getByTestId('monitored-pr-details')).toBeVisible();
    const kebab = component.getByTestId('monitored-pr-chip');
    const chevron = component.getByTestId('monitored-pr-chevron');
    const a = (await kebab.boundingBox())!;
    const b = (await chevron.boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(b.x + b.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Tab');
    await expect(kebab).toBeFocused();
  });
}
