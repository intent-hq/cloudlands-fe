import { expect, test } from '../../test/ct-test';
import AnimatedHeightHost from './AnimatedHeightHost.svelte';

test('mounts hundreds of closed wrappers without per-row geometry reads or layouts', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(AnimatedHeightHost, { props: { count: 0, empty: true } });
  await page.evaluate(() => {
    const state = window as typeof window & { heightReads: number };
    state.heightReads = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')!;
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      ...descriptor,
      get() {
        if (this.matches('[data-height-probe]')) state.heightReads++;
        return descriptor.get!.call(this);
      },
    });
    const original = window.getComputedStyle;
    window.getComputedStyle = (element, pseudo) => {
      if (element.matches('[data-height-probe], [data-height-content]')) state.heightReads++;
      return original(element, pseudo);
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  await component.update({ props: { count: 400, empty: true } });
  await expect(component.locator('[data-height-probe]')).toHaveCount(400);
  await expect
    .poll(() =>
      component.evaluate((node) =>
        Array.from(node.querySelectorAll<HTMLElement>('[data-height-probe]')).every(
          (row) => row.style.height === '0px',
        ),
      ),
    )
    .toBe(true);
  const after = await cdp.send('Performance.getMetrics');
  const reads = await page.evaluate(
    () => (window as typeof window & { heightReads: number }).heightReads,
  );
  const layouts =
    after.metrics.find((metric) => metric.name === 'LayoutCount')!.value -
    before.metrics.find((metric) => metric.name === 'LayoutCount')!.value;
  await testInfo.attach('closed-row-layout-evidence.json', {
    body: JSON.stringify({ rows: 400, geometryReads: reads, layouts }, null, 2),
    contentType: 'application/json',
  });
  expect(reads).toBe(0);
  // Allow normal browser frame layout; reject the former one-layout-per-row flush.
  expect(layouts).toBeLessThan(20);
  await cdp.detach();
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`opens, resizes and closes content with ${reducedMotion} motion`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const component = await mount(AnimatedHeightHost);
    const wrapper = component.locator('[data-height-probe]');
    const height = () => wrapper.evaluate((node) => node.getBoundingClientRect().height);
    await expect.poll(height).toBe(0);
    await component.update({ props: { open: true } });
    await expect.poll(height).toBe(48);
    await component.update({ props: { open: true, contentHeight: 96 } });
    await expect.poll(height).toBe(96);
    await component.update({ props: { open: false, contentHeight: 96 } });
    await expect.poll(height).toBe(0);
  });
}

test('keeps an initially open sidebar action visible and usable after deferred sizing', async ({
  mount,
}) => {
  const component = await mount(AnimatedHeightHost, { props: { sidebar: true } });
  const button = component.getByRole('button', { name: 'Sidebar action' });
  await button.click();
  await expect(button).toBeFocused();
  expect(
    await button.evaluate((node) => {
      const content = node.closest('[data-sidebar="group-content"]')!;
      const bounds = content.getBoundingClientRect();
      const buttonBounds = node.getBoundingClientRect();
      return bounds.top <= buttonBounds.top && bounds.bottom >= buttonBounds.bottom;
    }),
  ).toBe(true);
});
