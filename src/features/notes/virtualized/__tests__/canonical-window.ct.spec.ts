import { test, expect } from '../../../../test/ct-test';
import Harness from './CanonicalNoteWindowHarness.svelte';
test('mounts the native far HTML header cell at visible geometry with bounded reads and ownership', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness);
  const root = page.getByTestId('canonical-reading-harness');
  await expect(root).toHaveAttribute('data-status', 'ready');
  await expect(root.locator('.tiptap th strong')).toHaveText('TARGET');
  const result = await root.evaluate((e: any) => e.read());
  expect(result.sourceLength).toBeGreaterThan(2_000_000);
  expect(result.sourceReads).toHaveLength(1);
  expect(result.sourceReads[0].at).toBe(result.at);
  expect(result.cost.sourceBytes).toBeLessThan(64);
  expect(result.cost.contextBytes).toBeLessThanOrEqual(8192);
  expect(result.cost.mountedViews).toBe(1);
  expect(result.cost.mountedNodes).toBeLessThan(10);
  expect(result.requests).toBeLessThan(40);
  expect(result.entries.find((e: any) => e.nodeType === 'tableHeader')).toMatchObject({
    childIndex: 2,
  });
  await expect
    .poll(() =>
      root.evaluate((e: any) => {
        const g = e.geometry();
        return g.top >= g.viewportTop && g.bottom <= g.viewportBottom;
      }),
    )
    .toBe(true);
  await page.getByTestId('canonical-reading-scroller').evaluate((e) => (e.style.width = '440px'));
  await expect
    .poll(() =>
      root.evaluate((e: any) => {
        const g = e.geometry();
        return g.top >= g.viewportTop && g.bottom <= g.viewportBottom;
      }),
    )
    .toBe(true);
  await testInfo.attach('canonical-far-header', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await component.unmount();
});

for (const role of ['td', 'th'] as const) {
  test(`renders real Store ${role} transcript with bounded native DOM and no full source fixture`, async ({
    mount,
    page,
  }, info) => {
    const component = await mount(Harness, { props: { storeRole: role } });
    const root = page.getByTestId('canonical-reading-harness');
    await expect(root).toHaveAttribute('data-status', 'ready');
    await expect(root.locator(`.tiptap ${role} strong`)).toHaveText('TARGET');
    const result = await root.evaluate((e: any) => e.read());
    expect(result.sourceReads).toHaveLength(1);
    expect(result.sourceReads[0].at).toBe(result.at);
    expect(result.windowCost.sourceBytes).toBeLessThan(64);
    expect(result.windowCost.canonicalBytes).toBeLessThanOrEqual(65536);
    expect(result.windowCost.contextBytes - result.windowCost.canonicalBytes).toBeLessThanOrEqual(
      8192,
    );
    expect(result.requests).toBeLessThan(60);
    expect(result.cost.mountedDomNodes).toBeGreaterThan(result.cost.mountedNodes);
    expect(result.cost.mountedDomNodes).toBeLessThan(50);
    expect(result.cost.domPayloadBytes).toBeLessThan(8192);
    expect(
      result.entries.find((e: any) => e.nodeType === (role === 'td' ? 'tableCell' : 'tableHeader')),
    ).toMatchObject({ childIndex: 2 });
    await expect
      .poll(() =>
        root.evaluate((e: any) => {
          const g = e.geometry();
          return g.top >= g.viewportTop && g.bottom <= g.viewportBottom;
        }),
      )
      .toBe(true);
    await info.attach('store-window-costs.json', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    await component.unmount();
    expect(await root.count()).toBe(0);
  });
}
