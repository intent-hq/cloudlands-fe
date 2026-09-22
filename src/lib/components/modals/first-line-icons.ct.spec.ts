import { expect, test } from '../../../test/ct-test';
import QuitPreview from './quit-confirmation.preview.svelte';

for (const scenario of ['duplicate-names', 'eleven-browsers']) {
  test(`quit ${scenario} icons align to the title, not the subtitle`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await mount(QuitPreview, { props: { scenario } });
    const row = page.locator('[data-slot="list-row"]').first();
    await expect(row).toBeVisible();
    const offsets = await row.evaluate((element) => {
      const title = element.querySelector('[data-slot="list-row-title"]')!;
      const firstLineCenter =
        title.getBoundingClientRect().top + parseFloat(getComputedStyle(title).lineHeight) / 2;
      return ['list-row-leading', 'list-row-trailing'].map((slot) => {
        const bounds = element.querySelector(`[data-slot="${slot}"]`)!.getBoundingClientRect();
        return Math.abs(bounds.top + bounds.height / 2 - firstLineCenter);
      });
    });
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
  });
}
