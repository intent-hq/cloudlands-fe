import { expect, test } from '@playwright/experimental-ct-svelte';
import { preview } from './diff-map.preview';
import DiffMapPreviewHost from './DiffMapPreview.ct.svelte';

const contractWidths = [280, 900] as const;

for (const stateName of Object.keys(preview.states)) {
  for (const width of contractWidths) {
    test(`${stateName} preview mounts at ${width}px`, async ({ mount, page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.setViewportSize({ width, height: 700 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const component = await mount(DiffMapPreviewHost, {
        props: { stateName },
      });

      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );

      const bounds = await component.locator('.viewport').boundingBox();
      expect(bounds?.width).toBeCloseTo(width, 0);
      await expect(component.locator('[data-diff-map-row]').first()).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  }
}
