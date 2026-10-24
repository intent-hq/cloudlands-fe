import { expect, test } from '../../../test/ct-test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Harness from './ConnectionsIconHarness.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`connection rows stay within the viewport in ${theme}`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    await mount(Harness, { props: { theme } });
    await page.evaluate(() => document.fonts.ready);
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
