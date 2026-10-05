import { expect, test } from '../../../test/ct-test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Harness from './ConnectionsIconHarness.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`connection logos match their first label line in ${theme}`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    await mount(Harness, { props: { theme } });
    await page.evaluate(() => document.fonts.ready);
    const slots = page.locator('.first-line-icon');
    await expect(slots).toHaveCount(3);
    for (const slot of await slots.all()) {
      const delta = await slot.evaluate((node) => {
        const label = node.parentElement!.querySelector('.font-medium')!;
        const box = label.getBoundingClientRect();
        const icon = node.querySelector('svg, img')!.getBoundingClientRect();
        return Math.abs(
          icon.top +
            icon.height / 2 -
            box.top -
            Number.parseFloat(getComputedStyle(label).lineHeight) / 2,
        );
      });
      expect(delta).toBeLessThanOrEqual(1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    if (process.env.MODAL_AUDIT_CAPTURE_DIR) {
      await mkdir(process.env.MODAL_AUDIT_CAPTURE_DIR, { recursive: true });
      await page.screenshot({
        path: join(process.env.MODAL_AUDIT_CAPTURE_DIR, `connections-${theme}-360.png`),
      });
    }
  });
}
